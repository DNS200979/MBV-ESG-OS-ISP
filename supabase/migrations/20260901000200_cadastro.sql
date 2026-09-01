-- =====================================================================
-- 02: cadastro multiempresa e vínculos comerciais
-- Ref.: §4.1 (multiempresa), §8 (ciclo de sinergia), RNF-001
-- =====================================================================

create table if not exists empresas (
  id                uuid primary key default gen_random_uuid(),
  cnpj              text not null unique check (cnpj ~ '^[0-9]{14}$'),
  razao_social      text not null,
  nome_fantasia     text,
  cnae_principal    text,
  cnae_descricao    text,
  uf                char(2),
  municipio         text,
  regime            regime_tributario,
  tipo_operacao     tipo_operacao not null,
  perfil_setorial   text not null
                    check (perfil_setorial in ('isp','distribuidor_telecom')),
  faturamento_anual numeric(16,2),
  qtd_assinantes    integer,
  origem_cadastro   text default 'brasilapi'
                    check (origem_cadastro in ('brasilapi','manual')),
  criado_por        uuid references auth.users(id),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on column empresas.cnpj is
  'Somente dígitos, 14 posições — zeros à esquerda preservados (fix herdado do 15.042).';
comment on column empresas.origem_cadastro is
  '§4.1 princípio 3: degradação graciosa — BrasilAPI indisponível cai para entrada manual.';

-- Vínculo usuário ↔ empresa: base de todo o RLS
create table if not exists empresa_membros (
  empresa_id uuid not null references empresas(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  papel      papel_membro not null default 'operador',
  criado_em  timestamptz not null default now(),
  primary key (empresa_id, user_id)
);

create index if not exists empresa_membros_user_idx on empresa_membros (user_id);

-- Vínculo comercial distribuidor ↔ ISP (§8). Só com consentimento (RNF-001).
create table if not exists vinculos_comerciais (
  id               uuid primary key default gen_random_uuid(),
  distribuidor_id  uuid not null references empresas(id) on delete cascade,
  isp_id           uuid not null references empresas(id) on delete cascade,
  consentido       boolean not null default false,
  consentido_em    timestamptz,
  consentido_por   uuid references auth.users(id),
  rateio_isp_pct   numeric(5,2) not null default 50.00
                   check (rateio_isp_pct between 0 and 100),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (distribuidor_id, isp_id),
  check (distribuidor_id <> isp_id)
);

create index if not exists vinculos_dist_idx on vinculos_comerciais (distribuidor_id);
create index if not exists vinculos_isp_idx  on vinculos_comerciais (isp_id);

comment on column vinculos_comerciais.rateio_isp_pct is
  '§8: regra de rateio do ativo de carbono por lote. Default 50/50, configurável por contrato.';

-- Unidades consumidoras / POPs (RF-ISP-002; também CD do distribuidor)
create table if not exists unidades_consumidoras (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  apelido       text not null,
  codigo_uc     text,
  distribuidora text,
  uf            char(2),
  municipio     text,
  tipo          text not null default 'pop'
                check (tipo in ('pop','headend','datacenter','escritorio','cd')),
  tem_gd_solar  boolean not null default false,
  potencia_gd_kwp numeric(10,2),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, codigo_uc)
);

create index if not exists uc_empresa_idx on unidades_consumidoras (empresa_id);

create trigger tg_empresas_touch
  before update on empresas
  for each row execute function private.fn_touch();

create trigger tg_vinculos_touch
  before update on vinculos_comerciais
  for each row execute function private.fn_touch();

create trigger tg_uc_touch
  before update on unidades_consumidoras
  for each row execute function private.fn_touch();
