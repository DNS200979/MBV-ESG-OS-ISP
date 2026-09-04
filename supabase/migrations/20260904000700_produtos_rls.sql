-- =====================================================================
-- 17: RLS de produtos e pesos de referência
-- =====================================================================

alter table produtos          enable row level security;
alter table pesos_referencia  enable row level security;

grant select, insert, update, delete on produtos         to authenticated;
grant select, insert, update, delete on pesos_referencia to authenticated;

do $$
declare t text;
begin
  foreach t in array array['produtos','pesos_referencia'] loop
    execute format($p$
      create policy %1$s_sel on public.%1$I for select to authenticated
        using ((select private.pode_ver(empresa_id)));
    $p$, t);
    execute format($p$
      create policy %1$s_ins on public.%1$I for insert to authenticated
        with check ((select private.pode_editar(empresa_id)));
    $p$, t);
    execute format($p$
      create policy %1$s_upd on public.%1$I for update to authenticated
        using ((select private.pode_editar(empresa_id)))
        with check ((select private.pode_editar(empresa_id)));
    $p$, t);
    execute format($p$
      create policy %1$s_del on public.%1$I for delete to authenticated
        using ((select private.pode_editar(empresa_id)));
    $p$, t);
  end loop;
end $$;

create trigger tg_produtos_touch
  before update on produtos
  for each row execute function private.fn_touch();

create trigger tg_aud_produtos
  after insert or update or delete on produtos
  for each row execute function private.fn_auditoria();
