/* =====================================================================
 * Importador genérico — CSV, XLSX e XML tabular.
 *
 * Regras que valem para qualquer origem:
 *   1. O arquivo original vira documento-fonte com hash (§4.1) — a
 *      procedência da planilha é tão auditável quanto a de uma NF-e;
 *   2. Erro é reportado linha a linha e o lote não aborta (§10);
 *   3. Gravação idempotente por chave natural: reimportar não duplica.
 *
 * CSV é parseado aqui mesmo (RFC 4180, ~40 linhas) para não carregar
 * dependência. XLSX carrega o SheetJS sob demanda, só quando o usuário
 * escolhe um .xlsx — quem só usa CSV não paga por isso.
 *
 * Este módulo é PURO de propósito: não importa o cliente do banco. É o
 * que permite testá-lo fora do navegador (tests/importador.test.mjs) e
 * o que mantém a regra de conversão separada da gravação.
 * ===================================================================== */

/* ====================================================================
 * Alvos: espelham o contrato da Edge Function `ingest`
 * ==================================================================== */
export const ALVOS = {
  produtos: {
    rotulo: 'Catálogo de produtos',
    tabela: 'produtos',
    conflito: 'empresa_id,sku',
    campos: {
      sku:               { rotulo: 'SKU / código', sinonimos: ['sku','codigo','código','cod','item','referencia','referência','part number','pn'] },
      gtin:              { rotulo: 'GTIN / EAN', sinonimos: ['gtin','ean','codigo de barras','código de barras','barcode'] },
      ncm:               { rotulo: 'NCM', sinonimos: ['ncm','classificacao fiscal','classificação fiscal'] },
      modelo:            { rotulo: 'Modelo / descrição', obrigatorio: true, sinonimos: ['modelo','descricao','descrição','produto','nome','denominacao'] },
      fabricante:        { rotulo: 'Fabricante', sinonimos: ['fabricante','marca','fornecedor','maker'] },
      categoria_reversa: { rotulo: 'Categoria de reversa', sinonimos: ['categoria','categoria reversa','tipo'] },
      peso_kg:           { rotulo: 'Peso (kg)', numero: true, sinonimos: ['peso','peso kg','peso (kg)','peso liquido','peso líquido','weight'] },
      peso_fonte:        { rotulo: 'Fonte do peso', sinonimos: ['fonte do peso','origem do peso','fonte peso'] },
      carbono_incorporado_tco2e: { rotulo: 'Carbono incorporado (tCO₂e)', numero: true, sinonimos: ['carbono','co2','tco2e','carbono incorporado','pegada'] },
      vida_util_meses:   { rotulo: 'Vida útil (meses)', numero: true, sinonimos: ['vida util','vida útil','vida util meses'] },
      valor_referencia:  { rotulo: 'Valor de referência', numero: true, sinonimos: ['valor','preco','preço','custo','valor unitario','valor unitário'] },
    },
  },
  pesos_referencia: {
    rotulo: 'Pesos por NCM',
    tabela: 'pesos_referencia',
    conflito: 'empresa_id,ncm',
    campos: {
      ncm:       { rotulo: 'NCM', obrigatorio: true, sinonimos: ['ncm'] },
      descricao: { rotulo: 'Descrição', sinonimos: ['descricao','descrição','produto'] },
      peso_kg:   { rotulo: 'Peso (kg)', obrigatorio: true, numero: true, sinonimos: ['peso','peso kg','peso medio','peso médio'] },
      fonte:     { rotulo: 'Fonte', sinonimos: ['fonte','origem'] },
    },
  },
  ativos: {
    rotulo: 'Inventário de equipamentos',
    tabela: 'ativos_equipamento',
    conflito: 'serial',
    chaveEmpresa: 'isp_id',
    campos: {
      serial:          { rotulo: 'Serial', obrigatorio: true, sinonimos: ['serial','numero de serie','número de série','n serie','sn','mac','imei'] },
      modelo:          { rotulo: 'Modelo', sinonimos: ['modelo','equipamento','produto','descricao','descrição'] },
      fabricante:      { rotulo: 'Fabricante', sinonimos: ['fabricante','marca'] },
      ncm:             { rotulo: 'NCM', sinonimos: ['ncm'] },
      estado:          { rotulo: 'Estado', sinonimos: ['estado','situacao','situação','status'] },
      valor_aquisicao: { rotulo: 'Valor de aquisição', numero: true, sinonimos: ['valor','custo','valor aquisicao','valor de aquisição'] },
      data_entrada:    { rotulo: 'Data de entrada', data: true, sinonimos: ['data','data entrada','data de entrada','entrada','aquisicao'] },
      peso_kg:         { rotulo: 'Peso (kg)', numero: true, sinonimos: ['peso','peso kg'] },
    },
  },
  unidades_consumidoras: {
    rotulo: 'Unidades consumidoras (POPs)',
    tabela: 'unidades_consumidoras',
    conflito: 'empresa_id,codigo_uc',
    campos: {
      apelido:       { rotulo: 'Apelido', obrigatorio: true, sinonimos: ['apelido','nome','identificacao','identificação','pop','site'] },
      codigo_uc:     { rotulo: 'Código da UC', sinonimos: ['codigo uc','código uc','uc','instalacao','instalação','cliente'] },
      distribuidora: { rotulo: 'Distribuidora', sinonimos: ['distribuidora','concessionaria','concessionária'] },
      uf:            { rotulo: 'UF', sinonimos: ['uf','estado'] },
      municipio:     { rotulo: 'Município', sinonimos: ['municipio','município','cidade'] },
      tipo:          { rotulo: 'Tipo', sinonimos: ['tipo'] },
    },
  },
  destinadores: {
    rotulo: 'Destinadores',
    tabela: 'destinadores',
    conflito: 'empresa_id,cnpj',
    campos: {
      cnpj:              { rotulo: 'CNPJ', obrigatorio: true, sinonimos: ['cnpj','documento'] },
      razao_social:      { rotulo: 'Razão social', obrigatorio: true, sinonimos: ['razao social','razão social','empresa','nome'] },
      tipo:              { rotulo: 'Tipo', obrigatorio: true, sinonimos: ['tipo','categoria'] },
      uf:                { rotulo: 'UF', sinonimos: ['uf','estado'] },
      municipio:         { rotulo: 'Município', sinonimos: ['municipio','município','cidade'] },
      licenca_ambiental: { rotulo: 'Licença ambiental', sinonimos: ['licenca','licença','licenca ambiental','licença ambiental','lo'] },
      licenca_validade:  { rotulo: 'Validade da licença', data: true, sinonimos: ['validade','vencimento','validade licenca','validade da licença'] },
      contato_email:     { rotulo: 'E-mail', sinonimos: ['email','e-mail','contato'] },
      prazo_medio_dias:  { rotulo: 'Prazo médio (dias)', numero: true, sinonimos: ['prazo','prazo medio','prazo médio','sla'] },
    },
  },
  portfolio_ncm: {
    rotulo: 'Portfólio de NCM',
    tabela: 'portfolio_ncm',
    conflito: 'empresa_id,ncm',
    campos: {
      ncm:          { rotulo: 'NCM', obrigatorio: true, sinonimos: ['ncm'] },
      descricao:    { rotulo: 'Descrição', obrigatorio: true, sinonimos: ['descricao','descrição','produto','item'] },
      volume_anual: { rotulo: 'Volume anual (R$)', numero: true, sinonimos: ['volume','volume anual','faturamento','valor'] },
    },
  },
};

/* ====================================================================
 * Leitura dos formatos
 * ==================================================================== */

/** CSV conforme RFC 4180: aspas, aspas escapadas e quebra dentro do campo. */
export function parseCSV(texto, separador = null) {
  const limpo = texto.replace(/^﻿/, '');
  const sep = separador ?? detectarSeparador(limpo);

  const linhas = [];
  let campo = '', linha = [], dentroAspas = false;

  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (dentroAspas) {
      if (c === '"') {
        if (limpo[i + 1] === '"') { campo += '"'; i++; }
        else dentroAspas = false;
      } else campo += c;
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === sep) {
      linha.push(campo); campo = '';
    } else if (c === '\n') {
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else if (c !== '\r') {
      campo += c;
    }
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }

  const uteis = linhas.filter((l) => l.some((c) => String(c).trim() !== ''));
  if (!uteis.length) return { cabecalho: [], linhas: [] };

  const cabecalho = uteis[0].map((c) => String(c).trim());
  return {
    cabecalho,
    linhas: uteis.slice(1).map((l) => Object.fromEntries(
      cabecalho.map((h, i) => [h, (l[i] ?? '').trim()]))),
  };
}

/** Planilha brasileira costuma vir com ponto e vírgula; deixa o dado decidir. */
function detectarSeparador(texto) {
  const amostra = texto.slice(0, 5000).split('\n').slice(0, 5).join('\n');
  const contar = (s) => (amostra.match(new RegExp(`\\${s}`, 'g')) ?? []).length;
  return [[';', contar(';')], [',', contar(',')], ['\t', contar('\t')], ['|', contar('|')]]
    .sort((a, b) => b[1] - a[1])[0][0];
}

let _sheetJs = null;
/** Carrega o SheetJS só quando alguém realmente abre um .xlsx. */
async function carregarSheetJs() {
  if (_sheetJs) return _sheetJs;
  if (!globalThis.XLSX) {
    await new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = ok;
      s.onerror = () => falha(new Error(
        'Não foi possível carregar o leitor de XLSX. Exporte a planilha como CSV e tente de novo.'));
      document.head.appendChild(s);
    });
  }
  _sheetJs = globalThis.XLSX;
  return _sheetJs;
}

export async function parseXLSX(arquivo, aba = null) {
  const XLSX = await carregarSheetJs();
  const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true });
  const nome = aba ?? wb.SheetNames[0];
  const matriz = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: false, defval: '' });

  const uteis = matriz.filter((l) => l.some((c) => String(c ?? '').trim() !== ''));
  if (!uteis.length) return { cabecalho: [], linhas: [], abas: wb.SheetNames };

  const cabecalho = uteis[0].map((c) => String(c ?? '').trim());
  return {
    cabecalho,
    abas: wb.SheetNames,
    linhas: uteis.slice(1).map((l) => Object.fromEntries(
      cabecalho.map((h, i) => [h, String(l[i] ?? '').trim()]))),
  };
}

/**
 * XML tabular genérico: encontra o elemento que mais se repete e trata
 * cada ocorrência como uma linha, usando os filhos como colunas. Cobre
 * exportações de ERP sem precisar de mapeamento de schema.
 */
export function parseXMLTabular(texto) {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('Arquivo não é um XML válido.');
  }

  const contagem = new Map();
  for (const el of doc.getElementsByTagName('*')) {
    if (el.children.length > 0) contagem.set(el.tagName, (contagem.get(el.tagName) ?? 0) + 1);
  }
  const [tag] = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!tag) throw new Error('XML sem estrutura tabular reconhecível.');

  const nos = [...doc.getElementsByTagName(tag)];
  const colunas = new Set();
  const linhas = nos.map((no) => {
    const reg = {};
    for (const f of no.children) {
      if (f.children.length === 0) {
        reg[f.tagName] = (f.textContent ?? '').trim();
        colunas.add(f.tagName);
      }
    }
    for (const a of no.attributes) { reg[a.name] = a.value; colunas.add(a.name); }
    return reg;
  }).filter((r) => Object.keys(r).length);

  return { cabecalho: [...colunas], linhas, elemento: tag };
}

/** Ponto de entrada: decide o leitor pela extensão. */
export async function lerArquivo(arquivo, opcoes = {}) {
  const nome = arquivo.name.toLowerCase();
  if (nome.endsWith('.xlsx') || nome.endsWith('.xls') || nome.endsWith('.xlsm')) {
    return { formato: 'xlsx', ...(await parseXLSX(arquivo, opcoes.aba)) };
  }
  const texto = await arquivo.text();
  if (nome.endsWith('.xml')) return { formato: 'xml', ...parseXMLTabular(texto) };
  return { formato: 'csv', ...parseCSV(texto, opcoes.separador) };
}

/* ====================================================================
 * Mapeamento de colunas
 * ==================================================================== */
const normaliza = (s) => String(s ?? '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Sugere de/para entre as colunas do arquivo e os campos do alvo.
 * Casa por sinônimo exato e, na falta, por contenção — o usuário
 * confirma tudo no passo seguinte do wizard.
 */
export function sugerirMapeamento(cabecalho, alvo) {
  const campos = ALVOS[alvo].campos;
  const usados = new Set();
  const mapa = {};

  for (const [campo, def] of Object.entries(campos)) {
    const alvos = [campo, ...(def.sinonimos ?? [])].map(normaliza);
    let achou = cabecalho.find((c) => !usados.has(c) && alvos.includes(normaliza(c)));
    if (!achou) {
      achou = cabecalho.find((c) => {
        if (usados.has(c)) return false;
        const n = normaliza(c);
        return alvos.some((a) => a.length > 3 && (n.includes(a) || a.includes(n)));
      });
    }
    if (achou) { mapa[campo] = achou; usados.add(achou); }
  }
  return mapa;
}

/* ====================================================================
 * Conversão e gravação
 * ==================================================================== */
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** Aceita 1.234,56 (BR) e 1,234.56 (US) sem adivinhação frágil. */
export function paraNumero(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/[^\d,.\-]/g, '');
  if (!s) return null;
  const ultimaVirgula = s.lastIndexOf(','), ultimoPonto = s.lastIndexOf('.');
  if (ultimaVirgula > ultimoPonto) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function paraData(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

/**
 * Converte as linhas cruas em registros do alvo, validando linha a linha.
 * @returns {{validos: object[], erros: {linha:number, erro:string, dados:object}[]}}
 */
export function converter({ linhas, mapa, alvo, empresaId }) {
  const def = ALVOS[alvo];
  const validos = [], erros = [];

  linhas.forEach((bruta, i) => {
    const reg = { [def.chaveEmpresa ?? 'empresa_id']: empresaId };
    const problemas = [];

    for (const [campo, cfg] of Object.entries(def.campos)) {
      const coluna = mapa[campo];
      if (!coluna) continue;
      const cru = bruta[coluna];
      if (cru == null || String(cru).trim() === '') continue;

      let valor = String(cru).trim();
      if (cfg.numero) {
        valor = paraNumero(valor);
        if (valor === null) { problemas.push(`${cfg.rotulo}: "${cru}" não é número`); continue; }
      } else if (cfg.data) {
        valor = paraData(valor);
        if (valor === null) { problemas.push(`${cfg.rotulo}: "${cru}" não é data`); continue; }
      } else if (campo === 'ncm' || campo === 'gtin' || campo === 'cnpj') {
        valor = soDigitos(valor);
      } else if (campo === 'uf') {
        valor = valor.toUpperCase().slice(0, 2);
      }
      reg[campo] = valor;
    }

    for (const [campo, cfg] of Object.entries(def.campos)) {
      if (cfg.obrigatorio && (reg[campo] == null || reg[campo] === '')) {
        problemas.push(`${cfg.rotulo} é obrigatório`);
      }
    }
    if (reg.ncm && String(reg.ncm).length !== 8) {
      problemas.push(`NCM "${reg.ncm}" não tem 8 dígitos`);
    }
    if (reg.cnpj && String(reg.cnpj).length !== 14) {
      problemas.push(`CNPJ "${reg.cnpj}" não tem 14 dígitos`);
    }

    if (problemas.length) erros.push({ linha: i + 2, erro: problemas.join('; '), dados: bruta });
    else validos.push(reg);
  });

  // Procedência: quem veio de planilha carrega isso no dado
  if (alvo === 'produtos') {
    for (const v of validos) { v.origem_cadastro = 'planilha'; v.peso_fonte ??= 'planilha'; }
  }
  if (alvo === 'pesos_referencia') for (const v of validos) v.fonte ??= 'planilha';

  return { validos, erros };
}


/* ====================================================================
 * Utilitários compartilhados
 * ==================================================================== */
export const ESCOPOS = Object.keys(ALVOS);

export async function sha256Hex(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

