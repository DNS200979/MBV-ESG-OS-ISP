-- =====================================================================
-- 15: catálogo de produtos — peso e carbono incorporado com procedência
--
-- Substitui a estimativa de 0,35 kg/unidade por dado com fonte. A regra
-- é a mesma do resto do produto: número sem procedência não sustenta
-- dossiê, então `peso_fonte` e `validacao` viajam junto com o valor e
-- aparecem na memória de cálculo do lançamento.
-- =====================================================================

-- Procedência do dado — ordenada da mais forte para a mais fraca
do $$ begin
  create type fonte_dado as enum (
    'pesagem_propria',      -- balança do próprio operador: prova direta
    'epd_fabricante',       -- EPD / datasheet do fabricante, documento anexado
    'catalogo_fabricante',  -- catálogo comercial, sem documento formal
    'erp',                  -- veio do ERP/CRM via conector
    'planilha',             -- importado de planilha do cliente
    'estimado'              -- estimativa — o que queremos eliminar
  );
exception when duplicate_object then null; end $$;

create table if not exists produtos (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  sku                text,
  gtin               text check (gtin is null or gtin ~ '^[0-9]{8,14}$'),
  ncm                text check (ncm is null or ncm ~ '^[0-9]{8}$'),
  modelo             text not null,
  fabricante         text,
  categoria_reversa  text check (categoria_reversa in
                     ('onu_roteador','olt_chassi','fonte_carregador','bateria',
                      'cabo_fibra','placa_eletronica','servidor','outro')),

  -- Peso: o número que hoje é chutado
  peso_kg            numeric(10,4) check (peso_kg is null or peso_kg > 0),
  peso_fonte         fonte_dado,
  peso_documento_id  uuid references documentos_fonte(id) on delete set null,
  peso_medido_em     date,

  -- Carbono incorporado: mesma disciplina de procedência
  carbono_incorporado_tco2e numeric(14,6) check (carbono_incorporado_tco2e is null or carbono_incorporado_tco2e >= 0),
  carbono_fonte      fonte_dado,
  carbono_documento_id uuid references documentos_fonte(id) on delete set null,

  vida_util_meses    smallint,
  valor_referencia   numeric(14,2),
  validacao          status_validacao not null default 'nao_validado',
  ativo              boolean not null default true,
  origem_cadastro    text not null default 'manual'
                     check (origem_cadastro in ('manual','nfe','planilha','erp','api')),
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

-- Chaves de casamento. Parciais porque SKU/GTIN são opcionais.
create unique index if not exists produtos_sku_idx  on produtos (empresa_id, sku)  where sku  is not null;
create unique index if not exists produtos_gtin_idx on produtos (empresa_id, gtin) where gtin is not null;
create index if not exists produtos_ncm_idx     on produtos (empresa_id, ncm);
create index if not exists produtos_modelo_idx  on produtos (empresa_id, lower(modelo));
create index if not exists produtos_pesodoc_idx on produtos (peso_documento_id);
create index if not exists produtos_carbdoc_idx on produtos (carbono_documento_id);

comment on column produtos.peso_fonte is
  'Procedência do peso. "estimado" mantém o dossiê marcado como preliminar; '
  '"pesagem_propria" e "epd_fabricante" (com documento anexado) sustentam prova.';

-- Fallback por NCM, para quando o produto específico ainda não existe
create table if not exists pesos_referencia (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  ncm         text not null check (ncm ~ '^[0-9]{8}$'),
  descricao   text,
  peso_kg     numeric(10,4) not null check (peso_kg > 0),
  fonte       fonte_dado not null default 'estimado',
  validacao   status_validacao not null default 'nao_validado',
  criado_em   timestamptz not null default now(),
  unique (empresa_id, ncm)
);

-- Ativo passa a apontar para o produto e a guardar o peso do momento
alter table ativos_equipamento
  add column if not exists produto_id uuid references produtos(id) on delete set null,
  add column if not exists peso_kg    numeric(10,4),
  add column if not exists peso_fonte fonte_dado;

create index if not exists ativos_produto_idx on ativos_equipamento (produto_id);

comment on column ativos_equipamento.peso_kg is
  'Cópia do peso vigente no momento da entrada. Congelar evita que uma '
  'correção futura no catálogo reescreva a massa de um lote já certificado.';

-- ---------------------------------------------------------------------
-- Resolução do produto a partir dos campos da NF-e
-- Ordem: GTIN → SKU → NCM+modelo → NCM. Devolve como casou, porque a
-- memória de cálculo precisa dizer de onde veio o número.
-- ---------------------------------------------------------------------
create or replace function public.resolver_produto(
  p_empresa_id uuid,
  p_gtin       text default null,
  p_sku        text default null,
  p_ncm        text default null,
  p_modelo     text default null
)
returns table (produto_id uuid, peso_kg numeric, peso_fonte fonte_dado, casou_por text)
language sql
stable
security invoker
set search_path = public
as $$
  with candidatos as (
    select p.id, p.peso_kg, p.peso_fonte, 'gtin'::text as via, 1 as ordem
      from produtos p
     where p.empresa_id = p_empresa_id and p.ativo
       and p_gtin is not null and p.gtin = p_gtin
    union all
    select p.id, p.peso_kg, p.peso_fonte, 'sku', 2
      from produtos p
     where p.empresa_id = p_empresa_id and p.ativo
       and p_sku is not null and p.sku = p_sku
    union all
    select p.id, p.peso_kg, p.peso_fonte, 'ncm+modelo', 3
      from produtos p
     where p.empresa_id = p_empresa_id and p.ativo
       and p_ncm is not null and p.ncm = p_ncm
       and p_modelo is not null and lower(p.modelo) = lower(p_modelo)
    union all
    select null::uuid, r.peso_kg, r.fonte, 'ncm_referencia', 4
      from pesos_referencia r
     where r.empresa_id = p_empresa_id
       and p_ncm is not null and r.ncm = p_ncm
  )
  select id, peso_kg, peso_fonte, via
    from candidatos
   where peso_kg is not null
   order by ordem
   limit 1;
$$;

comment on function public.resolver_produto is
  'Casa um item de nota com o catálogo. Retorna vazio quando nada casa — '
  'o chamador então recorre à estimativa e marca o lote como preliminar.';
