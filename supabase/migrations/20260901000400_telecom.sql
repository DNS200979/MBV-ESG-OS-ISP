-- =====================================================================
-- 04: tabelas dos módulos ISP e Distribuidor
-- Ref.: §6.4, §7.4, §8, §9
-- =====================================================================

-- ---------------------------------------------------------------------
-- Comodato / ciclo de vida de equipamentos (RF-ISP-004, §8)
-- ---------------------------------------------------------------------
create table if not exists ativos_equipamento (
  id                   uuid primary key default gen_random_uuid(),
  serial               text not null,
  modelo               text,
  fabricante           text,
  ncm                  text check (ncm is null or ncm ~ '^[0-9]{8}$'),
  distribuidor_id      uuid references empresas(id),
  isp_id               uuid references empresas(id),
  estado               text not null default 'novo'
                       check (estado in ('novo','em_campo','retorno','refurb','descarte')),
  documento_entrada_id uuid references documentos_fonte(id),
  lote_reversa_id      uuid,
  ciclos_refurb        smallint not null default 0,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  unique (serial)
);

create index if not exists ativos_isp_idx    on ativos_equipamento (isp_id, estado);
create index if not exists ativos_dist_idx   on ativos_equipamento (distribuidor_id, estado);
create index if not exists ativos_doc_idx    on ativos_equipamento (documento_entrada_id);
create index if not exists ativos_lote_idx   on ativos_equipamento (lote_reversa_id);

-- Histórico de estados (auditoria do ciclo de vida)
create table if not exists ativos_historico (
  id           bigint generated always as identity primary key,
  ativo_id     uuid not null references ativos_equipamento(id) on delete cascade,
  estado_de    text,
  estado_para  text not null,
  documento_id uuid references documentos_fonte(id),
  ator_id      uuid references auth.users(id),
  ocorrido_em  timestamptz not null default now()
);

create index if not exists ativos_hist_idx on ativos_historico (ativo_id, ocorrido_em desc);

-- ---------------------------------------------------------------------
-- Logística reversa (RF-DIST-006, PNRS)
-- ---------------------------------------------------------------------
create table if not exists lotes_reversa (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references empresas(id) on delete cascade,
  isp_parceiro_id  uuid references empresas(id),
  identificacao    text,
  peso_kg          numeric(12,2) not null check (peso_kg > 0),
  qtd_equipamentos integer,
  destinador_cnpj  text check (destinador_cnpj is null or destinador_cnpj ~ '^[0-9]{14}$'),
  destinador_nome  text,
  mtr_id           uuid references documentos_fonte(id),
  cdf_id           uuid references documentos_fonte(id),
  status           text not null default 'coleta'
                   check (status in ('coleta','transporte','destinado','certificado')),
  rateio_isp_pct   numeric(5,2) not null default 50.00
                   check (rateio_isp_pct between 0 and 100),
  coletado_em      date,
  destinado_em     date,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  -- não se declara destinado sem CDF: o lastro probatório é a regra do produto
  constraint lote_destinado_exige_cdf
    check (status not in ('destinado','certificado') or cdf_id is not null)
);

create index if not exists lotes_empresa_idx on lotes_reversa (empresa_id, status);
create index if not exists lotes_isp_idx     on lotes_reversa (isp_parceiro_id);
create index if not exists lotes_mtr_idx     on lotes_reversa (mtr_id);
create index if not exists lotes_cdf_idx     on lotes_reversa (cdf_id);

alter table ativos_equipamento
  drop constraint if exists ativos_lote_fk,
  add constraint ativos_lote_fk
    foreign key (lote_reversa_id) references lotes_reversa(id) on delete set null;

create table if not exists certificados_reciclagem (
  id             uuid primary key default gen_random_uuid(),
  lote_id        uuid not null references lotes_reversa(id) on delete cascade,
  tipo           text not null default 'credito_reciclagem',
  base_legal     text default 'Decreto 11.413/2023 (Recicla+)',
  quantidade     numeric(12,2) not null check (quantidade > 0),
  unidade        text not null default 'kg',
  numero_externo text,
  emitido_em     date,
  criado_em      timestamptz not null default now()
);

create index if not exists certif_lote_idx on certificados_reciclagem (lote_id);

-- ---------------------------------------------------------------------
-- Importação: DI, NCM, ex-tarifário, condicionantes de TTD (RF-DIST-003/004/005)
-- ---------------------------------------------------------------------
create table if not exists declaracoes_importacao (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references empresas(id) on delete cascade,
  numero_di             text not null,
  data_registro         date not null,
  uf_desembaraco        char(2),
  valor_aduaneiro       numeric(16,2) not null check (valor_aduaneiro >= 0),
  ii_devido             numeric(16,2) default 0,
  ipi_devido            numeric(16,2) default 0,
  icms_sem_beneficio    numeric(16,2) default 0,
  icms_com_beneficio    numeric(16,2) default 0,
  economia_realizada    numeric(16,2)
                        generated always as (icms_sem_beneficio - icms_com_beneficio) stored,
  enquadramento         text,   -- ex.: TTD 409 / 410 / 411
  documento_fonte_id    uuid references documentos_fonte(id),
  memoria_calculo       jsonb not null default '{}'::jsonb,
  criado_em             timestamptz not null default now(),
  unique (empresa_id, numero_di)
);

create index if not exists di_empresa_idx on declaracoes_importacao (empresa_id, data_registro desc);
create index if not exists di_doc_idx     on declaracoes_importacao (documento_fonte_id);

create table if not exists di_itens (
  id          bigint generated always as identity primary key,
  di_id       uuid not null references declaracoes_importacao(id) on delete cascade,
  ncm         text not null check (ncm ~ '^[0-9]{8}$'),
  descricao   text,
  quantidade  numeric(14,4),
  valor_item  numeric(16,2)
);

create index if not exists di_itens_di_idx  on di_itens (di_id);
create index if not exists di_itens_ncm_idx on di_itens (ncm);

create table if not exists portfolio_ncm (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas(id) on delete cascade,
  ncm          text not null check (ncm ~ '^[0-9]{8}$'),
  descricao    text not null,
  volume_anual numeric(16,2),
  criado_em    timestamptz not null default now(),
  unique (empresa_id, ncm)
);

create index if not exists portfolio_empresa_idx on portfolio_ncm (empresa_id);
create index if not exists portfolio_ncm_idx     on portfolio_ncm (ncm);

-- Catálogo global (leitura para autenticados; escrita apenas service_role)
create table if not exists ex_tarifario_pleitos (
  id            uuid primary key default gen_random_uuid(),
  ncm           text not null check (ncm ~ '^[0-9]{8}$'),
  descricao     text not null,
  ato_normativo text,
  aliquota_ii_reduzida numeric(5,2),
  vigencia_ini  date,
  vigencia_fim  date,
  validacao     status_validacao not null default 'nao_validado',
  criado_em     timestamptz not null default now()
);

create index if not exists extarif_ncm_idx on ex_tarifario_pleitos (ncm, vigencia_fim);

create table if not exists condicionantes_ttd (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  enquadramento  text not null,
  descricao      text not null,
  periodicidade  text check (periodicidade in ('mensal','trimestral','anual','unica')),
  proximo_prazo  date,
  status         text not null default 'pendente'
                 check (status in ('pendente','cumprida','atrasada','dispensada')),
  evidencia_id   uuid references documentos_fonte(id),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create index if not exists ttd_empresa_prazo_idx on condicionantes_ttd (empresa_id, proximo_prazo);
create index if not exists ttd_evidencia_idx     on condicionantes_ttd (evidencia_id);

-- ---------------------------------------------------------------------
-- Projetos de P&D — Lei do Bem (RF-ISP-008)
-- ---------------------------------------------------------------------
create table if not exists projetos_pd (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  titulo             text not null,
  exercicio          smallint not null,
  descricao_tecnica  text,
  elemento_tecnologico text,
  barreira_tecnica   text,
  horas_alocadas     numeric(12,2) default 0,
  dispendio_total    numeric(16,2) default 0,
  percentual_exclusao numeric(5,2) default 60.00,
  status             etapa_funil not null default 'triagem',
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create index if not exists pd_empresa_idx on projetos_pd (empresa_id, exercicio desc);

create trigger tg_ativos_touch  before update on ativos_equipamento
  for each row execute function private.fn_touch();
create trigger tg_lotes_touch   before update on lotes_reversa
  for each row execute function private.fn_touch();
create trigger tg_ttd_touch     before update on condicionantes_ttd
  for each row execute function private.fn_touch();
create trigger tg_pd_touch      before update on projetos_pd
  for each row execute function private.fn_touch();

-- `documento_id` entra no dossiê probatório (join por ativo); as demais FKs
-- para auth.users (criado_por, ator_id, fechado_por, consentido_por) ficam
-- deliberadamente sem índice: nunca são filtro de consulta e a exclusão de
-- usuário é operação rara — indexá-las só oneraria a escrita nas tabelas quentes.
create index if not exists ativos_hist_doc_idx on ativos_historico (documento_id);
