-- =====================================================================
-- ERP CarbonFree Telecom — F0 Fundação
-- 01: extensões, schema privado, tipos, auditoria
-- Ref.: docs/ESPECIFICACAO.md §9, §11 (RNF-002, RNF-005)
-- =====================================================================

create extension if not exists pgcrypto;

-- Schema privado: helpers SECURITY DEFINER nunca ficam expostos na Data API
create schema if not exists private;
-- `private` nunca entra em "Exposed schemas" da Data API. USAGE é concedido a
-- `authenticated` apenas onde uma policy precisa resolver o helper (ver 06_rls).
revoke all on schema private from public, anon;

-- ---------------------------------------------------------------------
-- Domínios / tipos
-- ---------------------------------------------------------------------
do $$ begin
  create type tipo_operacao as enum ('isp','distribuidor','hibrido');
exception when duplicate_object then null; end $$;

do $$ begin
  create type regime_tributario as enum ('simples','presumido','real');
exception when duplicate_object then null; end $$;

do $$ begin
  create type papel_membro as enum ('proprietario','gestor','operador','leitor','parceiro_licenciado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type natureza_lancamento as enum ('ativo','passivo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_validacao as enum ('nao_validado','em_validacao','validado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_reforma as enum ('sobrevive','extinto_2032','substituido','indefinido');
exception when duplicate_object then null; end $$;

do $$ begin
  create type etapa_funil as enum ('triagem','elegivel','dossie','validacao_parceiro','ativo','negado');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Trilha de auditoria (RNF-005)
-- ---------------------------------------------------------------------
create table if not exists auditoria (
  id           bigint generated always as identity primary key,
  empresa_id   uuid,
  ator_id      uuid,
  tabela       text        not null,
  registro_id  text,
  operacao     text        not null check (operacao in ('INSERT','UPDATE','DELETE')),
  dados_antes  jsonb,
  dados_depois jsonb,
  ocorrido_em  timestamptz not null default now()
);

create index if not exists auditoria_empresa_idx on auditoria (empresa_id, ocorrido_em desc);
create index if not exists auditoria_tabela_idx  on auditoria (tabela, registro_id);

comment on table auditoria is
  'RNF-005: trilha completa (quem, quando, o quê). Append-only, sem UPDATE/DELETE.';

-- Gatilho genérico de auditoria; anexado por tabela no fim das migrações
create or replace function private.fn_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_id      text;
begin
  begin
    v_empresa := coalesce(
      (to_jsonb(new) ->> 'empresa_id')::uuid,
      (to_jsonb(old) ->> 'empresa_id')::uuid
    );
  exception when others then v_empresa := null;
  end;

  v_id := coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id');

  insert into public.auditoria
    (empresa_id, ator_id, tabela, registro_id, operacao, dados_antes, dados_depois)
  values (
    v_empresa,
    auth.uid(),
    tg_table_name,
    v_id,
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );

  return coalesce(new, old);
end;
$$;

revoke execute on function private.fn_auditoria() from public, anon, authenticated;

-- Gatilho de imutabilidade probatória (RNF-002)
create or replace function private.fn_bloqueia_alteracao()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Registro imutável (RNF-002): documento-fonte não é editado, apenas versionado.';
end;
$$;

revoke execute on function private.fn_bloqueia_alteracao() from public, anon, authenticated;

-- Utilitário: atualiza `atualizado_em`
create or replace function private.fn_touch()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

revoke execute on function private.fn_touch() from public, anon, authenticated;
