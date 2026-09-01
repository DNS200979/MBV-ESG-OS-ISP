-- =====================================================================
-- 08: criador sempre enxerga a empresa que criou.
--
-- Motivo: INSERT ... RETURNING (usado pelo PostgREST em
-- `Prefer: return=representation`) exige que a linha devolvida passe na
-- policy de SELECT. O vínculo de membro nasce num gatilho AFTER INSERT,
-- que só dispara depois do RETURNING — então a policy baseada apenas em
-- empresa_membros recusava a própria criação. `criado_por = auth.uid()`
-- é semanticamente correto (o criador vira proprietário no mesmo
-- statement) e destrava o RETURNING.
-- =====================================================================

drop policy if exists empresas_sel on empresas;

create policy empresas_sel on empresas
  for select to authenticated
  using (
    criado_por = (select auth.uid())
    or (select private.pode_ver(id))
  );
