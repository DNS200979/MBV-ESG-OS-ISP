/* =====================================================================
 * Documento-fonte — §4.1 princípio 1:
 *   "nenhum lançamento de carbono ou de economia fiscal sem documento
 *    amarrado (hash + chave)".
 *
 * Fluxo: arquivo → SHA-256 (Web Crypto) → upload no Storage → registro
 * imutável em `documentos_fonte`. O hash é a identidade probatória; um
 * reenvio do mesmo arquivo cai no UNIQUE (empresa_id, hash_sha256) e é
 * tratado como reaproveitamento, não como erro.
 * ===================================================================== */
import { sb, usuarioAtual } from './db.js';
import { CONFIG } from './config.js';

export async function sha256(arquivo) {
  const buf = await arquivo.arrayBuffer();
  const dig = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Registra um documento-fonte. Idempotente por hash.
 * @returns {{doc: object, reaproveitado: boolean}}
 */
export async function registrarDocumento({
  empresaId, tipo, arquivo, payload = {}, chaveAcesso = null,
  inconsistencias = [], subirArquivo = true,
}) {
  const hash = await sha256(arquivo);

  const { data: existente } = await sb
    .from('documentos_fonte')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('hash_sha256', hash)
    .maybeSingle();

  if (existente) return { doc: existente, reaproveitado: true };

  let arquivoUrl = null;
  if (subirArquivo) {
    const caminho = `${empresaId}/${tipo}/${hash}-${arquivo.name}`.slice(0, 900);
    const { error } = await sb.storage
      .from(CONFIG.bucketDocumentos)
      .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type || 'application/octet-stream' });
    // Storage ausente/sem permissão não invalida a prova: o hash já está gravado.
    if (!error || error.message?.includes('exists')) arquivoUrl = caminho;
    else console.warn('Storage indisponível, seguindo só com hash:', error.message);
  }

  const u = await usuarioAtual();
  const { data, error } = await sb
    .from('documentos_fonte')
    .insert({
      empresa_id: empresaId,
      tipo,
      chave_acesso: chaveAcesso,
      hash_sha256: hash,
      payload,
      arquivo_url: arquivoUrl,
      nome_arquivo: arquivo.name,
      inconsistencias,
      criado_por: u?.id ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return { doc: data, reaproveitado: false };
}

/**
 * RNF-002: documento-fonte não é editado, apenas versionado.
 * A correção nasce como novo registro apontando para o anterior em
 * `substitui_id` — a versão original permanece íntegra e auditável.
 */
export async function versionarDocumento({ anterior, arquivo, payload = {}, inconsistencias = [] }) {
  const hash = await sha256(arquivo);
  const u = await usuarioAtual();

  const { data, error } = await sb
    .from('documentos_fonte')
    .insert({
      empresa_id: anterior.empresa_id,
      tipo: anterior.tipo,
      chave_acesso: anterior.chave_acesso,
      hash_sha256: hash,
      payload,
      nome_arquivo: arquivo.name,
      versao: (anterior.versao ?? 1) + 1,
      substitui_id: anterior.id,
      inconsistencias,
      criado_por: u?.id ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function urlAssinada(caminho, segundos = 300) {
  if (!caminho) return null;
  const { data } = await sb.storage
    .from(CONFIG.bucketDocumentos)
    .createSignedUrl(caminho, segundos);
  return data?.signedUrl ?? null;
}

export async function listarDocumentos(empresaId, tipo = null, limite = 200) {
  let q = sb.from('documentos_fonte')
    .select('id, tipo, chave_acesso, hash_sha256, nome_arquivo, payload, inconsistencias, criado_em')
    .eq('empresa_id', empresaId)
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (tipo) q = q.eq('tipo', tipo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
