/* =====================================================================
 * Importadores de XML — NF-e e CT-e (§5).
 *
 * Rodam no navegador com DOMParser: sem backend, sem upload do conteúdo
 * para terceiros. §10: "erros de importação retornam linha a linha —
 * nunca falha silenciosa"; por isso todo parser devolve `inconsistencias`
 * junto com os dados, e o documento é gravado mesmo quando incompleto.
 * ===================================================================== */

const T = (no, tag) => no?.getElementsByTagName(tag)?.[0]?.textContent?.trim() ?? null;
const N = (no, tag) => { const v = T(no, tag); return v == null ? null : Number(v.replace(',', '.')); };

/** Extrai números de série de um texto livre (infAdProd). */
export function extraiSeriais(texto) {
  if (!texto) return [];
  const achados = [];
  for (const m of texto.matchAll(RE_SERIAL)) achados.push(m[1].trim());
  if (!achados.length) {
    for (const m of texto.matchAll(RE_SERIAL_SOLTO)) achados.push(m[1].trim());
  }
  return [...new Set(achados)];
}

function parseXml(texto) {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('Arquivo não é um XML válido.');
  }
  return doc;
}

const chaveDe = (no) => (no?.getAttribute('Id') ?? '').replace(/\D/g, '') || null;

/* ====================================================================
 * NF-e
 * ==================================================================== */

/** NCMs do capítulo 2710 = combustíveis derivados de petróleo */
const NCM_COMBUSTIVEL = /^2710/;
const UNIDADES_LITRO  = /^(l|lt|lts|litro|litros)$/i;

/**
 * NCMs de equipamento de rede — o que vira ativo no inventário.
 *   8517 = aparelhos de telecomunicação (OLT, ONU, roteador, switch)
 *   8471 = processamento de dados (servidores de borda/headend)
 *   8544 = cabos, inclusive fibra óptica
 *   8525 = transmissão
 */
const NCM_EQUIPAMENTO = /^(8517|8471|8544|8525)/;

/** Palavras que identificam equipamento quando o NCM vem errado ou ausente */
const RE_EQUIPAMENTO =
  /\b(onu|ont|olt|roteador|router|switch|cpe|modem|rádio|radio|antena|repetidor|access\s*point|nobreak|servidor)\b/i;

/** Unidades que indicam contagem de peças (viram N ativos) */
const UNIDADES_PECA = /^(un|und|unid|unidade|pc|pça|peca|peça|cx)$/i;

/**
 * Série raramente vem em campo próprio na NF-e. Onde costuma aparecer:
 *   <infAdProd>  — texto livre por item (o caso comum em telecom)
 *   <rastro><nLote> — rastreabilidade (raro fora de alimentos/medicamentos)
 * Extraímos por padrão e marcamos o que não veio como provisório.
 */
const RE_SERIAL = /\b(?:n[º°ro.]*\s*s[ée]rie|serial|s\/?n|nserie)\s*[:=]?\s*([A-Z0-9][A-Z0-9._-]{5,30})/gi;
const RE_SERIAL_SOLTO = /\b([A-Z]{2,6}[0-9A-F]{8,24})\b/g;

const TIPO_COMBUSTIVEL = [
  { re: /(diesel|s-?10|s-?500|oleo\s*diesel)/i, fator: 'diesel_b' },
  { re: /(gasolina)/i,                          fator: 'gasolina_c' },
  { re: /(etanol|alcool|álcool)/i,              fator: 'etanol_hidratado' },
];

export function lerNFe(texto) {
  const doc  = parseXml(texto);
  const inf  = doc.getElementsByTagName('infNFe')[0];
  if (!inf) throw new Error('XML sem tag <infNFe> — não parece uma NF-e.');

  const inconsistencias = [];
  const ide   = inf.getElementsByTagName('ide')[0];
  const emit  = inf.getElementsByTagName('emit')[0];
  const dest  = inf.getElementsByTagName('dest')[0];
  const total = inf.getElementsByTagName('ICMSTot')[0];

  const chave = chaveDe(inf);
  if (!chave || chave.length !== 44) inconsistencias.push('Chave de acesso ausente ou com tamanho inválido.');

  const emissao = (T(ide, 'dhEmi') ?? T(ide, 'dEmi') ?? '').slice(0, 10) || null;
  if (!emissao) inconsistencias.push('Data de emissão ausente.');

  const itens = [...inf.getElementsByTagName('det')].map((det) => {
    const prod = det.getElementsByTagName('prod')[0];
    const uCom = T(prod, 'uCom');
    const ncm  = T(prod, 'NCM');
    const desc = T(prod, 'xProd') ?? '';
    const qtd  = N(prod, 'qCom');
    const nItem = Number(det.getAttribute('nItem') ?? 0);

    const ehCombustivel =
      (ncm && NCM_COMBUSTIVEL.test(ncm)) || TIPO_COMBUSTIVEL.some((t) => t.re.test(desc));

    let fator = null, litros = null;
    if (ehCombustivel) {
      fator = TIPO_COMBUSTIVEL.find((t) => t.re.test(desc))?.fator ?? 'diesel_b';
      if (uCom && UNIDADES_LITRO.test(uCom)) litros = qtd;
      else inconsistencias.push(
        `Item "${desc}": unidade "${uCom ?? '?'}" não é litro — quantidade precisa de conferência manual.`
      );
    }

    const ehEquipamento = !ehCombustivel
      && ((ncm && NCM_EQUIPAMENTO.test(ncm)) || RE_EQUIPAMENTO.test(desc));

    let unidades = null, seriais = [];
    if (ehEquipamento) {
      const infAd = T(det, 'infAdProd') ?? '';
      seriais = extraiSeriais(infAd);
      for (const r of det.getElementsByTagName('rastro')) {
        const lote = T(r, 'nLote');
        if (lote) seriais.push(lote.trim());
      }
      seriais = [...new Set(seriais)];

      if (uCom && UNIDADES_PECA.test(uCom)) {
        unidades = Math.round(qtd ?? 0);
      } else if (qtd != null && Number.isInteger(qtd)) {
        unidades = qtd;
      } else {
        inconsistencias.push(
          `Item ${nItem} "${desc}": unidade "${uCom ?? '?'}" não é contável — confirme a quantidade de equipamentos.`
        );
      }

      if (unidades && seriais.length && seriais.length !== unidades) {
        inconsistencias.push(
          `Item ${nItem}: ${seriais.length} série(s) encontrada(s) para ${unidades} unidade(s) — o restante entra como provisório.`
        );
      } else if (unidades && !seriais.length) {
        inconsistencias.push(
          `Item ${nItem} "${desc}": NF-e sem número de série — inventário entra com serial provisório para correção em campo.`
        );
      }
    }

    return {
      item: nItem,
      codigo: T(prod, 'cProd'), descricao: desc, ncm,
      quantidade: qtd, unidade: uCom, valor: N(prod, 'vProd'),
      combustivel: ehCombustivel, fator_sugerido: fator, litros,
      equipamento: ehEquipamento, unidades, seriais,
      valor_unitario: (ehEquipamento && unidades) ? Number(((N(prod, 'vProd') ?? 0) / unidades).toFixed(2)) : null,
    };
  });

  if (!itens.length) inconsistencias.push('NF-e sem itens (<det>).');

  return {
    tipo: 'nfe',
    chave_acesso: chave,
    numero: T(ide, 'nNF'),
    serie: T(ide, 'serie'),
    emissao,
    natureza_operacao: T(ide, 'natOp'),
    emitente: { cnpj: T(emit, 'CNPJ'), nome: T(emit, 'xNome'), uf: T(emit?.getElementsByTagName('enderEmit')[0], 'UF') },
    destinatario: { cnpj: T(dest, 'CNPJ') ?? T(dest, 'CPF'), nome: T(dest, 'xNome') },
    valor_total: N(total, 'vNF'),
    itens,
    litros_combustivel: itens.filter((i) => i.combustivel && i.litros).reduce((a, i) => a + i.litros, 0) || null,
    total_equipamentos: itens.filter((i) => i.equipamento).reduce((a, i) => a + (i.unidades ?? 0), 0) || null,
    inconsistencias,
  };
}

/* ====================================================================
 * CT-e
 * ==================================================================== */

// cUnid do leiaute CT-e (infQ)
const UNID_CARGA = { '00': 'M3', '01': 'KG', '02': 'TON', '03': 'UNIDADE', '04': 'LITROS', '05': 'MMBTU' };

const MODAL = { '01': 'rodoviario', '02': 'aereo', '03': 'aquaviario', '04': 'ferroviario', '05': 'dutoviario', '06': 'multimodal' };

export function lerCTe(texto) {
  const doc = parseXml(texto);
  const inf = doc.getElementsByTagName('infCte')[0];
  if (!inf) throw new Error('XML sem tag <infCte> — não parece um CT-e.');

  const inconsistencias = [];
  const ide  = inf.getElementsByTagName('ide')[0];
  const emit = inf.getElementsByTagName('emit')[0];
  const carga = inf.getElementsByTagName('infCarga')[0];

  const chave = chaveDe(inf);
  if (!chave || chave.length !== 44) inconsistencias.push('Chave de acesso ausente ou inválida.');

  const emissao = (T(ide, 'dhEmi') ?? '').slice(0, 10) || null;
  const modalCod = T(ide, 'modal');
  const modal = MODAL[modalCod] ?? 'rodoviario';
  if (!MODAL[modalCod]) inconsistencias.push(`Modal "${modalCod ?? '?'}" não reconhecido — assumido rodoviário.`);

  // Peso: prioriza TON, cai para KG. Volume/unidade não servem para t.km.
  let pesoT = null;
  for (const q of carga?.getElementsByTagName('infQ') ?? []) {
    const unid = UNID_CARGA[T(q, 'cUnid')];
    const val  = N(q, 'qCarga');
    if (val == null) continue;
    if (unid === 'TON') { pesoT = val; break; }
    if (unid === 'KG')  { pesoT = val / 1000; }
  }
  if (pesoT == null) {
    inconsistencias.push('Peso da carga não informado em KG/TON — t.km exige preenchimento manual.');
  }

  // O leiaute do CT-e não traz distância percorrida.
  // A conversão para t.km depende de km informado ou estimado por rota.
  inconsistencias.push('Distância não consta no leiaute do CT-e — informar km do embarque para calcular t.km.');

  return {
    tipo: 'cte',
    chave_acesso: chave,
    numero: T(ide, 'nCT'),
    emissao,
    modal,
    cfop: T(ide, 'CFOP'),
    uf_inicio: T(ide, 'UFIni'),
    uf_fim: T(ide, 'UFFim'),
    municipio_inicio: T(ide, 'xMunIni'),
    municipio_fim: T(ide, 'xMunFim'),
    emitente: { cnpj: T(emit, 'CNPJ'), nome: T(emit, 'xNome') },
    peso_toneladas: pesoT,
    valor_carga: N(carga, 'vCarga'),
    valor_prestacao: N(inf.getElementsByTagName('vPrest')[0], 'vTPrest'),
    distancia_km: null,
    inconsistencias,
  };
}

/* ====================================================================
 * Entrada genérica: detecta o tipo pelo conteúdo
 * ==================================================================== */
export function lerDocumentoXml(texto) {
  if (texto.includes('<infNFe')) return lerNFe(texto);
  if (texto.includes('<infCte')) return lerCTe(texto);
  throw new Error('XML não reconhecido: esperado NF-e (<infNFe>) ou CT-e (<infCte>).');
}

/** Importa vários arquivos, nunca abortando o lote por causa de um item (RNF-004). */
export async function lerLote(arquivos, leitor = lerDocumentoXml) {
  const resultados = [];
  for (const arq of arquivos) {
    try {
      resultados.push({ arquivo: arq, ok: true, dados: leitor(await arq.text()) });
    } catch (e) {
      resultados.push({ arquivo: arq, ok: false, erro: e.message });
    }
  }
  return resultados;
}
