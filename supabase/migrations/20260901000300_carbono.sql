-- =====================================================================
-- 03: documentos-fonte, fatores de emissão, partidas dobradas, MRV
-- Ref.: §1.2, §5, §9, RNF-002
-- =====================================================================

-- ---------------------------------------------------------------------
-- Documento-fonte: nenhum lançamento existe sem um destes (§4.1 princípio 1)
-- ---------------------------------------------------------------------
create table if not exists documentos_fonte (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  tipo          text not null
                check (tipo in ('nfe','cte','fatura_energia','mtr','cdf','di','outro')),
  chave_acesso  text check (chave_acesso is null or chave_acesso ~ '^[0-9]{44}$'),
  hash_sha256   text not null check (hash_sha256 ~ '^[0-9a-f]{64}$'),
  payload       jsonb not null default '{}'::jsonb,
  arquivo_url   text,
  nome_arquivo  text,
  versao        integer not null default 1,
  substitui_id  uuid references documentos_fonte(id),
  inconsistencias jsonb not null default '[]'::jsonb,
  criado_por    uuid references auth.users(id),
  criado_em     timestamptz not null default now(),
  unique (empresa_id, hash_sha256)
);

create index if not exists docfonte_empresa_idx on documentos_fonte (empresa_id, criado_em desc);
create index if not exists docfonte_tipo_idx    on documentos_fonte (empresa_id, tipo);
create index if not exists docfonte_chave_idx   on documentos_fonte (chave_acesso)
  where chave_acesso is not null;
create index if not exists docfonte_substitui_idx on documentos_fonte (substitui_id);

comment on table documentos_fonte is
  'RNF-002: imutável. Correção se faz por nova versão apontando em substitui_id.';
comment on column documentos_fonte.inconsistencias is
  '§10: importação nunca falha silenciosamente — erros linha a linha ficam aqui.';

create trigger tg_docfonte_imutavel
  before update or delete on documentos_fonte
  for each row execute function private.fn_bloqueia_alteracao();

-- ---------------------------------------------------------------------
-- Fatores de emissão parametrizados (mitigação do risco de hard-code, §15)
-- ---------------------------------------------------------------------
create table if not exists fatores_emissao (
  id             uuid primary key default gen_random_uuid(),
  chave          text not null,
  descricao      text not null,
  unidade_origem text not null,          -- kWh, L, kg, t.km, unidade
  fator_tco2e    numeric(18,9) not null, -- tCO2e por unidade_origem
  escopo         smallint not null check (escopo in (1,2,3)),
  gas            text not null default 'CO2e',
  fonte          text not null,
  vigencia_ini   date not null,
  vigencia_fim   date,
  validacao      status_validacao not null default 'nao_validado',
  criado_em      timestamptz not null default now(),
  unique (chave, vigencia_ini)
);

create index if not exists fatores_chave_idx on fatores_emissao (chave, vigencia_ini desc);

comment on table fatores_emissao is
  '§17 pendência: valores-semente são PROVISÓRIOS (validacao = nao_validado). '
  'Substituir por inventários setoriais / GHG Protocol BR / fator SIN do MCTI antes de uso comercial.';

-- ---------------------------------------------------------------------
-- Partidas dobradas de carbono (§1.2)
-- ---------------------------------------------------------------------
create table if not exists lancamentos_carbono (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresas(id) on delete cascade,
  documento_fonte_id  uuid not null references documentos_fonte(id),
  fator_emissao_id    uuid references fatores_emissao(id),
  natureza            natureza_lancamento not null,
  escopo              smallint not null check (escopo in (1,2,3)),
  categoria           text not null,
  quantidade_tco2e    numeric(14,4) not null check (quantidade_tco2e >= 0),
  competencia         date not null,
  memoria_calculo     jsonb not null default '{}'::jsonb,
  rateio_origem_id    uuid,
  estornado_por       uuid references lancamentos_carbono(id),
  criado_por          uuid references auth.users(id),
  criado_em           timestamptz not null default now()
);

create index if not exists lanc_empresa_comp_idx on lancamentos_carbono (empresa_id, competencia desc);
create index if not exists lanc_doc_idx          on lancamentos_carbono (documento_fonte_id);
create index if not exists lanc_fator_idx        on lancamentos_carbono (fator_emissao_id);
create index if not exists lanc_categoria_idx    on lancamentos_carbono (empresa_id, categoria);
create index if not exists lanc_estorno_idx      on lancamentos_carbono (estornado_por);

comment on column lancamentos_carbono.memoria_calculo is
  '§10: memoria_calculo sempre presente — insumo, fator aplicado, fórmula e fonte.';
comment on column lancamentos_carbono.estornado_por is
  'Correção é estorno + novo lançamento; nunca UPDATE destrutivo.';

-- ---------------------------------------------------------------------
-- Fechamento MRV mensal (§5)
-- ---------------------------------------------------------------------
create table if not exists fechamentos_mensais (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  competencia       date not null,
  total_passivo     numeric(14,4) not null default 0,
  total_ativo       numeric(14,4) not null default 0,
  saldo_liquido     numeric(14,4) generated always as (total_passivo - total_ativo) stored,
  qtd_documentos    integer not null default 0,
  status            text not null default 'aberto'
                    check (status in ('aberto','fechado','reaberto')),
  fechado_por       uuid references auth.users(id),
  fechado_em        timestamptz,
  observacoes       text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  unique (empresa_id, competencia)
);

create index if not exists fech_empresa_idx on fechamentos_mensais (empresa_id, competencia desc);

create trigger tg_fech_touch
  before update on fechamentos_mensais
  for each row execute function private.fn_touch();

-- ---------------------------------------------------------------------
-- Visão de balanço (§6.5 tela 1, §7.5 tela 1)
-- security_invoker: a view respeita a RLS de quem consulta
-- ---------------------------------------------------------------------
create or replace view vw_balanco_carbono
with (security_invoker = true) as
select
  l.empresa_id,
  date_trunc('month', l.competencia)::date            as competencia,
  l.escopo,
  l.categoria,
  sum(l.quantidade_tco2e) filter (where l.natureza = 'passivo') as passivo_tco2e,
  sum(l.quantidade_tco2e) filter (where l.natureza = 'ativo')   as ativo_tco2e,
  count(*)                                            as qtd_lancamentos
from lancamentos_carbono l
where l.estornado_por is null
group by 1, 2, 3, 4;
