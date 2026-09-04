/* =====================================================================
 * Gravação de importações e gestão de conectores.
 *
 * Separado de `importador.js` (que é puro) porque só esta metade fala
 * com o banco. A conversão e a validação continuam testáveis sem rede.
 * ===================================================================== */
import { sb, usuarioAtual } from './db.js';
import { registrarDocumento } from './docfonte.js';
import { ALVOS, sha256Hex } from './importador.js';

/**
 * Grava e registra a importação. O arquivo vira documento-fonte com hash,
 * de modo que a planilha tem a mesma rastreabilidade de uma NF-e.
 */
export async function importar({ empresaId, alvo, arquivo, validos, erros, formato }) {
  const def = ALVOS[alvo];
  let documentoId = null;

  if (arquivo) {
    try {
      const { doc } = await registrarDocumento({
        empresaId, tipo: 'outro', arquivo,
        payload: { importacao: alvo, formato, linhas: validos.length + erros.length },
        inconsistencias: erros.slice(0, 200).map((e) => `linha ${e.linha}: ${e.erro}`),
      });
      documentoId = doc.id;
    } catch (e) {
      console.warn('Documento-fonte da planilha não registrado:', e.message);
    }
  }

  let gravados = 0, erroGravacao = null;
  if (validos.length) {
    const { data, error } = await sb.from(def.tabela)
      .upsert(validos, { onConflict: def.conflito })
      .select('id');
    if (error) erroGravacao = error.message;
    else gravados = data?.length ?? 0;
  }

  const status = erroGravacao ? 'falhou'
               : erros.length ? 'parcial'
               : 'concluida';

  const u = await usuarioAtual();
  await sb.from('importacoes').insert({
    empresa_id: empresaId, origem: formato, alvo,
    nome_arquivo: arquivo?.name ?? null,
    documento_fonte_id: documentoId,
    total_linhas: validos.length + erros.length,
    criados: gravados, erros: erros.length + (erroGravacao ? 1 : 0),
    relatorio: [...(erroGravacao ? [{ linha: 0, erro: erroGravacao }] : []),
                ...erros.slice(0, 500)],
    status, criado_por: u?.id ?? null,
  });

  return { gravados, erros: erros.length, erroGravacao, status, documentoId };
}

/* ====================================================================
 * Conectores
 * ==================================================================== */

/**
 * Gera o token NO NAVEGADOR e envia só o hash. O valor em claro nunca
 * chega ao servidor — nem em log, nem em backup.
 */
export async function criarConector({ empresaId, nome, tipo, sistema, escopos }) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = 'mbv_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const hash = await sha256Hex(token);
  const u = await usuarioAtual();

  const { data, error } = await sb.from('conectores').insert({
    empresa_id: empresaId, nome, tipo, sistema,
    token_hash: hash, token_prefixo: token.slice(0, 12),
    escopos, criado_por: u?.id ?? null,
  }).select().single();

  if (error) throw error;
  return { conector: data, token };   // token só existe aqui, uma vez
}

export async function listarConectores(empresaId) {
  const { data, error } = await sb.from('conectores')
    .select('*').eq('empresa_id', empresaId).order('criado_em', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function historicoImportacoes(empresaId, limite = 50) {
  const { data, error } = await sb.from('importacoes')
    .select('*, conector:conector_id(nome)')
    .eq('empresa_id', empresaId).order('criado_em', { ascending: false }).limit(limite);
  if (error) throw error;
  return data ?? [];
}
