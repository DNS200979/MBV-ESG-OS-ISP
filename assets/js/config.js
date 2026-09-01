/* =====================================================================
 * Configuração pública do cliente.
 *
 * A chave abaixo é a PUBLISHABLE (anon) do Supabase — ela É pública por
 * projeto e pode ficar no repositório: o que protege os dados é a RLS
 * (supabase/migrations/20260901000600_rls.sql), não o sigilo da chave.
 *
 * ⛔ NUNCA coloque aqui a `service_role` / secret key: ela ignora RLS.
 *
 * Para testar sem commitar credenciais, rode no console do navegador:
 *   localStorage.setItem('cf.supabaseUrl', 'https://xxxx.supabase.co')
 *   localStorage.setItem('cf.supabaseKey', 'sb_publishable_...')
 * ===================================================================== */

const sobrescrita = (chave) => {
  try { return localStorage.getItem(chave) || null; } catch { return null; }
};

export const CONFIG = {
  supabaseUrl: sobrescrita('cf.supabaseUrl') || 'https://kyrivjhglgtxwecovtcd.supabase.co',
  supabaseKey: sobrescrita('cf.supabaseKey') || 'sb_publishable_5Fj4eRcyn2dR6b210zDGHw_6R6JCbF9',

  // §4: BrasilAPI para CNPJ → CNAE → setor, com degradação graciosa
  brasilApiCnpj: 'https://brasilapi.com.br/api/cnpj/v1/',

  // Bucket do Storage onde os documentos-fonte originais são preservados
  bucketDocumentos: 'documentos-fonte',

  versao: '0.1.0',
};

export const configurado = () =>
  !CONFIG.supabaseUrl.includes('SEU-PROJETO') &&
  !CONFIG.supabaseKey.includes('SUA_CHAVE');
