-- =====================================================================
-- 10: alertas de prazo (§7.3 — condicionantes TTD, habilitações)
--
-- Um job diário do pg_cron marca condicionantes vencidas como
-- 'atrasada' e materializa alertas com antecedência de 30 dias.
-- A geração fica numa função separada para: (a) testes chamarem direto
-- sem cron; (b) o agendamento ser guardado — em ambiente sem pg_cron
-- (CI/local) a migração aplica mesmo assim, só sem o job.
-- =====================================================================

create table if not exists alertas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  tipo          text not null default 'condicionante_ttd'
                check (tipo in ('condicionante_ttd','habilitacao_reforma','outro')),
  referencia_id uuid,
  titulo        text not null,
  detalhe       text,
  prazo         date,
  severidade    text not null default 'aviso'
                check (severidade in ('info','aviso','critico')),
  lido          boolean not null default false,
  criado_em     timestamptz not null default now(),
  -- NULLS NOT DISTINCT: alerta sem referência/prazo (ex.: reforma)
  -- também deduplica — senão cada execução do job criaria outro
  unique nulls not distinct (empresa_id, tipo, referencia_id, prazo)
);

create index if not exists alertas_empresa_idx on alertas (empresa_id, lido, prazo);

alter table alertas enable row level security;

-- Migração 06 concedeu grants apenas nas tabelas existentes à época
grant select, update on alertas to authenticated;

create policy alertas_sel on alertas
  for select to authenticated
  using ((select private.pode_ver(empresa_id)));

-- update só para marcar como lido; sem policy de INSERT/DELETE —
-- quem escreve é o job (postgres), quem apaga é o cascade da empresa
create policy alertas_upd on alertas
  for update to authenticated
  using ((select private.pode_editar(empresa_id)))
  with check ((select private.pode_editar(empresa_id)));

-- ---------------------------------------------------------------------
-- Geração de alertas — idempotente por (empresa, tipo, referência, prazo)
-- ---------------------------------------------------------------------
create or replace function private.fn_gerar_alertas()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_novos integer := 0;
  v_n integer;
begin
  -- 1) condicionante pendente com prazo vencido → atrasada
  update public.condicionantes_ttd
     set status = 'atrasada'
   where status = 'pendente'
     and proximo_prazo is not null
     and proximo_prazo < current_date;

  -- 2) alertas para prazos vencidos (crítico) e nos próximos 30 dias (aviso)
  insert into public.alertas
    (empresa_id, tipo, referencia_id, titulo, detalhe, prazo, severidade)
  select
    c.empresa_id,
    'condicionante_ttd',
    c.id,
    case when c.status = 'atrasada'
      then 'Condicionante ATRASADA: ' || c.enquadramento
      else 'Condicionante vence em breve: ' || c.enquadramento end,
    c.descricao,
    c.proximo_prazo,
    case when c.status = 'atrasada' then 'critico' else 'aviso' end
  from public.condicionantes_ttd c
  where c.status in ('pendente','atrasada')
    and c.proximo_prazo is not null
    and c.proximo_prazo <= current_date + 30
  on conflict (empresa_id, tipo, referencia_id, prazo) do nothing;

  get diagnostics v_n = row_count;
  v_novos := v_novos + v_n;

  -- 3) benefício exposto à reforma sem tese de compensação em andamento:
  --    empresa com economia realizada em DI e sem FUNDO_COMPENSACAO no funil
  insert into public.alertas
    (empresa_id, tipo, referencia_id, titulo, detalhe, prazo, severidade)
  select distinct
    d.empresa_id,
    'habilitacao_reforma',
    null::uuid,
    'Benefício de ICMS em uso sem tese de compensação no funil',
    'Há economia realizada em DI, mas o incentivo "Fundo de Compensação" '
      || 'não está em qualificação. Benefícios de ICMS são reduzidos a partir '
      || 'de 2029 e a compensação exige habilitação prévia (EC 132/2023).',
    null::date,
    'aviso'
  from public.declaracoes_importacao d
  where coalesce(d.economia_realizada, 0) > 0
    and not exists (
      select 1
      from public.incentivos_empresa ie
      join public.incentivos_catalogo ic on ic.id = ie.incentivo_id
      where ie.empresa_id = d.empresa_id
        and ic.codigo = 'FUNDO_COMPENSACAO'
    )
  on conflict (empresa_id, tipo, referencia_id, prazo) do nothing;

  get diagnostics v_n = row_count;
  return v_novos + v_n;
end;
$$;

revoke execute on function private.fn_gerar_alertas() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Agendamento diário (09:00 UTC ≈ 06:00 de Brasília), guardado
-- ---------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('mbv-alertas-diarios')
    where exists (select 1 from cron.job where jobname = 'mbv-alertas-diarios');
  perform cron.schedule('mbv-alertas-diarios', '0 9 * * *',
                        'select private.fn_gerar_alertas()');
  raise notice 'pg_cron: job mbv-alertas-diarios agendado (0 9 * * *).';
exception when others then
  raise notice 'pg_cron indisponível neste ambiente (%) — job não agendado; '
               'a função private.fn_gerar_alertas() segue utilizável.', sqlerrm;
end $$;
