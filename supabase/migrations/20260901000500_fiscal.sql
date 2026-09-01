-- =====================================================================
-- 05: catálogo de incentivos, funil de qualificação, simulações
-- Ref.: §3, §5, §12, §9
-- =====================================================================

-- Catálogo global — leitura para autenticados, escrita só service_role
create table if not exists incentivos_catalogo (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null unique,
  nome               text not null,
  esfera             text not null check (esfera in ('federal','estadual','municipal')),
  uf                 char(2),
  base_legal         text not null,
  ementa             text,
  aplica_perfil      text[] not null default '{isp,distribuidor_telecom}',
  requisitos         jsonb not null default '[]'::jsonb,
  regimes_elegiveis  regime_tributario[] not null default '{simples,presumido,real}',
  vigencia_ini       date,
  vigencia_fim       date,
  status_reforma     status_reforma not null default 'indefinido',
  validacao          status_validacao not null default 'nao_validado',
  disclaimer         text not null default
    'Estimativa técnica. Não constitui parecer jurídico ou contábil (§12).',
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create index if not exists inc_esfera_idx  on incentivos_catalogo (esfera, uf);
create index if not exists inc_perfil_idx  on incentivos_catalogo using gin (aplica_perfil);

comment on column incentivos_catalogo.requisitos is
  'Requisitos objetivos avaliáveis pelo funil: [{"chave":"regime","operador":"in","valor":["real"]}, ...]';
comment on column incentivos_catalogo.validacao is
  '§12.3: toda tela que exibe economia carrega este selo. Nada vira "ativo" sem parceiro licenciado.';

-- Funil de qualificação por empresa (§5)
create table if not exists incentivos_empresa (
  id                       uuid primary key default gen_random_uuid(),
  empresa_id               uuid not null references empresas(id) on delete cascade,
  incentivo_id             uuid not null references incentivos_catalogo(id) on delete cascade,
  etapa_funil              etapa_funil not null default 'triagem',
  economia_estimada_anual  numeric(14,2),
  economia_realizada_anual numeric(14,2),
  evidencias               uuid[] not null default '{}',
  memoria_calculo          jsonb not null default '{}'::jsonb,
  requisitos_atendidos     jsonb not null default '[]'::jsonb,
  parceiro_validador       text,
  validado_em              date,
  observacoes              text,
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now(),
  unique (empresa_id, incentivo_id)
);

create index if not exists incemp_empresa_idx  on incentivos_empresa (empresa_id, etapa_funil);
create index if not exists incemp_incentivo_idx on incentivos_empresa (incentivo_id);

-- §12.4: nenhum incentivo chega a 'ativo' sem passar por validacao_parceiro
create or replace function private.fn_valida_funil()
returns trigger
language plpgsql
as $$
begin
  if new.etapa_funil = 'ativo'
     and (new.parceiro_validador is null or new.validado_em is null) then
    raise exception
      'Etapa "ativo" exige validacao_parceiro registrada (§12.4): informe parceiro_validador e validado_em.';
  end if;
  return new;
end;
$$;

revoke execute on function private.fn_valida_funil() from public, anon, authenticated;

create trigger tg_funil_valida
  before insert or update on incentivos_empresa
  for each row execute function private.fn_valida_funil();

-- Simulações tributárias (RF-ISP-007, RF-DIST-007)
create table if not exists simulacoes_tributarias (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  rotulo      text,
  parametros  jsonb not null,   -- faturamento, CAPEX, UF, regime, folha...
  resultado   jsonb not null,   -- carga por cenário, incl. CBS/IBS 2026-2033
  criado_por  uuid references auth.users(id),
  criado_em   timestamptz not null default now()
);

create index if not exists sim_empresa_idx on simulacoes_tributarias (empresa_id, criado_em desc);

-- Curva de transição da reforma — parametrizada, nunca hard-coded (§15)
create table if not exists reforma_transicao (
  ano                smallint primary key,
  cbs_pct            numeric(5,2) not null default 0,
  ibs_pct            numeric(5,2) not null default 0,
  icms_iss_pct       numeric(5,2) not null default 100,
  beneficios_icms_pct numeric(5,2) not null default 100,
  observacao         text,
  validacao          status_validacao not null default 'nao_validado'
);

comment on table reforma_transicao is
  'EC 132/2023 + LC 214/2025. Percentuais são parâmetros editáveis — o simulador lê daqui.';

create trigger tg_catalogo_touch before update on incentivos_catalogo
  for each row execute function private.fn_touch();
create trigger tg_incemp_touch   before update on incentivos_empresa
  for each row execute function private.fn_touch();
