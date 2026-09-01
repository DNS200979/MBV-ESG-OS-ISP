-- =====================================================================
-- 06: Row Level Security — RNF-001
-- "RLS por empresa em todas as tabelas; distribuidor só enxerga ISPs
--  com vínculo consentido."
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers SECURITY DEFINER (schema privado, não exposto na Data API).
-- Cada um checa auth.uid() internamente; EXECUTE revogado de anon/auth.
-- ---------------------------------------------------------------------
create or replace function private.membro_de(p_empresa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.empresa_membros m
    where m.empresa_id = p_empresa
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.pode_editar(p_empresa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.empresa_membros m
    where m.empresa_id = p_empresa
      and m.user_id = (select auth.uid())
      and m.papel in ('proprietario','gestor','operador')
  );
$$;

-- Leitura ampliada: membro direto OU distribuidor com vínculo consentido
create or replace function private.pode_ver(p_empresa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.membro_de(p_empresa)
    or exists (
      select 1
      from public.vinculos_comerciais v
      join public.empresa_membros m on m.empresa_id = v.distribuidor_id
      where v.isp_id = p_empresa
        and v.consentido
        and m.user_id = (select auth.uid())
    );
$$;

-- Helpers usados DENTRO de policies: a expressão da policy é avaliada com os
-- privilégios de quem consulta, então `authenticated` precisa de EXECUTE.
-- A proteção não vem do revoke e sim do schema `private` NÃO estar na lista de
-- schemas expostos do PostgREST (Data API) — logo nada aqui é chamável via API.
revoke execute on function private.membro_de(uuid)   from public, anon;
revoke execute on function private.pode_editar(uuid) from public, anon;
revoke execute on function private.pode_ver(uuid)    from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.membro_de(uuid)   to authenticated;
grant execute on function private.pode_editar(uuid) to authenticated;
grant execute on function private.pode_ver(uuid)    to authenticated;

-- Ao criar uma empresa, o autor vira proprietário (senão ninguém a enxerga)
create or replace function private.fn_membro_inicial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.empresa_membros (empresa_id, user_id, papel)
  values (new.id, auth.uid(), 'proprietario')
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function private.fn_membro_inicial() from public, anon, authenticated;

create trigger tg_empresa_membro_inicial
  after insert on empresas
  for each row execute function private.fn_membro_inicial();

-- ---------------------------------------------------------------------
-- Habilita RLS em TODAS as tabelas do schema public
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    -- Só ENABLE: FORCE sujeitaria o owner às policies e quebraria os
    -- gatilhos SECURITY DEFINER (auditoria, membro inicial).
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Grants para a Data API (RLS continua sendo quem filtra as linhas)
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------
-- Catálogos globais: leitura para autenticados, escrita só service_role
-- (service_role tem BYPASSRLS — nenhuma policy de escrita é criada)
-- ---------------------------------------------------------------------
create policy cat_incentivos_sel on incentivos_catalogo
  for select to authenticated using (true);

create policy cat_fatores_sel on fatores_emissao
  for select to authenticated using (true);

create policy cat_extarif_sel on ex_tarifario_pleitos
  for select to authenticated using (true);

create policy cat_reforma_sel on reforma_transicao
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- empresas
-- ---------------------------------------------------------------------
create policy empresas_sel on empresas
  for select to authenticated
  using ((select private.pode_ver(id)));

create policy empresas_ins on empresas
  for insert to authenticated
  with check (criado_por = (select auth.uid()));

create policy empresas_upd on empresas
  for update to authenticated
  using ((select private.pode_editar(id)))
  with check ((select private.pode_editar(id)));

create policy empresas_del on empresas
  for delete to authenticated
  using (exists (
    select 1 from empresa_membros m
    where m.empresa_id = empresas.id
      and m.user_id = (select auth.uid())
      and m.papel = 'proprietario'
  ));

-- ---------------------------------------------------------------------
-- empresa_membros
-- ---------------------------------------------------------------------
create policy membros_sel on empresa_membros
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.membro_de(empresa_id)));

create policy membros_ins on empresa_membros
  for insert to authenticated
  with check (exists (
    select 1 from empresa_membros m
    where m.empresa_id = empresa_membros.empresa_id
      and m.user_id = (select auth.uid())
      and m.papel in ('proprietario','gestor')
  ));

create policy membros_upd on empresa_membros
  for update to authenticated
  using ((select private.pode_editar(empresa_id)))
  with check ((select private.pode_editar(empresa_id)));

create policy membros_del on empresa_membros
  for delete to authenticated
  using ((select private.pode_editar(empresa_id)));

-- ---------------------------------------------------------------------
-- vinculos_comerciais — o consentimento é do ISP
-- ---------------------------------------------------------------------
create policy vinculos_sel on vinculos_comerciais
  for select to authenticated
  using ((select private.membro_de(distribuidor_id))
      or (select private.membro_de(isp_id)));

create policy vinculos_ins on vinculos_comerciais
  for insert to authenticated
  with check (
    ((select private.pode_editar(distribuidor_id)) or (select private.pode_editar(isp_id)))
    -- vínculo nasce sempre pendente; o ISP consente depois
    and consentido = false
  );

create policy vinculos_upd on vinculos_comerciais
  for update to authenticated
  using ((select private.pode_editar(distribuidor_id))
      or (select private.pode_editar(isp_id)))
  with check ((select private.pode_editar(distribuidor_id))
           or (select private.pode_editar(isp_id)));

-- RNF-001: o consentimento é ato do ISP. O distribuidor pode ajustar rateio,
-- mas nunca se autoconceder acesso. Regra em gatilho (WITH CHECK não consegue
-- comparar OLD x NEW sem subconsulta recursiva na própria tabela).
create or replace function private.fn_consentimento_isp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.consentido is distinct from old.consentido
     and not private.pode_editar(new.isp_id) then
    raise exception
      'Somente o ISP (%) pode conceder ou revogar o consentimento de acesso (RNF-001).',
      new.isp_id;
  end if;

  if new.consentido and not old.consentido then
    new.consentido_em  := now();
    new.consentido_por := auth.uid();
  elsif not new.consentido then
    new.consentido_em  := null;
    new.consentido_por := null;
  end if;

  return new;
end;
$fn$;

revoke execute on function private.fn_consentimento_isp() from public, anon, authenticated;

create trigger tg_vinculo_consentimento
  before update on vinculos_comerciais
  for each row execute function private.fn_consentimento_isp();

create policy vinculos_del on vinculos_comerciais
  for delete to authenticated
  using ((select private.pode_editar(distribuidor_id))
      or (select private.pode_editar(isp_id)));

-- ---------------------------------------------------------------------
-- Tabelas com empresa_id: padrão ver/editar
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'unidades_consumidoras','lancamentos_carbono','fechamentos_mensais',
    'declaracoes_importacao','portfolio_ncm','condicionantes_ttd',
    'projetos_pd','incentivos_empresa','simulacoes_tributarias'
  ] loop
    execute format($p$
      create policy %1$s_sel on public.%1$I
        for select to authenticated
        using ((select private.pode_ver(empresa_id)));
    $p$, t);

    execute format($p$
      create policy %1$s_ins on public.%1$I
        for insert to authenticated
        with check ((select private.pode_editar(empresa_id)));
    $p$, t);

    execute format($p$
      create policy %1$s_upd on public.%1$I
        for update to authenticated
        using ((select private.pode_editar(empresa_id)))
        with check ((select private.pode_editar(empresa_id)));
    $p$, t);

    execute format($p$
      create policy %1$s_del on public.%1$I
        for delete to authenticated
        using ((select private.pode_editar(empresa_id)));
    $p$, t);
  end loop;
end $$;

-- lancamentos_carbono: sem UPDATE/DELETE — correção é estorno (§1.2)
drop policy if exists lancamentos_carbono_upd on lancamentos_carbono;
drop policy if exists lancamentos_carbono_del on lancamentos_carbono;

-- ---------------------------------------------------------------------
-- documentos_fonte — RNF-002: só SELECT e INSERT
-- ---------------------------------------------------------------------
create policy docfonte_sel on documentos_fonte
  for select to authenticated
  using ((select private.pode_ver(empresa_id)));

create policy docfonte_ins on documentos_fonte
  for insert to authenticated
  with check ((select private.pode_editar(empresa_id))
              and criado_por = (select auth.uid()));

-- ---------------------------------------------------------------------
-- ativos_equipamento — visível aos dois lados do comodato (§8)
-- ---------------------------------------------------------------------
create policy ativos_sel on ativos_equipamento
  for select to authenticated
  using ((isp_id is not null and (select private.pode_ver(isp_id)))
      or (distribuidor_id is not null and (select private.pode_ver(distribuidor_id))));

create policy ativos_ins on ativos_equipamento
  for insert to authenticated
  with check ((isp_id is not null and (select private.pode_editar(isp_id)))
           or (distribuidor_id is not null and (select private.pode_editar(distribuidor_id))));

create policy ativos_upd on ativos_equipamento
  for update to authenticated
  using ((isp_id is not null and (select private.pode_editar(isp_id)))
      or (distribuidor_id is not null and (select private.pode_editar(distribuidor_id))))
  with check ((isp_id is not null and (select private.pode_editar(isp_id)))
           or (distribuidor_id is not null and (select private.pode_editar(distribuidor_id))));

create policy ativos_hist_sel on ativos_historico
  for select to authenticated
  using (exists (
    select 1 from ativos_equipamento a
    where a.id = ativos_historico.ativo_id
      and ((a.isp_id is not null and (select private.pode_ver(a.isp_id)))
        or (a.distribuidor_id is not null and (select private.pode_ver(a.distribuidor_id))))
  ));

create policy ativos_hist_ins on ativos_historico
  for insert to authenticated
  with check (exists (
    select 1 from ativos_equipamento a
    where a.id = ativos_historico.ativo_id
      and ((a.isp_id is not null and (select private.pode_editar(a.isp_id)))
        or (a.distribuidor_id is not null and (select private.pode_editar(a.distribuidor_id))))
  ));

-- ---------------------------------------------------------------------
-- lotes_reversa — dono + ISP parceiro do rateio
-- ---------------------------------------------------------------------
create policy lotes_sel on lotes_reversa
  for select to authenticated
  using ((select private.pode_ver(empresa_id))
      or (isp_parceiro_id is not null and (select private.membro_de(isp_parceiro_id))));

create policy lotes_ins on lotes_reversa
  for insert to authenticated
  with check ((select private.pode_editar(empresa_id)));

create policy lotes_upd on lotes_reversa
  for update to authenticated
  using ((select private.pode_editar(empresa_id)))
  with check ((select private.pode_editar(empresa_id)));

create policy lotes_del on lotes_reversa
  for delete to authenticated
  using ((select private.pode_editar(empresa_id)));

create policy certif_sel on certificados_reciclagem
  for select to authenticated
  using (exists (
    select 1 from lotes_reversa l
    where l.id = certificados_reciclagem.lote_id
      and ((select private.pode_ver(l.empresa_id))
        or (l.isp_parceiro_id is not null and (select private.membro_de(l.isp_parceiro_id))))
  ));

create policy certif_ins on certificados_reciclagem
  for insert to authenticated
  with check (exists (
    select 1 from lotes_reversa l
    where l.id = certificados_reciclagem.lote_id
      and (select private.pode_editar(l.empresa_id))
  ));

-- ---------------------------------------------------------------------
-- di_itens — segue a DI
-- ---------------------------------------------------------------------
create policy di_itens_sel on di_itens
  for select to authenticated
  using (exists (
    select 1 from declaracoes_importacao d
    where d.id = di_itens.di_id and (select private.pode_ver(d.empresa_id))
  ));

create policy di_itens_ins on di_itens
  for insert to authenticated
  with check (exists (
    select 1 from declaracoes_importacao d
    where d.id = di_itens.di_id and (select private.pode_editar(d.empresa_id))
  ));

create policy di_itens_del on di_itens
  for delete to authenticated
  using (exists (
    select 1 from declaracoes_importacao d
    where d.id = di_itens.di_id and (select private.pode_editar(d.empresa_id))
  ));

-- ---------------------------------------------------------------------
-- auditoria — leitura apenas; escrita só pelo gatilho SECURITY DEFINER
-- ---------------------------------------------------------------------
create policy auditoria_sel on auditoria
  for select to authenticated
  using (empresa_id is not null and (select private.pode_ver(empresa_id)));

-- ---------------------------------------------------------------------
-- Gatilhos de auditoria nas tabelas sensíveis (RNF-005)
-- ---------------------------------------------------------------------
create trigger tg_aud_lancamentos after insert or update or delete on lancamentos_carbono
  for each row execute function private.fn_auditoria();
create trigger tg_aud_incemp      after insert or update or delete on incentivos_empresa
  for each row execute function private.fn_auditoria();
create trigger tg_aud_lotes       after insert or update or delete on lotes_reversa
  for each row execute function private.fn_auditoria();
create trigger tg_aud_di          after insert or update or delete on declaracoes_importacao
  for each row execute function private.fn_auditoria();
create trigger tg_aud_ativos      after insert or update or delete on ativos_equipamento
  for each row execute function private.fn_auditoria();
create trigger tg_aud_vinculos    after insert or update or delete on vinculos_comerciais
  for each row execute function private.fn_auditoria();
