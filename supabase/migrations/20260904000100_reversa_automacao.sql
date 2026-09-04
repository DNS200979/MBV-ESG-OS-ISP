-- =====================================================================
-- 11: automação do ciclo de logística reversa (§8, RF-ISP-004, RF-DIST-006)
--
-- Fecha as lacunas que impediam o ciclo de rodar sozinho:
--   a) inventário de rede nasce da NF-e de compra, não de digitação;
--   b) o retorno passa por TRIAGEM com destino explícito e laudo;
--   c) destinadores viram cadastro com licença e validade — destinar
--      para licença vencida vira alerta, não ativo de carbono;
--   d) lote de reversa se forma a partir dos ativos em descarte.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Novos estados do ciclo de vida
--   novo → em_campo → retorno → [TRIAGEM] → reparo | refurb | descarte
--   reparo → refurb (recuperado) | descarte (irrecuperável)
--   descarte → baixado (após certificado do lote)
-- ---------------------------------------------------------------------
alter table ativos_equipamento
  drop constraint if exists ativos_equipamento_estado_check;

alter table ativos_equipamento
  add constraint ativos_equipamento_estado_check
  check (estado in ('novo','em_campo','retorno','triagem','reparo','refurb','descarte','baixado'));

-- Rastreabilidade da origem fiscal e do custo (decisão reparo × reposição)
alter table ativos_equipamento
  add column if not exists nf_item          smallint,
  add column if not exists valor_aquisicao  numeric(14,2),
  add column if not exists data_entrada     date,
  add column if not exists serial_provisorio boolean not null default false,
  add column if not exists observacao       text;

comment on column ativos_equipamento.serial_provisorio is
  'NF-e raramente traz série por unidade. Ao importar, o inventário nasce com '
  'serial provisório derivado da chave + item; o técnico corrige em campo.';

-- ---------------------------------------------------------------------
-- Destinadores: quem recebe o equipamento (reciclador, assistência, refurb)
-- ---------------------------------------------------------------------
create table if not exists destinadores (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  cnpj               text not null check (cnpj ~ '^[0-9]{14}$'),
  razao_social       text not null,
  nome_fantasia      text,
  tipo               text not null
                     check (tipo in ('reciclador','assistencia_tecnica','refurbisher','logistica','fabricante')),
  uf                 char(2),
  municipio          text,
  contato_nome       text,
  contato_email      text,
  contato_telefone   text,
  -- Lastro documental: sem licença válida não há prova de destinação regular
  licenca_ambiental  text,
  licenca_orgao      text,
  licenca_validade   date,
  cadri              text,
  aceita_categorias  text[] not null default '{}',
  prazo_medio_dias   smallint,
  ativo              boolean not null default true,
  validacao          status_validacao not null default 'nao_validado',
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  unique (empresa_id, cnpj)
);

create index if not exists destinadores_empresa_idx on destinadores (empresa_id, ativo, tipo);
create index if not exists destinadores_licenca_idx on destinadores (licenca_validade)
  where licenca_validade is not null;

comment on column destinadores.validacao is
  '§12: "validado" só depois de conferida a licença ambiental vigente do destinador.';

-- Vincula o lote ao destinador cadastrado (cnpj/nome livres ficam por compat.)
alter table lotes_reversa
  add column if not exists destinador_id uuid references destinadores(id);

create index if not exists lotes_destinador_idx on lotes_reversa (destinador_id);

-- ---------------------------------------------------------------------
-- Triagem do retorno — a decisão que o produto precisa registrar
-- ---------------------------------------------------------------------
create table if not exists triagens (
  id                     uuid primary key default gen_random_uuid(),
  ativo_id               uuid not null references ativos_equipamento(id) on delete cascade,
  empresa_id             uuid not null references empresas(id) on delete cascade,
  destino                text not null check (destino in ('reparo','reposicao','descarte')),
  motivo                 text not null
                         check (motivo in ('sem_defeito','defeito_reparavel','dano_fisico',
                                           'fim_de_vida','obsoleto','fora_de_garantia','outro')),
  laudo                  text,
  custo_reparo_estimado  numeric(14,2),
  valor_reposicao        numeric(14,2),
  destinador_id          uuid references destinadores(id),
  triado_por             uuid references auth.users(id),
  triado_em              timestamptz not null default now()
);

create index if not exists triagens_ativo_idx     on triagens (ativo_id, triado_em desc);
create index if not exists triagens_empresa_idx   on triagens (empresa_id, destino);
create index if not exists triagens_destinador_idx on triagens (destinador_id);

comment on table triagens is
  'Decisão do retorno: reparo (assistência), reposicao (volta ao estoque para '
  'reposição de campo) ou descarte (entra em lote de reversa). O par '
  'custo_reparo_estimado × valor_reposicao é a memória da decisão econômica.';

-- ---------------------------------------------------------------------
-- Inventário de rede "no momento" (§ pedido: saber o ativo de rede agora)
-- security_invoker: respeita a RLS de quem consulta
-- ---------------------------------------------------------------------
create or replace view vw_inventario_rede
with (security_invoker = true) as
select
  a.isp_id                                        as empresa_id,
  coalesce(a.modelo, '(sem modelo)')              as modelo,
  a.ncm,
  a.estado,
  count(*)                                        as quantidade,
  sum(coalesce(a.valor_aquisicao, 0))             as valor_total,
  count(*) filter (where a.serial_provisorio)     as seriais_provisorios,
  min(a.data_entrada)                             as entrada_mais_antiga
from ativos_equipamento a
where a.isp_id is not null
group by a.isp_id, coalesce(a.modelo, '(sem modelo)'), a.ncm, a.estado;

-- ---------------------------------------------------------------------
-- Formação de lote a partir dos ativos em descarte
-- SECURITY INVOKER: a RLS de quem chama continua valendo (é o correto —
-- a função não precisa de privilégio, só encapsula a transação).
-- ---------------------------------------------------------------------
create or replace function public.formar_lote_reversa(
  p_empresa_id     uuid,
  p_destinador_id  uuid default null,
  p_isp_parceiro_id uuid default null,
  p_peso_medio_kg  numeric default 0.35,
  p_identificacao  text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lote uuid;
  v_qtd  integer;
  v_peso numeric;
  v_dest destinadores%rowtype;
begin
  select count(*) into v_qtd
    from ativos_equipamento
   where isp_id = p_empresa_id
     and estado = 'descarte'
     and lote_reversa_id is null;

  if v_qtd = 0 then
    raise exception 'Nenhum equipamento em descarte aguardando lote.';
  end if;

  if p_destinador_id is not null then
    select * into v_dest from destinadores where id = p_destinador_id;
    if not found then
      raise exception 'Destinador não encontrado ou fora do seu acesso.';
    end if;
    if v_dest.licenca_validade is not null and v_dest.licenca_validade < current_date then
      raise exception
        'Licença ambiental do destinador % venceu em %. Destinação sem licença vigente não sustenta dossiê.',
        v_dest.razao_social, v_dest.licenca_validade;
    end if;
  end if;

  v_peso := round(v_qtd * p_peso_medio_kg, 2);

  insert into lotes_reversa
    (empresa_id, isp_parceiro_id, identificacao, peso_kg, qtd_equipamentos,
     destinador_id, destinador_cnpj, destinador_nome, status, coletado_em,
     rateio_isp_pct)
  values
    (p_empresa_id, p_isp_parceiro_id,
     coalesce(p_identificacao, 'LOTE-' || to_char(now(), 'YYYYMMDD-HH24MI')),
     v_peso, v_qtd,
     p_destinador_id, v_dest.cnpj, v_dest.razao_social,
     'coleta', current_date,
     case when p_isp_parceiro_id is null then 0 else 50 end)
  returning id into v_lote;

  update ativos_equipamento
     set lote_reversa_id = v_lote
   where isp_id = p_empresa_id
     and estado = 'descarte'
     and lote_reversa_id is null;

  return v_lote;
end;
$$;

comment on function public.formar_lote_reversa is
  'Agrupa os equipamentos em descarte sem lote. Peso estimado por unidade '
  '(default 0,35 kg ≈ ONU/roteador) — substituir por pesagem real quando houver.';
