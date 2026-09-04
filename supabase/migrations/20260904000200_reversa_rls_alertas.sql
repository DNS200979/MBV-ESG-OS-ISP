-- =====================================================================
-- 12: RLS das tabelas novas + alertas do ciclo de reversa
-- A migração 06 concedeu grants só nas tabelas existentes à época,
-- então cada tabela nova precisa do seu GRANT explícito.
-- =====================================================================

alter table destinadores enable row level security;
alter table triagens     enable row level security;

grant select, insert, update, delete on destinadores to authenticated;
grant select, insert                 on triagens     to authenticated;

-- --------------------------------------------------------- destinadores
create policy destinadores_sel on destinadores
  for select to authenticated
  using ((select private.pode_ver(empresa_id)));

create policy destinadores_ins on destinadores
  for insert to authenticated
  with check ((select private.pode_editar(empresa_id)));

create policy destinadores_upd on destinadores
  for update to authenticated
  using ((select private.pode_editar(empresa_id)))
  with check ((select private.pode_editar(empresa_id)));

create policy destinadores_del on destinadores
  for delete to authenticated
  using ((select private.pode_editar(empresa_id)));

-- -------------------------------------------------------------- triagens
-- Sem UPDATE/DELETE: a triagem é laudo. Errou? Nova triagem, histórico
-- preservado (mesma lógica probatória do documento-fonte, RNF-002).
create policy triagens_sel on triagens
  for select to authenticated
  using ((select private.pode_ver(empresa_id)));

create policy triagens_ins on triagens
  for insert to authenticated
  with check ((select private.pode_editar(empresa_id)));

create trigger tg_destinadores_touch
  before update on destinadores
  for each row execute function private.fn_touch();

create trigger tg_aud_triagens
  after insert on triagens
  for each row execute function private.fn_auditoria();

create trigger tg_aud_destinadores
  after insert or update or delete on destinadores
  for each row execute function private.fn_auditoria();

-- =====================================================================
-- Alertas do ciclo de reversa
-- =====================================================================
alter table alertas drop constraint if exists alertas_tipo_check;
alter table alertas add constraint alertas_tipo_check
  check (tipo in ('condicionante_ttd','habilitacao_reforma',
                  'retorno_sem_triagem','reparo_parado','licenca_vencendo',
                  'descarte_sem_lote','lote_parado','outro'));

create or replace function private.fn_gerar_alertas_reversa()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_n integer;
begin
  -- 1) Retorno parado sem triagem há mais de 15 dias.
  --    Equipamento parado é CAPEX imobilizado e ativo de carbono não realizado.
  insert into public.alertas
    (empresa_id, tipo, referencia_id, titulo, detalhe, prazo, severidade)
  select
    a.isp_id, 'retorno_sem_triagem', a.id,
    'Retorno sem triagem há ' || (current_date - a.atualizado_em::date) || ' dias: ' || a.serial,
    'Equipamento em "retorno" aguardando decisão de reparo, reposição ou descarte.',
    null::date,
    case when current_date - a.atualizado_em::date > 45 then 'critico' else 'aviso' end
  from public.ativos_equipamento a
  where a.estado = 'retorno'
    and a.isp_id is not null
    and a.atualizado_em < now() - interval '15 days'
  on conflict (empresa_id, tipo, referencia_id, prazo) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 2) Reparo estourando o prazo médio do destinador (ou 30 dias)
  insert into public.alertas
    (empresa_id, tipo, referencia_id, titulo, detalhe, prazo, severidade)
  select
    a.isp_id, 'reparo_parado', a.id,
    'Reparo fora do prazo: ' || a.serial,
    'Enviado para ' || coalesce(d.razao_social, 'assistência técnica')
      || ' e ainda não retornou. Prazo previsto: '
      || coalesce(d.prazo_medio_dias, 30) || ' dias.',
    null::date, 'aviso'
  from public.ativos_equipamento a
  join lateral (
    select t.destinador_id from public.triagens t
     where t.ativo_id = a.id order by t.triado_em desc limit 1
  ) ult on true
  left join public.destinadores d on d.id = ult.destinador_id
  where a.estado = 'reparo'
    and a.isp_id is not null
    and a.atualizado_em < now() - (coalesce(d.prazo_medio_dias, 30) || ' days')::interval
  on conflict (empresa_id, tipo, referencia_id, prazo) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 3) Licença ambiental do destinador vencida ou vencendo em 60 dias.
  --    Destinar para licença vencida não sustenta o dossiê (§4.1).
  insert into public.alertas
    (empresa_id, tipo, referencia_id, titulo, detalhe, prazo, severidade)
  select
    d.empresa_id, 'licenca_vencendo', d.id,
    case when d.licenca_validade < current_date
      then 'Licença AMBIENTAL VENCIDA: ' || d.razao_social
      else 'Licença ambiental vence em breve: ' || d.razao_social end,
    'Licença ' || coalesce(d.licenca_ambiental, '(sem número)')
      || ' — destinação sem licença vigente não sustenta o dossiê probatório.',
    d.licenca_validade,
    case when d.licenca_validade < current_date then 'critico' else 'aviso' end
  from public.destinadores d
  where d.ativo
    and d.licenca_validade is not null
    and d.licenca_validade <= current_date + 60
  on conflict (empresa_id, tipo, referencia_id, prazo) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 4) Massa parada em descarte sem lote formado (a partir de 20 unidades)
  insert into public.alertas
    (empresa_id, tipo, referencia_id, titulo, detalhe, prazo, severidade)
  select
    a.isp_id, 'descarte_sem_lote', null::uuid,
    count(*) || ' equipamentos em descarte sem lote de reversa',
    'Forme o lote para acionar o destinador: a obrigação da PNRS só se cumpre '
      || 'com MTR e CDF, e o ativo de carbono só nasce no certificado.',
    null::date, 'aviso'
  from public.ativos_equipamento a
  where a.estado = 'descarte'
    and a.lote_reversa_id is null
    and a.isp_id is not null
  group by a.isp_id
  having count(*) >= 20
  on conflict (empresa_id, tipo, referencia_id, prazo) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- 5) Lote parado em coleta/transporte há mais de 30 dias
  insert into public.alertas
    (empresa_id, tipo, referencia_id, titulo, detalhe, prazo, severidade)
  select
    l.empresa_id, 'lote_parado', l.id,
    'Lote parado em "' || l.status || '": ' || coalesce(l.identificacao, left(l.id::text, 8)),
    'Sem avanço há mais de 30 dias. Lote só chega a "destinado" com CDF anexado.',
    null::date, 'aviso'
  from public.lotes_reversa l
  where l.status in ('coleta','transporte')
    and l.atualizado_em < now() - interval '30 days'
  on conflict (empresa_id, tipo, referencia_id, prazo) do nothing;
  get diagnostics v_n = row_count;

  return v_total + v_n;
end;
$$;

revoke execute on function private.fn_gerar_alertas_reversa() from public, anon, authenticated;

-- Acopla ao job diário já existente
do $$
begin
  perform cron.unschedule('mbv-alertas-diarios')
    where exists (select 1 from cron.job where jobname = 'mbv-alertas-diarios');
  perform cron.schedule('mbv-alertas-diarios', '0 9 * * *',
    'select private.fn_gerar_alertas(); select private.fn_gerar_alertas_reversa();');
  raise notice 'pg_cron: job mbv-alertas-diarios agora cobre também a reversa.';
exception when others then
  raise notice 'pg_cron indisponível (%) — funções seguem chamáveis manualmente.', sqlerrm;
end $$;
