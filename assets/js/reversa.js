/* =====================================================================
 * Ciclo de logística reversa — automações do §8.
 *
 * Regra que atravessa tudo: a decisão sobre o equipamento é registrada
 * (triagem com laudo e memória econômica), e o carbono só é lançado
 * onde existe documento-fonte que o sustente.
 * ===================================================================== */
import { sb, usuarioAtual, normalizaCnpj } from './db.js';
import { lancar } from './carbono.js';
import { competenciaAtual } from './ui.js';

/* ====================================================================
 * 1. NF-e de compra → inventário de rede
 * ==================================================================== */

/**
 * Deriva um serial provisório estável a partir da nota. Estável importa:
 * reimportar a mesma NF-e não duplica o inventário (o UNIQUE segura).
 */
export function serialProvisorio(chave, nItem, seq) {
  const curto = (chave ?? '').slice(-12) || Date.now().toString(36).toUpperCase();
  return `PROV-${curto}-${String(nItem).padStart(3, '0')}-${String(seq).padStart(4, '0')}`;
}

/**
 * Cria os ativos de rede de uma NF-e já registrada como documento-fonte.
 * Idempotente por serial: reimportar não duplica.
 *
 * @returns {{criados: number, jaExistiam: number, provisorios: number}}
 */
export async function inventariarNFe({ empresaId, documento, dadosNFe, distribuidorId = null, limitePorItem = 500 }) {
  const equipamentos = (dadosNFe.itens ?? []).filter((i) => i.equipamento && i.unidades > 0);
  if (!equipamentos.length) {
    return { criados: 0, jaExistiam: 0, provisorios: 0, semEquipamento: true };
  }

  const linhas = [];
  let provisorios = 0;

  for (const item of equipamentos) {
    // Guarda de sanidade: uma NF-e de 2.000 m de cabo não vira 2.000 ativos.
    const n = Math.min(item.unidades, limitePorItem);

    for (let i = 0; i < n; i++) {
      const serialReal = item.seriais[i] ?? null;
      if (!serialReal) provisorios++;
      linhas.push({
        serial: serialReal ?? serialProvisorio(dadosNFe.chave_acesso, item.item, i + 1),
        serial_provisorio: !serialReal,
        modelo: item.descricao?.slice(0, 120) ?? null,
        fabricante: dadosNFe.emitente?.nome?.slice(0, 120) ?? null,
        ncm: item.ncm && /^[0-9]{8}$/.test(item.ncm) ? item.ncm : null,
        isp_id: empresaId,
        distribuidor_id: distribuidorId,
        estado: 'novo',
        documento_entrada_id: documento.id,
        nf_item: item.item,
        valor_aquisicao: item.valor_unitario,
        data_entrada: dadosNFe.emissao,
      });
    }
  }

  // ignoreDuplicates: reimportação é no-op, não erro
  const { data, error } = await sb
    .from('ativos_equipamento')
    .upsert(linhas, { onConflict: 'serial', ignoreDuplicates: true })
    .select('id');

  if (error) throw error;

  const criados = data?.length ?? 0;
  return {
    criados,
    jaExistiam: linhas.length - criados,
    provisorios,
    totalItens: equipamentos.length,
    truncado: equipamentos.some((i) => i.unidades > limitePorItem),
  };
}

/* ====================================================================
 * 2. Triagem do retorno
 * ==================================================================== */

export const MOTIVOS = {
  sem_defeito:      'Sem defeito (retorno por churn/troca)',
  defeito_reparavel:'Defeito reparável',
  dano_fisico:      'Dano físico',
  fim_de_vida:      'Fim de vida útil',
  obsoleto:         'Obsoleto tecnicamente',
  fora_de_garantia: 'Fora de garantia',
  outro:            'Outro',
};

export const DESTINOS = {
  reparo:    { rotulo: 'Reparo (assistência técnica)', estado: 'reparo' },
  reposicao: { rotulo: 'Reposição de campo (volta ao estoque)', estado: 'refurb' },
  descarte:  { rotulo: 'Descarte (logística reversa)', estado: 'descarte' },
};

/**
 * Sugere o destino a partir do motivo e da economia do reparo.
 * É sugestão: quem decide e assina o laudo é o técnico.
 */
export function sugerirDestino({ motivo, custoReparo, valorReposicao }) {
  if (motivo === 'sem_defeito') {
    return { destino: 'reposicao', razao: 'Sem defeito — volta ao estoque após reset e limpeza.' };
  }
  if (['fim_de_vida', 'obsoleto', 'dano_fisico'].includes(motivo)) {
    return { destino: 'descarte', razao: 'Sem reuso viável — destinação certificada cumpre a PNRS e gera ativo.' };
  }
  if (motivo === 'defeito_reparavel') {
    const c = Number(custoReparo ?? 0), v = Number(valorReposicao ?? 0);
    if (c > 0 && v > 0) {
      return c <= v * 0.6
        ? { destino: 'reparo', razao: `Reparo custa ${((c / v) * 100).toFixed(0)}% da reposição — compensa recuperar.` }
        : { destino: 'descarte', razao: `Reparo custa ${((c / v) * 100).toFixed(0)}% da reposição — não compensa.` };
    }
    return { destino: 'reparo', razao: 'Defeito reparável — informe os custos para a comparação econômica.' };
  }
  return { destino: 'reparo', razao: 'Avaliar na assistência técnica.' };
}

/**
 * Registra a triagem, move o ativo e gera o lançamento de carbono quando
 * houver documento-fonte que o sustente.
 *
 * Reposição gera ATIVO (compra de CPE nova evitada). Reparo e descarte
 * não geram lançamento aqui: o do descarte nasce no CDF do lote (§8), e
 * o do reparo só quando o equipamento efetivamente voltar ao estoque.
 */
export async function registrarTriagem({ empresaId, ativo, destino, motivo, laudo,
                                         custoReparo = null, valorReposicao = null,
                                         destinadorId = null }) {
  if (!DESTINOS[destino]) throw new Error(`Destino inválido: ${destino}`);
  if (!MOTIVOS[motivo])   throw new Error(`Motivo inválido: ${motivo}`);

  const u = await usuarioAtual();

  const { data: triagem, error } = await sb
    .from('triagens')
    .insert({
      ativo_id: ativo.id, empresa_id: empresaId, destino, motivo, laudo,
      custo_reparo_estimado: custoReparo, valor_reposicao: valorReposicao,
      destinador_id: destinadorId, triado_por: u?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  const novoEstado = DESTINOS[destino].estado;
  const patch = { estado: novoEstado };
  if (destino === 'reposicao') patch.ciclos_refurb = (ativo.ciclos_refurb ?? 0) + 1;

  const { error: e2 } = await sb.from('ativos_equipamento').update(patch).eq('id', ativo.id);
  if (e2) throw e2;

  await sb.from('ativos_historico').insert({
    ativo_id: ativo.id, estado_de: ativo.estado, estado_para: novoEstado,
    documento_id: ativo.documento_entrada_id ?? null,
  });

  let lancamento = null, aviso = null;
  if (destino === 'reposicao') {
    if (ativo.documento_entrada_id) {
      lancamento = await lancar({
        empresaId, documentoFonteId: ativo.documento_entrada_id,
        perfil: 'isp', categoria: 'refurb', quantidadeOrigem: 1,
        competencia: competenciaAtual(),
        observacao: `Triagem ${triagem.id}: ${MOTIVOS[motivo]} — serial ${ativo.serial}.`,
      });
    } else {
      aviso = 'Ativo sem documento de entrada: triagem registrada, mas sem lançamento de carbono (§4.1).';
    }
  }

  return { triagem, novoEstado, lancamento, aviso };
}

/** Conclui um reparo: recuperado volta ao estoque, irrecuperável vai a descarte. */
export async function concluirReparo({ empresaId, ativo, recuperado, observacao = null }) {
  const novoEstado = recuperado ? 'refurb' : 'descarte';

  const { error } = await sb.from('ativos_equipamento')
    .update({ estado: novoEstado, observacao }).eq('id', ativo.id);
  if (error) throw error;

  await sb.from('ativos_historico').insert({
    ativo_id: ativo.id, estado_de: 'reparo', estado_para: novoEstado,
  });

  let lancamento = null;
  if (recuperado && ativo.documento_entrada_id) {
    lancamento = await lancar({
      empresaId, documentoFonteId: ativo.documento_entrada_id,
      perfil: 'isp', categoria: 'refurb', quantidadeOrigem: 1,
      competencia: competenciaAtual(),
      observacao: `Reparo concluído — serial ${ativo.serial} recuperado.`,
    });
  }
  return { novoEstado, lancamento };
}

/* ====================================================================
 * 3. Destinadores
 * ==================================================================== */

export const TIPOS_DESTINADOR = {
  reciclador:        'Reciclador / destinador final',
  assistencia_tecnica:'Assistência técnica',
  refurbisher:       'Refurbisher',
  logistica:         'Operador logístico',
  fabricante:        'Fabricante (logística reversa própria)',
};

export const CATEGORIAS_ACEITAS = [
  'onu_roteador', 'olt_chassi', 'fonte_carregador',
  'bateria', 'cabo_fibra', 'placa_eletronica', 'outro',
];

export async function listarDestinadores(empresaId, { tipo = null, apenasAtivos = true } = {}) {
  let q = sb.from('destinadores').select('*').eq('empresa_id', empresaId).order('razao_social');
  if (tipo) q = q.eq('tipo', tipo);
  if (apenasAtivos) q = q.eq('ativo', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function salvarDestinador({ empresaId, id = null, ...campos }) {
  const linha = { ...campos, empresa_id: empresaId, cnpj: normalizaCnpj(campos.cnpj) };
  const q = id
    ? sb.from('destinadores').update(linha).eq('id', id)
    : sb.from('destinadores').insert(linha);
  const { data, error } = await q.select().single();
  if (error) throw error;
  return data;
}

/** Situação da licença: é o que decide se o destinador pode receber lote. */
export function situacaoLicenca(d) {
  if (!d?.licenca_validade) {
    return { nivel: 'nao_validado', rotulo: 'sem licença registrada', bloqueia: false };
  }
  const hoje = new Date().toISOString().slice(0, 10);
  if (d.licenca_validade < hoje) {
    return { nivel: 'risco', rotulo: `vencida em ${d.licenca_validade.split('-').reverse().join('/')}`, bloqueia: true };
  }
  const em60 = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  if (d.licenca_validade <= em60) {
    return { nivel: 'nao_validado', rotulo: `vence ${d.licenca_validade.split('-').reverse().join('/')}`, bloqueia: false };
  }
  return { nivel: 'validado', rotulo: `vigente até ${d.licenca_validade.split('-').reverse().join('/')}`, bloqueia: false };
}

/* ====================================================================
 * 4. Formação de lote
 * ==================================================================== */

export async function aguardandoLote(empresaId) {
  const { data, error } = await sb.from('ativos_equipamento')
    .select('id, serial, modelo, valor_aquisicao')
    .eq('isp_id', empresaId).eq('estado', 'descarte').is('lote_reversa_id', null);
  if (error) throw error;
  return data ?? [];
}

/** Chama a função do banco, que valida a licença do destinador na transação. */
export async function formarLote({ empresaId, destinadorId = null, ispParceiroId = null,
                                   pesoMedioKg = 0.35, identificacao = null }) {
  const { data, error } = await sb.rpc('formar_lote_reversa', {
    p_empresa_id: empresaId,
    p_destinador_id: destinadorId,
    p_isp_parceiro_id: ispParceiroId,
    p_peso_medio_kg: pesoMedioKg,
    p_identificacao: identificacao,
  });
  if (error) throw error;
  return data;
}

/** Inventário de rede agora, por modelo e estado. */
export async function inventarioRede(empresaId) {
  const { data, error } = await sb.from('vw_inventario_rede')
    .select('*').eq('empresa_id', empresaId);
  if (error) throw error;
  return data ?? [];
}
