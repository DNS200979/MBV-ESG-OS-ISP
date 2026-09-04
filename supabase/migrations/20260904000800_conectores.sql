-- =====================================================================
-- 18: conectores de ERP/CRM e registro de importações
--
-- O conector existe para que o ERP do cliente empurre dados sem que
-- ninguém cole planilha à mão. Três decisões estruturais:
--
--  1. O token NUNCA é guardado em claro — só o SHA-256 e um prefixo
--     para o usuário reconhecer qual é qual na tela.
--  2. Todo lote importado vira `importacoes` com relatório linha a linha
--     (§10: importação não falha em silêncio).
--  3. Escopo por conector: um conector de produtos não escreve ativos.
-- =====================================================================

create table if not exists conectores (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  nome            text not null,
  tipo            text not null default 'erp'
                  check (tipo in ('erp','crm','wms','planilha','webhook','outro')),
  sistema         text,
  token_hash      text not null,
  token_prefixo   text not null,
  escopos         text[] not null default '{produtos}',
  ativo           boolean not null default true,
  ultima_sync     timestamptz,
  total_recebido  integer not null default 0,
  criado_por      uuid references auth.users(id),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (empresa_id, nome)
);

create unique index if not exists conectores_token_idx on conectores (token_hash);
create index if not exists conectores_empresa_idx on conectores (empresa_id, ativo);

comment on column conectores.token_hash is
  'SHA-256 do token. O valor em claro é exibido uma única vez na criação — '
  'perdeu, gera outro. Guardar em claro transformaria um vazamento de banco '
  'em acesso de escrita à conta do cliente.';
comment on column conectores.escopos is
  'Alvos que este conector pode escrever: produtos, ativos, '
  'unidades_consumidoras, pesos_referencia, destinadores, portfolio_ncm.';

create table if not exists importacoes (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  conector_id        uuid references conectores(id) on delete set null,
  origem             text not null check (origem in ('csv','xlsx','xml','api','manual')),
  alvo               text not null,
  nome_arquivo       text,
  documento_fonte_id uuid references documentos_fonte(id) on delete set null,
  total_linhas       integer not null default 0,
  criados            integer not null default 0,
  atualizados        integer not null default 0,
  ignorados          integer not null default 0,
  erros              integer not null default 0,
  relatorio          jsonb  not null default '[]'::jsonb,
  status             text not null default 'concluida'
                     check (status in ('processando','concluida','falhou','parcial')),
  criado_por         uuid references auth.users(id),
  criado_em          timestamptz not null default now()
);

create index if not exists importacoes_empresa_idx  on importacoes (empresa_id, criado_em desc);
create index if not exists importacoes_conector_idx on importacoes (conector_id);
create index if not exists importacoes_doc_idx      on importacoes (documento_fonte_id);

comment on column importacoes.relatorio is
  '§10 — erro linha a linha. [{"linha":12,"erro":"NCM inválido","dados":{...}}]';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table conectores  enable row level security;
alter table importacoes enable row level security;

grant select, insert, update, delete on conectores  to authenticated;
grant select, insert                 on importacoes to authenticated;

create policy conectores_sel on conectores
  for select to authenticated using ((select private.pode_ver(empresa_id)));
create policy conectores_ins on conectores
  for insert to authenticated with check ((select private.pode_editar(empresa_id)));
create policy conectores_upd on conectores
  for update to authenticated
  using ((select private.pode_editar(empresa_id)))
  with check ((select private.pode_editar(empresa_id)));
create policy conectores_del on conectores
  for delete to authenticated using ((select private.pode_editar(empresa_id)));

-- Importação é registro do que aconteceu: nasce e não se reescreve.
create policy importacoes_sel on importacoes
  for select to authenticated using ((select private.pode_ver(empresa_id)));
create policy importacoes_ins on importacoes
  for insert to authenticated with check ((select private.pode_editar(empresa_id)));

create trigger tg_conectores_touch
  before update on conectores
  for each row execute function private.fn_touch();
create trigger tg_aud_conectores
  after insert or update or delete on conectores
  for each row execute function private.fn_auditoria();

-- ---------------------------------------------------------------------
-- Autenticação do conector: recebe o token, devolve empresa e escopos.
-- SECURITY DEFINER porque precisa ler conectores sem sessão de usuário —
-- é a Edge Function chamando em nome de um sistema externo.
-- ---------------------------------------------------------------------
create or replace function private.autenticar_conector(p_token text)
returns table (conector_id uuid, empresa_id uuid, escopos text[])
language sql
security definer
set search_path = ''
as $$
  update public.conectores c
     set ultima_sync = now()
   -- sha256() nativo do Postgres: não depende de onde o pgcrypto mora
   -- (public no Postgres puro, schema extensions no Supabase).
   where c.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and c.ativo
  returning c.id, c.empresa_id, c.escopos;
$$;

revoke execute on function private.autenticar_conector(text) from public, anon, authenticated;
