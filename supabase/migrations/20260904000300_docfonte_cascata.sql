-- =====================================================================
-- 13: imutabilidade do documento-fonte × remoção da empresa
--
-- O gatilho da migração 03 bloqueia UPDATE e DELETE em documentos_fonte.
-- Bloquear DELETE indiscriminadamente impede a remoção em cascata de uma
-- empresa — o que colide com RNF-007 (portabilidade/export completo) e
-- com o direito de eliminação da LGPD (Lei 13.709/2018).
--
-- Discriminador correto: um documento só pode desaparecer junto com o
-- tenant inteiro. Em ON DELETE CASCADE o Postgres remove o pai antes de
-- propagar, então "a empresa não existe mais" identifica exatamente esse
-- caso — e nunca a remoção avulsa de uma prova.
-- =====================================================================

create or replace function private.fn_bloqueia_alteracao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- cascata da empresa: o pai já saiu nesta mesma transação
    if not exists (select 1 from public.empresas e where e.id = old.empresa_id) then
      return old;
    end if;
    raise exception
      'Documento-fonte não pode ser excluído (RNF-002). Ele só desaparece com a '
      'remoção da empresa inteira (portabilidade/LGPD).';
  end if;

  raise exception
    'Registro imutável (RNF-002): documento-fonte não é editado, apenas versionado.';
end;
$$;

revoke execute on function private.fn_bloqueia_alteracao() from public, anon, authenticated;
