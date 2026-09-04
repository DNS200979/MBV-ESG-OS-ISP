-- =====================================================================
-- 19: contador de registros recebidos por conector
-- Chamado pela Edge Function `ingest`. SECURITY DEFINER porque o
-- contexto é de sistema externo, não de usuário autenticado.
-- =====================================================================
create or replace function public.incrementar_recebidos(p_conector uuid, p_qtd integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conectores
     set total_recebido = total_recebido + greatest(p_qtd, 0),
         ultima_sync = now()
   where id = p_conector;
$$;

revoke execute on function public.incrementar_recebidos(uuid, integer) from public, anon, authenticated;
