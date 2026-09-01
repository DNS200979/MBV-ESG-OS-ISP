/* =====================================================================
 * Motor de partidas dobradas de carbono (§1.2, §5).
 *
 * Regras que o motor impõe, não sugere:
 *   1. Todo lançamento nasce amarrado a um `documento_fonte_id`;
 *   2. `memoria_calculo` é obrigatória — insumo, fator, fórmula e fonte;
 *   3. Correção é ESTORNO + novo lançamento; nunca UPDATE destrutivo.
 *
 * Equivale à extensão de PERFIS_SETORIAIS do `motor_ia.py` (§4).
 * ===================================================================== */
import { sb, usuarioAtual } from './db.js';

/* ------------------------------------------------- perfis setoriais */
export const PERFIS_SETORIAIS = {
  isp: {
    rotulo: 'Provedor de internet (ISP)',
    categorias: {
      energia_pop:   { rotulo: 'Energia de POPs / headend / data center', escopo: 2, natureza: 'passivo', fator: 'energia_rede_sin',    unidade: 'kWh',      doc: 'fatura_energia' },
      gd_solar:      { rotulo: 'Geração distribuída solar compensada',    escopo: 2, natureza: 'ativo',   fator: 'gd_solar_compensada', unidade: 'kWh',      doc: 'fatura_energia' },
      frota:         { rotulo: 'Frota de instalação e manutenção',        escopo: 1, natureza: 'passivo', fator: 'diesel_b',            unidade: 'L',        doc: 'nfe' },
      climatizacao:  { rotulo: 'Climatização (fuga de refrigerante)',     escopo: 1, natureza: 'passivo', fator: 'refrigerante_r410a',  unidade: 'kg',       doc: 'nfe' },
      comodato_cpe:  { rotulo: 'Equipamentos em comodato (CPE nova)',     escopo: 3, natureza: 'passivo', fator: 'equipamento_novo_cpe',unidade: 'unidade',  doc: 'nfe' },
      refurb:        { rotulo: 'Refurbish de CPE (carbono evitado)',      escopo: 3, natureza: 'ativo',   fator: 'refurb_onu',          unidade: 'unidade',  doc: 'outro' },
      ewaste:        { rotulo: 'Descarte / e-waste',                      escopo: 3, natureza: 'passivo', fator: 'ewaste_descartado',   unidade: 'kg',       doc: 'mtr' },
      reversa:       { rotulo: 'Logística reversa certificada',           escopo: 3, natureza: 'ativo',   fator: 'ewaste_reciclado',    unidade: 'kg',       doc: 'cdf' },
    },
  },
  distribuidor_telecom: {
    rotulo: 'Distribuidor de equipamentos de telecom',
    categorias: {
      cte_transporte:{ rotulo: 'Transporte de carga (CT-e)',              escopo: 3, natureza: 'passivo', fator: 'transporte_rodoviario', unidade: 't.km',  doc: 'cte' },
      cte_aereo:     { rotulo: 'Transporte aéreo de carga (CT-e)',        escopo: 3, natureza: 'passivo', fator: 'transporte_aereo',      unidade: 't.km',  doc: 'cte' },
      armazenagem:   { rotulo: 'Armazenagem (energia do CD)',             escopo: 2, natureza: 'passivo', fator: 'energia_rede_sin',      unidade: 'kWh',   doc: 'fatura_energia' },
      gd_solar:      { rotulo: 'Geração distribuída solar compensada',    escopo: 2, natureza: 'ativo',   fator: 'gd_solar_compensada',   unidade: 'kWh',   doc: 'fatura_energia' },
      frota:         { rotulo: 'Frota própria',                           escopo: 1, natureza: 'passivo', fator: 'diesel_b',              unidade: 'L',     doc: 'nfe' },
      reversa:       { rotulo: 'Logística reversa de eletroeletrônicos',  escopo: 3, natureza: 'ativo',   fator: 'ewaste_reciclado',      unidade: 'kg',    doc: 'cdf' },
      embalagens:    { rotulo: 'Embalagens',                              escopo: 3, natureza: 'passivo', fator: 'embalagem_papelao',     unidade: 'kg',    doc: 'nfe' },
    },
  },
};

export const categoriasDoPerfil = (perfil) => PERFIS_SETORIAIS[perfil]?.categorias ?? {};

/* -------------------------------------------------------- fatores */
let _cacheFatores = null;

export async function carregarFatores(forcar = false) {
  if (_cacheFatores && !forcar) return _cacheFatores;
  const { data, error } = await sb
    .from('fatores_emissao')
    .select('*')
    .lte('vigencia_ini', new Date().toISOString().slice(0, 10))
    .order('vigencia_ini', { ascending: false });
  if (error) throw error;

  const mapa = new Map();
  for (const f of data ?? []) if (!mapa.has(f.chave)) mapa.set(f.chave, f); // mais recente vence
  _cacheFatores = mapa;
  return mapa;
}

/** Um fator provisório contamina o lançamento: o selo desce junto. */
export const fatorProvisorio = (f) => (f?.validacao ?? 'nao_validado') !== 'validado';

/* ----------------------------------------------------- lançamento */

/**
 * Cria um lançamento de carbono a partir de uma quantidade na unidade de
 * origem do fator. Nunca aceita tCO2e "pronto": o valor é sempre derivado,
 * para que a memória de cálculo seja reproduzível.
 */
export async function lancar({
  empresaId, documentoFonteId, perfil, categoria,
  quantidadeOrigem, competencia, observacao = null,
  rateioPct = null, rateioOrigemId = null, sobrescreverFator = null,
}) {
  if (!documentoFonteId) {
    throw new Error('Lançamento sem documento-fonte é recusado pelo motor (§4.1).');
  }

  const def = categoriasDoPerfil(perfil)[categoria];
  if (!def) throw new Error(`Categoria "${categoria}" não existe no perfil "${perfil}".`);

  const q = Number(quantidadeOrigem);
  if (!isFinite(q) || q < 0) throw new Error('Quantidade inválida.');

  const fatores = await carregarFatores();
  const chaveFator = sobrescreverFator ?? def.fator;
  const fator = fatores.get(chaveFator);
  if (!fator) throw new Error(`Fator de emissão "${chaveFator}" não cadastrado.`);

  const bruto = q * Number(fator.fator_tco2e);
  const pct   = rateioPct == null ? 100 : Number(rateioPct);
  const tco2e = bruto * (pct / 100);

  const memoria = {
    formula: rateioPct == null
      ? 'tCO2e = quantidade × fator'
      : 'tCO2e = quantidade × fator × (rateio% ÷ 100)',
    insumo: { valor: q, unidade: def.unidade },
    fator: {
      chave: fator.chave,
      valor: Number(fator.fator_tco2e),
      unidade: `tCO2e/${fator.unidade_origem}`,
      fonte: fator.fonte,
      validacao: fator.validacao,
    },
    rateio_pct: rateioPct,
    resultado_bruto_tco2e: Number(bruto.toFixed(6)),
    resultado_tco2e: Number(tco2e.toFixed(6)),
    categoria: def.rotulo,
    escopo: def.escopo,
    natureza: def.natureza,
    observacao,
    calculado_em: new Date().toISOString(),
    aviso: fatorProvisorio(fator)
      ? 'Fator de emissão ainda não validado (§17) — resultado é estimativa técnica.'
      : null,
  };

  const u = await usuarioAtual();
  const { data, error } = await sb
    .from('lancamentos_carbono')
    .insert({
      empresa_id: empresaId,
      documento_fonte_id: documentoFonteId,
      fator_emissao_id: fator.id,
      natureza: def.natureza,
      escopo: def.escopo,
      categoria,
      quantidade_tco2e: Number(tco2e.toFixed(4)),
      competencia,
      memoria_calculo: memoria,
      rateio_origem_id: rateioOrigemId,
      criado_por: u?.id ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * §8 — rateio do ativo de carbono de um lote de reversa entre ISP e
 * distribuidor. Gera DOIS lançamentos, um por empresa, ambos apontando
 * para o mesmo CDF: é isso que fecha o ciclo de sinergia com trilha.
 */
export async function lancarRateioReversa({ lote, cdfId, competencia }) {
  const pctIsp = Number(lote.rateio_isp_pct ?? 50);
  const feitos = [];

  feitos.push(await lancar({
    empresaId: lote.empresa_id,
    documentoFonteId: cdfId,
    perfil: 'distribuidor_telecom',
    categoria: 'reversa',
    quantidadeOrigem: lote.peso_kg,
    competencia,
    rateioPct: 100 - pctIsp,
    rateioOrigemId: lote.id,
    observacao: `Lote ${lote.identificacao ?? lote.id} — parcela do destinador/distribuidor.`,
  }));

  if (lote.isp_parceiro_id) {
    feitos.push(await lancar({
      empresaId: lote.isp_parceiro_id,
      documentoFonteId: cdfId,
      perfil: 'isp',
      categoria: 'reversa',
      quantidadeOrigem: lote.peso_kg,
      competencia,
      rateioPct: pctIsp,
      rateioOrigemId: lote.id,
      observacao: `Lote ${lote.identificacao ?? lote.id} — parcela do ISP parceiro.`,
    }));
  }

  return feitos;
}

/* -------------------------------------------------------- consultas */
export async function balanco(empresaId, { de = null, ate = null } = {}) {
  let q = sb.from('vw_balanco_carbono').select('*').eq('empresa_id', empresaId);
  if (de)  q = q.gte('competencia', de);
  if (ate) q = q.lte('competencia', ate);
  const { data, error } = await q;
  if (error) throw error;

  const linhas = data ?? [];
  const passivo = linhas.reduce((a, l) => a + Number(l.passivo_tco2e ?? 0), 0);
  const ativo   = linhas.reduce((a, l) => a + Number(l.ativo_tco2e ?? 0), 0);

  const porEscopo = {};
  const porCategoria = {};
  for (const l of linhas) {
    const e = (porEscopo[l.escopo] ??= { passivo: 0, ativo: 0 });
    e.passivo += Number(l.passivo_tco2e ?? 0);
    e.ativo   += Number(l.ativo_tco2e ?? 0);

    const c = (porCategoria[l.categoria] ??= { passivo: 0, ativo: 0 });
    c.passivo += Number(l.passivo_tco2e ?? 0);
    c.ativo   += Number(l.ativo_tco2e ?? 0);
  }

  return { passivo, ativo, liquido: passivo - ativo, porEscopo, porCategoria, linhas };
}

export async function lancamentos(empresaId, limite = 300) {
  const { data, error } = await sb
    .from('lancamentos_carbono')
    .select('*, documentos_fonte(tipo, chave_acesso, hash_sha256, nome_arquivo)')
    .eq('empresa_id', empresaId)
    .is('estornado_por', null)
    .order('competencia', { ascending: false })
    .order('criado_em', { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data ?? [];
}

/* --------------------------------------------------- fechamento MRV */
export async function fecharCompetencia(empresaId, competencia) {
  const fim = new Date(competencia);
  fim.setMonth(fim.getMonth() + 1);
  const ate = fim.toISOString().slice(0, 10);

  const b = await balanco(empresaId, { de: competencia, ate });

  const { count } = await sb
    .from('documentos_fonte')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId);

  const u = await usuarioAtual();
  const { data, error } = await sb
    .from('fechamentos_mensais')
    .upsert({
      empresa_id: empresaId,
      competencia,
      total_passivo: Number(b.passivo.toFixed(4)),
      total_ativo: Number(b.ativo.toFixed(4)),
      qtd_documentos: count ?? 0,
      status: 'fechado',
      fechado_por: u?.id ?? null,
      fechado_em: new Date().toISOString(),
    }, { onConflict: 'empresa_id,competencia' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fechamentos(empresaId) {
  const { data, error } = await sb
    .from('fechamentos_mensais')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('competencia', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
