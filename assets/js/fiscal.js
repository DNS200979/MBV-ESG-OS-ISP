/* =====================================================================
 * Funil de qualificação de incentivos + simulador de regime (§5, §6.3, §7.3).
 *
 * ⚠️  §12 — LIMITE DE ATUAÇÃO. Nada aqui é parecer jurídico ou contábil.
 *     O motor produz EVIDÊNCIA TÉCNICA e MEMÓRIA DE CÁLCULO; a tese só
 *     vira `ativo` depois da etapa `validacao_parceiro`.
 *
 * Todas as alíquotas ficam em tabelas PARAMETRIZADAS abaixo — nunca
 * embutidas na lógica (§15: mitigação do risco "reforma muda as regras").
 * ===================================================================== */
import { sb } from './db.js';

/* ====================================================================
 * 1. Funil de qualificação
 * ==================================================================== */

/**
 * Monta o contexto avaliável de uma empresa: dados cadastrais + flags
 * derivadas do que já foi importado. É esse objeto que os `requisitos`
 * do catálogo interrogam.
 */
export async function contextoEmpresa(empresa) {
  const id = empresa.id;
  const conta = async (tabela, filtros = {}) => {
    let q = sb.from(tabela).select('id', { count: 'exact', head: true }).eq('empresa_id', id);
    for (const [k, v] of Object.entries(filtros)) q = q.eq(k, v);
    const { count } = await q;
    return count ?? 0;
  };

  const [ucs, ucsGd, dis, lotes, ncms, pds, ttdPend] = await Promise.all([
    conta('unidades_consumidoras'),
    conta('unidades_consumidoras', { tem_gd_solar: true }),
    conta('declaracoes_importacao'),
    conta('lotes_reversa', { status: 'certificado' }),
    conta('portfolio_ncm'),
    conta('projetos_pd'),
    conta('condicionantes_ttd', { status: 'atrasada' }),
  ]);

  return {
    ...empresa,
    tem_uc_propria: ucs > 0,
    tem_gd_solar: ucsGd > 0,
    tem_di: dis > 0,
    tem_lote_reversa: lotes > 0,
    tem_portfolio_ncm: ncms > 0,
    tem_projeto_pd: pds > 0,
    condicionantes_em_dia: ttdPend === 0,
    tem_beneficio_icms: dis > 0,
    // Não é inferível dos documentos importados: entra como declaração do
    // cliente e fica pendente até confirmação do contador.
    lucro_no_exercicio: empresa.regime === 'real' ? null : false,
  };
}

const OPERADORES = {
  'in':     (a, b) => Array.isArray(b) && b.includes(a),
  '=':      (a, b) => a === b,
  '>=':     (a, b) => Number(a) >= Number(b),
  '<=':     (a, b) => Number(a) <= Number(b),
  'existe': (a)    => a != null && a !== '' && a !== false,
};

/**
 * Avalia um incentivo contra o contexto.
 * Requisito indeterminado (valor `null` no contexto) NÃO reprova — vira
 * pendência de confirmação, porque o produto não adivinha dado fiscal.
 */
export function avaliarIncentivo(incentivo, ctx) {
  const avaliados = (incentivo.requisitos ?? []).map((r) => {
    const valor = ctx[r.chave];
    const fn = OPERADORES[r.operador];
    let situacao;
    if (valor === null || valor === undefined) situacao = 'pendente';
    else situacao = fn && fn(valor, r.valor) ? 'atendido' : 'nao_atendido';
    return { ...r, valor_encontrado: valor, situacao };
  });

  const regimeOk = !incentivo.regimes_elegiveis?.length
    || !ctx.regime
    || incentivo.regimes_elegiveis.includes(ctx.regime);

  const perfilOk = !incentivo.aplica_perfil?.length
    || incentivo.aplica_perfil.includes(ctx.perfil_setorial);

  const reprovados = avaliados.filter((r) => r.situacao === 'nao_atendido').length;
  const pendentes  = avaliados.filter((r) => r.situacao === 'pendente').length;

  let etapa;
  if (!perfilOk || !regimeOk || reprovados > 0) etapa = 'triagem';
  else if (pendentes > 0) etapa = 'triagem';
  else etapa = 'elegivel';

  return {
    incentivo, requisitos: avaliados, regimeOk, perfilOk,
    reprovados, pendentes, etapa_sugerida: etapa,
    elegivel: etapa === 'elegivel',
  };
}

export async function catalogoParaPerfil(perfil) {
  const { data, error } = await sb
    .from('incentivos_catalogo')
    .select('*')
    .contains('aplica_perfil', [perfil])
    .order('esfera')
    .order('nome');
  if (error) throw error;
  return data ?? [];
}

export async function funilDaEmpresa(empresa) {
  const [catalogo, ctx, { data: registrados }] = await Promise.all([
    catalogoParaPerfil(empresa.perfil_setorial),
    contextoEmpresa(empresa),
    sb.from('incentivos_empresa').select('*').eq('empresa_id', empresa.id),
  ]);

  const porIncentivo = new Map((registrados ?? []).map((r) => [r.incentivo_id, r]));

  return catalogo.map((inc) => {
    const aval = avaliarIncentivo(inc, ctx);
    const reg = porIncentivo.get(inc.id) ?? null;
    return {
      ...aval,
      registro: reg,
      etapa: reg?.etapa_funil ?? aval.etapa_sugerida,
      economia_estimada: reg?.economia_estimada_anual ?? null,
      economia_realizada: reg?.economia_realizada_anual ?? null,
    };
  });
}

/** Grava/atualiza a posição de um incentivo no funil da empresa. */
export async function salvarFunil({ empresaId, incentivoId, etapa, estimada, memoria = {}, parceiro = null, validadoEm = null }) {
  const { data, error } = await sb
    .from('incentivos_empresa')
    .upsert({
      empresa_id: empresaId,
      incentivo_id: incentivoId,
      etapa_funil: etapa,
      economia_estimada_anual: estimada,
      memoria_calculo: memoria,
      parceiro_validador: parceiro,
      validado_em: validadoEm,
    }, { onConflict: 'empresa_id,incentivo_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ====================================================================
 * 2. Simulador de regime tributário
 *
 * ⚠️  PARÂMETROS PROVISÓRIOS. Conferir com o contador antes de qualquer
 *     uso comercial (§12, §17). O simulador é comparativo, não apuração.
 * ==================================================================== */

export const PARAMETROS_FISCAIS = {
  validacao: 'nao_validado',
  fonte: 'PROVISÓRIO — conferir com parceiro contábil licenciado',

  simples: {
    // Anexo III (serviços). Faixas de RBT12 em R$.
    anexo: 'III',
    faixas: [
      { ate:    180000, aliquota: 0.060, deduzir:      0 },
      { ate:    360000, aliquota: 0.112, deduzir:   9360 },
      { ate:    720000, aliquota: 0.135, deduzir:  17640 },
      { ate:   1800000, aliquota: 0.160, deduzir:  35640 },
      { ate:   3600000, aliquota: 0.210, deduzir: 125640 },
      { ate:   4800000, aliquota: 0.330, deduzir: 648000 },
    ],
    teto: 4800000,
  },

  presumido: {
    presuncao_irpj: 0.32,      // serviços em geral
    presuncao_csll: 0.32,
    irpj: 0.15,
    irpj_adicional: 0.10,
    irpj_adicional_limite_anual: 240000,
    csll: 0.09,
    pis_cofins: 0.0365,        // regime cumulativo
    iss_padrao: 0.03,
  },

  real: {
    irpj: 0.15,
    irpj_adicional: 0.10,
    irpj_adicional_limite_anual: 240000,
    csll: 0.09,
    pis_cofins: 0.0925,        // não cumulativo
    credito_pis_cofins_sobre_capex: 0.0925,
    iss_padrao: 0.03,
  },

  reforma: {
    // Alíquota de referência CBS+IBS. Parametrizada: muda por lei.
    aliquota_referencia: 0.265,
    credito_amplo: true,       // CAPEX de rede gera crédito integral
  },
};

const fx = (n) => Number(Number(n).toFixed(2));

function simulaSimples({ faturamento }) {
  const p = PARAMETROS_FISCAIS.simples;
  if (faturamento > p.teto) {
    return { aplicavel: false, motivo: `Faturamento acima do teto do Simples (R$ ${p.teto.toLocaleString('pt-BR')}).`, total: null };
  }
  const faixa = p.faixas.find((f) => faturamento <= f.ate) ?? p.faixas.at(-1);
  const efetiva = (faturamento * faixa.aliquota - faixa.deduzir) / faturamento;
  const total = faturamento * efetiva;
  return {
    aplicavel: true,
    total: fx(total),
    aliquota_efetiva: efetiva,
    memoria: {
      formula: '((RBT12 × alíquota nominal) − parcela a deduzir) ÷ RBT12',
      anexo: p.anexo, faixa, aliquota_efetiva: efetiva,
    },
  };
}

function simulaPresumido({ faturamento, iss }) {
  const p = PARAMETROS_FISCAIS.presumido;
  const baseIr = faturamento * p.presuncao_irpj;
  const adicional = Math.max(0, baseIr - p.irpj_adicional_limite_anual) * p.irpj_adicional;
  const irpj = baseIr * p.irpj + adicional;
  const csll = faturamento * p.presuncao_csll * p.csll;
  const pisCofins = faturamento * p.pis_cofins;
  const issV = faturamento * (iss ?? p.iss_padrao);
  const total = irpj + csll + pisCofins + issV;
  return {
    aplicavel: true, total: fx(total),
    aliquota_efetiva: total / faturamento,
    componentes: { irpj: fx(irpj), csll: fx(csll), pis_cofins: fx(pisCofins), iss: fx(issV) },
    memoria: { base_presumida: fx(baseIr), presuncao: p.presuncao_irpj, adicional_irpj: fx(adicional) },
  };
}

function simulaReal({ faturamento, custos, capex, iss }) {
  const p = PARAMETROS_FISCAIS.real;
  const lucro = Math.max(0, faturamento - custos);
  const adicional = Math.max(0, lucro - p.irpj_adicional_limite_anual) * p.irpj_adicional;
  const irpj = lucro * p.irpj + adicional;
  const csll = lucro * p.csll;
  const creditos = (custos + capex) * p.credito_pis_cofins_sobre_capex;
  const pisCofins = Math.max(0, faturamento * p.pis_cofins - creditos);
  const issV = faturamento * (iss ?? p.iss_padrao);
  const total = irpj + csll + pisCofins + issV;
  return {
    aplicavel: true, total: fx(total),
    aliquota_efetiva: total / faturamento,
    componentes: { irpj: fx(irpj), csll: fx(csll), pis_cofins: fx(pisCofins), iss: fx(issV) },
    memoria: {
      lucro_real: fx(lucro), creditos_pis_cofins: fx(creditos),
      nota: 'Lucro Real é pré-requisito da Lei do Bem e do SUDAM/SUDENE (§6.3).',
    },
  };
}

/** Cenário CBS/IBS: crédito amplo sobre custos e CAPEX de rede. */
function simulaReforma({ faturamento, custos, capex, ano, curva }) {
  const p = PARAMETROS_FISCAIS.reforma;
  const linha = curva?.find((c) => c.ano === ano) ?? null;
  const proporcao = linha ? (Number(linha.cbs_pct) + Number(linha.ibs_pct)) / 200 : 1;

  const debito  = faturamento * p.aliquota_referencia * proporcao;
  const credito = p.credito_amplo ? (custos + capex) * p.aliquota_referencia * proporcao : 0;
  const total = Math.max(0, debito - credito);

  return {
    aplicavel: true, total: fx(total), ano,
    aliquota_efetiva: total / faturamento,
    memoria: {
      formula: '(faturamento × alíquota × proporção do ano) − (custos + CAPEX) × alíquota × proporção',
      aliquota_referencia: p.aliquota_referencia,
      proporcao_ano: proporcao,
      curva_ano: linha,
      nota: 'Crédito amplo sobre CAPEX de rede é a principal virada de chave para ISP intensivo em investimento.',
    },
  };
}

export async function curvaReforma() {
  const { data, error } = await sb.from('reforma_transicao').select('*').order('ano');
  if (error) throw error;
  return data ?? [];
}

/**
 * Compara os três regimes + o cenário da reforma.
 * @returns objeto pronto para gravar em `simulacoes_tributarias.resultado`
 */
export async function simularRegimes({ faturamento, custos = 0, capex = 0, iss = null, ano = new Date().getFullYear() }) {
  const f = Number(faturamento);
  if (!isFinite(f) || f <= 0) throw new Error('Informe um faturamento anual válido.');

  const curva = await curvaReforma();
  const cenarios = {
    simples:   simulaSimples({ faturamento: f }),
    presumido: simulaPresumido({ faturamento: f, iss }),
    real:      simulaReal({ faturamento: f, custos: Number(custos), capex: Number(capex), iss }),
    reforma:   simulaReforma({ faturamento: f, custos: Number(custos), capex: Number(capex), ano, curva }),
  };

  const comparaveis = Object.entries(cenarios)
    .filter(([k, v]) => k !== 'reforma' && v.aplicavel)
    .sort((a, b) => a[1].total - b[1].total);

  return {
    parametros: { faturamento: f, custos: Number(custos), capex: Number(capex), iss, ano },
    cenarios,
    recomendado: comparaveis[0]?.[0] ?? null,
    economia_vs_pior: comparaveis.length > 1
      ? fx(comparaveis.at(-1)[1].total - comparaveis[0][1].total)
      : null,
    validacao: PARAMETROS_FISCAIS.validacao,
    disclaimer: 'Comparativo técnico parametrizado. Não é apuração fiscal nem '
              + 'parecer contábil — a escolha de regime exige contador registrado (§12).',
    gerado_em: new Date().toISOString(),
  };
}

/* ====================================================================
 * 3. Exposição à reforma (§7.3 — curva de extinção de benefícios)
 * ==================================================================== */
export function exposicaoReforma({ economiaIcmsAnual, curva }) {
  return curva.map((c) => {
    const remanescente = economiaIcmsAnual * (Number(c.beneficios_icms_pct) / 100);
    return {
      ano: c.ano,
      beneficios_pct: Number(c.beneficios_icms_pct),
      economia_remanescente: fx(remanescente),
      perda_anual: fx(economiaIcmsAnual - remanescente),
      observacao: c.observacao,
    };
  });
}
