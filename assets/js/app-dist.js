/* =====================================================================
 * dist.html — Módulo 2 (§7). DI/TTD, ex-tarifário, CT-e, reversa,
 * curva da reforma e relatório ESG de cadeia de suprimentos.
 * ===================================================================== */
import { sb, exigirSessao, empresaDeTrabalho, formataCnpj, normalizaCnpj } from './db.js';
import { registrarDocumento, listarDocumentos } from './docfonte.js';
import { lancar, lancarRateioReversa, balanco, lancamentos, categoriasDoPerfil } from './carbono.js';
import { funilDaEmpresa, salvarFunil, curvaReforma, exposicaoReforma } from './fiscal.js';
import { lerCTe, lerLote } from './xml.js';
import * as ui from './ui.js';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let EMPRESA = null;
let FUNIL = [];
const CATS = categoriasDoPerfil('distribuidor_telecom');

/* ============================================================ arranque */
(async function () {
  await exigirSessao();
  EMPRESA = await empresaDeTrabalho('distribuidor_telecom');
  if (!EMPRESA) {
    alert('Nenhuma empresa com perfil Distribuidor encontrada. Cadastre uma no painel.');
    location.href = 'index.html';
    return;
  }

  $('#app').classList.remove('aba-oculta');
  $('#box-empresa').innerHTML =
    `<strong>${ui.esc(EMPRESA.razao_social)}</strong>
     <code>${formataCnpj(EMPRESA.cnpj)}</code>
     <div style="margin-top:4px;color:var(--ink-400)">${ui.esc(EMPRESA.uf ?? '')} · ${EMPRESA.regime ?? 'regime não informado'}</div>`;

  const TITULOS = {
    dashboard:   ['Dashboard', 'ICMS realizado, exposição à reforma e balanço de carbono'],
    importacao:  ['Importação', 'DIs, enquadramentos e condicionantes do TTD'],
    extarifario: ['Ex-tarifário', 'NCMs do portfólio × pleitos vigentes'],
    logistica:   ['Logística (CT-e)', 'Embarques e escopo 3 de transporte'],
    reversa:     ['Reversa & Certificados', 'Lotes, CDFs e rateio do ativo de carbono'],
    reforma:     ['Reforma 2026–2033', 'Curva de transição e habilitações'],
    incentivos:  ['Incentivos', 'Funil de qualificação'],
    vendor:      ['Relatório Vendor ESG', 'Cadeia de suprimentos, bilíngue'],
  };

  ui.montarNavegacao({
    nav: $('#nav'), telas: $$('.conteudo > section'),
    aoTrocar: (id) => {
      const [t, s] = TITULOS[id] ?? [id, ''];
      $('#titulo').textContent = t; $('#subtitulo').textContent = s;
      CARREGADORES[id]?.().catch(ui.erro);
    },
  });

  ligarFormularios();
})().catch(ui.erro);

/* --------------------------------------------------------- utilitários */
async function dis() {
  const { data, error } = await sb.from('declaracoes_importacao')
    .select('*').eq('empresa_id', EMPRESA.id).order('data_registro', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

const economiaIcmsTotal = (lista) =>
  lista.reduce((a, d) => a + Number(d.economia_realizada ?? 0), 0);

/* =========================================================== dashboard */
async function renderDashboard() {
  const ano = new Date().getFullYear();
  const [b, listaDi, { data: cond }] = await Promise.all([
    balanco(EMPRESA.id, { de: `${ano}-01-01`, ate: `${ano}-12-31` }),
    dis(),
    sb.from('condicionantes_ttd').select('*').eq('empresa_id', EMPRESA.id)
      .order('proximo_prazo', { ascending: true }).limit(6),
  ]);

  const economia = economiaIcmsTotal(listaDi.filter((d) => (d.data_registro ?? '').startsWith(String(ano))));
  const curva = await curvaReforma();
  const em2032 = exposicaoReforma({ economiaIcmsAnual: economia, curva }).find((c) => c.ano === 2032);
  const atrasadas = (cond ?? []).filter((c) => c.status === 'atrasada').length;

  $('#kpis').innerHTML = `
    <div class="kpi kpi--fiscal"><dt>ICMS economizado ${ano}</dt>
      <dd style="font-size:21px">${ui.fmtMoeda(economia)}</dd>
      <div class="rodape">${listaDi.length} DI(s) · ${ui.seloValidacao('nao_validado')}</div></div>
    <div class="kpi kpi--alerta"><dt>Exposição à reforma (2032)</dt>
      <dd style="font-size:21px">${ui.fmtMoeda(em2032?.perda_anual ?? 0)}</dd>
      <div class="rodape">perda anual projetada se nada for habilitado</div></div>
    <div class="kpi kpi--passivo"><dt>Passivo</dt>
      <dd>${ui.fmtTCO2e(b.passivo)}<small>tCO₂e</small></dd>
      <div class="rodape">CT-e, armazenagem e frota</div></div>
    <div class="kpi kpi--ativo"><dt>Ativo</dt>
      <dd>${ui.fmtTCO2e(b.ativo)}<small>tCO₂e</small></dd>
      <div class="rodape">${atrasadas ? `⚠ ${atrasadas} condicionante(s) atrasada(s)` : 'reversa certificada'}</div></div>`;

  const escopos = [1, 2, 3].map((e) => ({ escopo: e, ...(b.porEscopo[e] ?? { passivo: 0, ativo: 0 }) }));
  ui.preencherTabela($('#tb-escopos'), escopos, (l) => `
    <tr><td>Escopo ${l.escopo}</td><td class="n">${ui.fmtTCO2e(l.passivo)}</td>
      <td class="n">${ui.fmtTCO2e(l.ativo)}</td><td>${ui.barraBalanco(l.passivo, l.ativo)}</td></tr>`, 4);

  ui.preencherTabela($('#tb-cond-resumo'), cond, (c) => `
    <tr><td>${ui.esc(c.descricao)}</td>
      <td>${ui.fmtData(c.proximo_prazo)}</td>
      <td>${seloCondicionante(c)}</td></tr>`, 3, 'Nenhuma condicionante cadastrada.');

  const ls = await lancamentos(EMPRESA.id, 40);
  ui.preencherTabela($('#tb-lancamentos'), ls, (l) => `
    <tr>
      <td>${ui.fmtComp(l.competencia)}</td>
      <td>${ui.esc(CATS[l.categoria]?.rotulo ?? l.categoria)}</td>
      <td><span class="selo selo--${l.natureza}">${l.natureza}</span></td>
      <td class="n">${l.escopo}</td>
      <td class="n"><strong>${ui.fmtTCO2e(l.quantidade_tco2e)}</strong></td>
      <td><code style="font-size:11px">${ui.esc(l.documentos_fonte?.tipo ?? '—')}</code>
        <div class="num" style="font-size:10.5px;color:var(--ink-400)">${(l.documentos_fonte?.hash_sha256 ?? '').slice(0, 16)}…</div></td>
    </tr>`, 6, 'Nenhum lançamento ainda.');
}

function seloCondicionante(c) {
  if (c.status === 'cumprida')  return '<span class="selo selo--validado">cumprida</span>';
  if (c.status === 'dispensada') return '<span class="selo selo--neutro">dispensada</span>';
  const vencida = c.proximo_prazo && c.proximo_prazo < ui.hoje();
  return vencida || c.status === 'atrasada'
    ? '<span class="selo selo--risco">atrasada</span>'
    : '<span class="selo selo--nao_validado">pendente</span>';
}

/* ========================================================== importação */
async function renderImportacao() {
  const lista = await dis();
  $('#selo-di').textContent = `economia acumulada ${ui.fmtMoeda(economiaIcmsTotal(lista))}`;

  ui.preencherTabela($('#tb-di'), lista, (d) => `
    <tr>
      <td class="num"><strong>${ui.esc(d.numero_di)}</strong></td>
      <td>${ui.fmtData(d.data_registro)}</td>
      <td>${ui.esc(d.uf_desembaraco ?? '—')}</td>
      <td>${d.enquadramento ? `<span class="selo selo--neutro">${ui.esc(d.enquadramento)}</span>` : '—'}</td>
      <td class="n">${ui.fmtMoeda(d.valor_aduaneiro)}</td>
      <td class="n">${ui.fmtMoeda(d.icms_sem_beneficio)}</td>
      <td class="n">${ui.fmtMoeda(d.icms_com_beneficio)}</td>
      <td class="n"><strong style="color:var(--verde-600)">${ui.fmtMoeda(d.economia_realizada)}</strong></td>
    </tr>`, 8, 'Nenhuma DI registrada.');

  const { data: cond, error } = await sb.from('condicionantes_ttd')
    .select('*').eq('empresa_id', EMPRESA.id).order('proximo_prazo');
  if (error) throw error;

  ui.preencherTabela($('#tb-cond'), cond, (c) => `
    <tr>
      <td><span class="selo selo--neutro">${ui.esc(c.enquadramento)}</span></td>
      <td>${ui.esc(c.descricao)}</td>
      <td>${ui.esc(c.periodicidade ?? '—')}</td>
      <td>${ui.fmtData(c.proximo_prazo)}</td>
      <td>${seloCondicionante(c)}</td>
      <td>${['cumprida','atrasada','dispensada'].map((s) =>
        `<button class="btn btn--peq btn--sec" data-cond="${c.id}" data-status="${s}">${s}</button>`).join(' ')}</td>
    </tr>`, 6, 'Nenhuma condicionante.');

  $$('#tb-cond [data-cond]').forEach((b) =>
    b.addEventListener('click', async () => {
      const { error } = await sb.from('condicionantes_ttd')
        .update({ status: b.dataset.status }).eq('id', b.dataset.cond);
      if (error) return ui.erro(error);
      ui.toast('Condicionante atualizada.');
      renderImportacao();
    }));
}

/* ========================================================= ex-tarifário */
async function renderExTarifario() {
  const [{ data: ncms }, { data: pleitos }] = await Promise.all([
    sb.from('portfolio_ncm').select('*').eq('empresa_id', EMPRESA.id).order('ncm'),
    sb.from('ex_tarifario_pleitos').select('*'),
  ]);

  const hoje = ui.hoje();
  const porNcm = new Map();
  for (const p of pleitos ?? []) {
    if (p.vigencia_fim && p.vigencia_fim < hoje) continue;
    if (!porNcm.has(p.ncm)) porNcm.set(p.ncm, p);
  }

  ui.preencherTabela($('#tb-ncm'), ncms, (n) => {
    const p = porNcm.get(n.ncm);
    return `<tr>
      <td class="num"><strong>${ui.esc(n.ncm)}</strong></td>
      <td>${ui.esc(n.descricao)}</td>
      <td class="n">${ui.fmtMoeda(n.volume_anual)}</td>
      <td>${p
        ? `<span class="selo selo--ativo">oportunidade</span>
           <div style="font-size:11.5px;color:var(--ink-500)">${ui.esc(p.ato_normativo ?? p.descricao)}</div>
           ${ui.seloValidacao(p.validacao)}`
        : '<span class="selo selo--neutro">sem pleito cadastrado</span>'}</td>
      <td class="n">${p?.aliquota_ii_reduzida != null ? `${ui.fmtNum(p.aliquota_ii_reduzida, 2)}%` : '—'}</td>
      <td>${p ? `${ui.fmtData(p.vigencia_ini)} → ${ui.fmtData(p.vigencia_fim)}` : '—'}</td>
    </tr>`;
  }, 6, 'Adicione NCMs do seu portfólio para cruzar com os pleitos.');
}

/* ============================================================ logística */
async function renderLogistica() {
  const docs = await listarDocumentos(EMPRESA.id, 'cte', 500);
  ui.preencherTabela($('#tb-cte'), docs, (d) => {
    const p = d.payload ?? {};
    const tkm = (p.peso_toneladas ?? 0) * (p.distancia_km ?? 0);
    return `<tr>
      <td>${ui.fmtData(p.emissao)}</td>
      <td>${ui.esc(p.modal ?? '—')}</td>
      <td style="font-size:12px">${ui.esc(p.uf_inicio ?? '?')} → ${ui.esc(p.uf_fim ?? '?')}</td>
      <td class="n">${ui.fmtNum(p.peso_toneladas, 3)}</td>
      <td class="n">${ui.fmtNum(p.distancia_km, 0)}</td>
      <td class="n">${ui.fmtNum(tkm, 2)}</td>
      <td>${(d.inconsistencias ?? []).length
        ? `<span class="selo selo--nao_validado" title="${ui.esc((d.inconsistencias ?? []).join(' · '))}">${d.inconsistencias.length}</span>`
        : '<span class="selo selo--validado">ok</span>'}</td>
    </tr>`;
  }, 7, 'Nenhum CT-e importado.');
}

/* ============================================================== reversa */
async function ispsVinculados() {
  const { data, error } = await sb.from('vinculos_comerciais')
    .select('isp_id, rateio_isp_pct, consentido, isp:isp_id(razao_social)')
    .eq('distribuidor_id', EMPRESA.id).eq('consentido', true);
  if (error) throw error;
  return data ?? [];
}

async function renderReversa() {
  const vinculos = await ispsVinculados();
  $('#sel-isp').innerHTML = '<option value="">— sem rateio —</option>' +
    vinculos.map((v) => `<option value="${v.isp_id}" data-rateio="${v.rateio_isp_pct}">
      ${ui.esc(v.isp?.razao_social ?? v.isp_id)} (${ui.fmtNum(v.rateio_isp_pct, 0)}%)</option>`).join('');

  const { data: lotes, error } = await sb.from('lotes_reversa')
    .select('*, isp:isp_parceiro_id(razao_social)')
    .eq('empresa_id', EMPRESA.id).order('criado_em', { ascending: false });
  if (error) throw error;

  const CORES = { coleta: 'neutro', transporte: 'neutro', destinado: 'em_validacao', certificado: 'validado' };

  ui.preencherTabela($('#tb-lotes'), lotes, (l) => `
    <tr>
      <td><strong>${ui.esc(l.identificacao ?? l.id.slice(0, 8))}</strong>
        ${l.isp ? `<div style="font-size:11.5px;color:var(--ink-500)">ISP: ${ui.esc(l.isp.razao_social)}</div>` : ''}</td>
      <td class="n">${ui.fmtNum(l.peso_kg, 2)} kg</td>
      <td style="font-size:12px">${ui.esc(l.destinador_nome ?? l.destinador_cnpj ?? '—')}</td>
      <td><span class="selo selo--${CORES[l.status]}">${l.status}</span></td>
      <td class="n">${ui.fmtNum(l.rateio_isp_pct, 2)}%</td>
      <td style="font-size:11.5px">
        ${l.mtr_id ? '<span class="selo selo--validado">MTR</span>' : '<span class="selo selo--neutro">sem MTR</span>'}
        ${l.cdf_id ? '<span class="selo selo--validado">CDF</span>' : '<span class="selo selo--nao_validado">sem CDF</span>'}</td>
      <td>
        ${!l.mtr_id ? `<button class="btn btn--peq btn--sec" data-anexar="${l.id}" data-tipo="mtr">Anexar MTR</button>` : ''}
        ${l.mtr_id && !l.cdf_id ? `<button class="btn btn--peq" data-anexar="${l.id}" data-tipo="cdf">Anexar CDF</button>` : ''}
        ${l.cdf_id && l.status !== 'certificado' ? `<button class="btn btn--peq" data-certificar="${l.id}">Certificar</button>` : ''}
      </td>
    </tr>`, 7, 'Nenhum lote de reversa.');

  $$('#tb-lotes [data-anexar]').forEach((b) =>
    b.addEventListener('click', () => anexarDocLote(b.dataset.anexar, b.dataset.tipo).catch(ui.erro)));
  $$('#tb-lotes [data-certificar]').forEach((b) =>
    b.addEventListener('click', () => certificarLote(b.dataset.certificar).catch(ui.erro)));

  const { data: certs } = await sb.from('certificados_reciclagem')
    .select('*, lote:lote_id(identificacao)').order('criado_em', { ascending: false });

  ui.preencherTabela($('#tb-certificados'), certs, (c) => `
    <tr>
      <td>${ui.esc(c.lote?.identificacao ?? c.lote_id.slice(0, 8))}</td>
      <td>${ui.esc(c.tipo)}<div style="font-size:11px;color:var(--ink-400)">${ui.esc(c.base_legal ?? '')}</div></td>
      <td class="n">${ui.fmtNum(c.quantidade, 2)} ${ui.esc(c.unidade)}</td>
      <td class="num">${ui.esc(c.numero_externo ?? '—')}</td>
      <td>${ui.fmtData(c.emitido_em)}</td>
    </tr>`, 5, 'Nenhum certificado emitido.');
}

/** Abre um seletor de arquivo e amarra o documento ao lote. */
function escolherArquivo(accept = '*') {
  return new Promise((resolve) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept });
    inp.addEventListener('change', () => resolve(inp.files[0] ?? null), { once: true });
    inp.click();
  });
}

async function anexarDocLote(loteId, tipo) {
  const arquivo = await escolherArquivo('.pdf,.xml,image/*');
  if (!arquivo) return;

  const { doc } = await registrarDocumento({
    empresaId: EMPRESA.id, tipo, arquivo,
    payload: { lote_id: loteId, anexado_em: new Date().toISOString() },
  });

  const patch = tipo === 'mtr'
    ? { mtr_id: doc.id, status: 'transporte' }
    : { cdf_id: doc.id, status: 'destinado', destinado_em: ui.hoje() };

  const { error } = await sb.from('lotes_reversa').update(patch).eq('id', loteId);
  if (error) throw error;

  ui.toast(`${tipo.toUpperCase()} anexado. Hash ${doc.hash_sha256.slice(0, 12)}…`);
  renderReversa();
}

/**
 * §8 — certificar o lote emite o certificado e gera o rateio do ativo de
 * carbono entre distribuidor e ISP parceiro, ambos amarrados ao CDF.
 */
async function certificarLote(loteId) {
  const { data: lote, error } = await sb.from('lotes_reversa').select('*').eq('id', loteId).single();
  if (error) throw error;
  if (!lote.cdf_id) throw new Error('Lote sem CDF — o banco não permite certificar (§1.1).');

  const numero = prompt('Número externo do certificado (opcional):') || null;

  const { error: e1 } = await sb.from('certificados_reciclagem').insert({
    lote_id: loteId, tipo: 'credito_reciclagem',
    quantidade: lote.peso_kg, unidade: 'kg',
    numero_externo: numero, emitido_em: ui.hoje(),
  });
  if (e1) throw e1;

  const feitos = await lancarRateioReversa({
    lote, cdfId: lote.cdf_id, competencia: ui.competenciaAtual(),
  });

  const { error: e2 } = await sb.from('lotes_reversa')
    .update({ status: 'certificado' }).eq('id', loteId);
  if (e2) throw e2;

  ui.toast(`Certificado emitido. ${feitos.length} lançamento(s) ativo(s) de carbono gerado(s) por rateio.`, 'ok', 8000);
  renderReversa();
}

/* ============================================================== reforma */
async function renderReforma(economiaInformada = null) {
  const curva = await curvaReforma();
  const economia = economiaInformada ?? economiaIcmsTotal(await dis());
  const proj = exposicaoReforma({ economiaIcmsAnual: economia, curva });

  ui.preencherTabela($('#tb-reforma'), curva, (c) => {
    const p = proj.find((x) => x.ano === c.ano);
    return `<tr>
      <td class="n"><strong>${c.ano}</strong></td>
      <td class="n">${ui.fmtNum(c.cbs_pct, 2)}%</td>
      <td class="n">${ui.fmtNum(c.ibs_pct, 2)}%</td>
      <td class="n">${ui.fmtNum(c.icms_iss_pct, 2)}%</td>
      <td class="n">${ui.fmtNum(c.beneficios_icms_pct, 2)}%</td>
      <td class="n">${ui.fmtMoeda(p?.economia_remanescente)}</td>
      <td class="n"${(p?.perda_anual ?? 0) > 0 ? ' style="color:var(--rubro-600)"' : ''}>
        ${ui.fmtMoeda(p?.perda_anual)}</td>
      <td style="font-size:11.5px;color:var(--ink-500)">${ui.esc(c.observacao ?? '')}</td>
    </tr>`;
  }, 8);
}

/* =========================================================== incentivos */
async function renderIncentivos() {
  FUNIL = await funilDaEmpresa(EMPRESA);

  const contagem = Object.fromEntries(ui.ORDEM_ETAPAS.map((e) => [e, FUNIL.filter((f) => f.etapa === e).length]));
  const total = FUNIL.length || 1;
  $('#funil-resumo').innerHTML = ui.ORDEM_ETAPAS.map((e) => `
    <div class="funil__etapa"><span>${ui.ROTULO_ETAPA[e]}</span>
      <div class="trilho"><i style="width:${(contagem[e] / total * 100).toFixed(1)}%"></i></div>
      <span class="num" style="text-align:right">${contagem[e]}</span></div>`).join('');

  ui.preencherTabela($('#tb-incentivos'), FUNIL, (f) => {
    const reqs = f.requisitos.map((r) => {
      const cls = r.situacao === 'atendido' ? 'validado' : r.situacao === 'pendente' ? 'nao_validado' : 'risco';
      return `<div><span class="selo selo--${cls}" style="min-width:74px">${
        r.situacao === 'atendido' ? 'ok' : r.situacao === 'pendente' ? 'confirmar' : 'não'
      }</span> <span style="font-size:12px">${ui.esc(r.rotulo ?? r.chave)}</span></div>`;
    }).join('');

    return `<tr>
      <td><strong>${ui.esc(f.incentivo.nome)}</strong>
        <div style="font-size:11.5px;color:var(--ink-500)">${ui.esc(f.incentivo.base_legal)}</div></td>
      <td style="min-width:210px">${reqs || '—'}</td>
      <td><span class="selo selo--${f.etapa === 'ativo' ? 'validado' : 'neutro'}">${ui.ROTULO_ETAPA[f.etapa]}</span></td>
      <td class="n"><input type="number" step="0.01" min="0" style="width:130px;text-align:right"
            data-est="${f.incentivo.id}" value="${f.economia_estimada ?? ''}"></td>
      <td>${ui.seloReforma(f.incentivo.status_reforma)}</td>
      <td>${ui.seloValidacao(f.incentivo.validacao)}</td>
      <td><select data-etapa="${f.incentivo.id}" style="min-width:150px">
        ${['triagem','elegivel','dossie','validacao_parceiro','ativo','negado'].map((e) =>
          `<option value="${e}"${e === f.etapa ? ' selected' : ''}>${ui.ROTULO_ETAPA[e]}</option>`).join('')}
      </select></td></tr>`;
  }, 7);

  const gravar = async (id) => {
    const etapa = $(`#tb-incentivos [data-etapa="${id}"]`).value;
    const est   = $(`#tb-incentivos [data-est="${id}"]`).value;
    let parceiro = null, validadoEm = null;
    if (etapa === 'ativo') {
      parceiro = prompt('Etapa "ativo" exige validação de parceiro licenciado (§12.4).\n\nNome/registro (OAB ou CRC):');
      if (!parceiro) { ui.toast('Etapa não alterada.', 'aviso'); return renderIncentivos(); }
      validadoEm = ui.hoje();
    }
    await salvarFunil({ empresaId: EMPRESA.id, incentivoId: id, etapa,
      estimada: est === '' ? null : Number(est), parceiro, validadoEm });
    ui.toast('Funil atualizado.');
    renderIncentivos();
  };

  $$('#tb-incentivos [data-etapa]').forEach((s) => s.addEventListener('change', () => gravar(s.dataset.etapa).catch(ui.erro)));
  $$('#tb-incentivos [data-est]').forEach((i) => i.addEventListener('change', () => gravar(i.dataset.est).catch(ui.erro)));
}

/* =============================================== relatório Vendor ESG */
const TXT = {
  pt: {
    titulo: 'Relatório ESG de Cadeia de Suprimentos',
    empresa: 'Empresa', exercicio: 'Exercício', emissoes: 'Emissões (passivo)',
    remocoes: 'Remoções e desvios (ativo)', liquido: 'Saldo líquido',
    escopo: 'Escopo', reversa: 'Logística reversa de eletroeletrônicos',
    lotes: 'Lotes destinados', peso: 'Massa destinada', certificados: 'Certificados emitidos',
    lastro: 'Lastro documental', parceiros: 'ISPs parceiros no ciclo fechado',
    metodologia: 'Metodologia',
    metodologiaTxt: 'Partidas dobradas de carbono. Cada lançamento é derivado de um '
      + 'documento-fonte com hash SHA-256 verificável (NF-e, CT-e, fatura de energia, MTR, CDF). '
      + 'Fatores de emissão e memória de cálculo acompanham cada linha.',
    ressalva: 'Ressalva',
    ressalvaTxt: 'Documento de evidência técnica. Não constitui parecer jurídico ou contábil. '
      + 'Itens marcados como não validados são estimativas pendentes de conferência.',
  },
  en: {
    titulo: 'Supply Chain ESG Report',
    empresa: 'Company', exercicio: 'Reporting year', emissoes: 'Emissions (liability)',
    remocoes: 'Removals and diversions (asset)', liquido: 'Net balance',
    escopo: 'Scope', reversa: 'WEEE reverse logistics',
    lotes: 'Batches sent to final destination', peso: 'Mass diverted', certificados: 'Certificates issued',
    lastro: 'Documentary backing', parceiros: 'ISP partners in the closed loop',
    metodologia: 'Methodology',
    metodologiaTxt: 'Double-entry carbon accounting. Every entry is derived from a source '
      + 'document with a verifiable SHA-256 hash (Brazilian e-invoices NF-e/CT-e, utility bills, '
      + 'waste manifests MTR and final destination certificates CDF). Emission factors and the '
      + 'calculation trail accompany each line.',
    ressalva: 'Disclaimer',
    ressalvaTxt: 'Technical evidence document. It does not constitute legal or accounting advice. '
      + 'Items flagged as not validated are estimates pending review.',
  },
};

async function renderVendorRelatorio() {
  const idioma = $('#sel-idioma').value;
  const t = TXT[idioma];
  const ano = new Date().getFullYear();

  const [b, { data: lotes }, { data: certs }, vinculos] = await Promise.all([
    balanco(EMPRESA.id, { de: `${ano}-01-01`, ate: `${ano}-12-31` }),
    sb.from('lotes_reversa').select('peso_kg, status').eq('empresa_id', EMPRESA.id),
    sb.from('certificados_reciclagem').select('quantidade, unidade'),
    ispsVinculados(),
  ]);

  const destinados = (lotes ?? []).filter((l) => ['destinado', 'certificado'].includes(l.status));
  const massa = destinados.reduce((a, l) => a + Number(l.peso_kg ?? 0), 0);
  const docs = await listarDocumentos(EMPRESA.id, null, 1000);

  $('#saida-vendor').innerHTML = `
    <div id="vendor-doc">
      <h2 style="font-size:17px">${t.titulo} — ${ano}</h2>
      <p style="color:var(--ink-500)">${t.empresa}: <strong>${ui.esc(EMPRESA.razao_social)}</strong>
         · CNPJ ${formataCnpj(EMPRESA.cnpj)} · ${ui.esc(EMPRESA.uf ?? '')}</p>

      <dl class="grade grade--3" style="margin:18px 0">
        <div class="kpi kpi--passivo"><dt>${t.emissoes}</dt><dd style="font-size:20px">${ui.fmtTCO2e(b.passivo)}<small>tCO₂e</small></dd></div>
        <div class="kpi kpi--ativo"><dt>${t.remocoes}</dt><dd style="font-size:20px">${ui.fmtTCO2e(b.ativo)}<small>tCO₂e</small></dd></div>
        <div class="kpi"><dt>${t.liquido}</dt><dd style="font-size:20px">${ui.fmtTCO2e(b.liquido)}<small>tCO₂e</small></dd></div>
      </dl>

      <h3>${t.escopo} 1 · 2 · 3</h3>
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>${t.escopo}</th><th class="n">${t.emissoes}</th><th class="n">${t.remocoes}</th></tr></thead>
        <tbody>${[1, 2, 3].map((e) => {
          const v = b.porEscopo[e] ?? { passivo: 0, ativo: 0 };
          return `<tr><td>${t.escopo} ${e}</td><td class="n">${ui.fmtTCO2e(v.passivo)}</td>
                  <td class="n">${ui.fmtTCO2e(v.ativo)}</td></tr>`;
        }).join('')}</tbody></table></div>

      <h3 style="margin-top:22px">${t.reversa}</h3>
      <div class="tabela-wrap"><table class="tabela"><tbody>
        <tr><td>${t.lotes}</td><td class="n">${destinados.length}</td></tr>
        <tr><td>${t.peso}</td><td class="n">${ui.fmtNum(massa, 2)} kg</td></tr>
        <tr><td>${t.certificados}</td><td class="n">${(certs ?? []).length}</td></tr>
        <tr><td>${t.lastro}</td><td class="n">${docs.length} doc. (SHA-256)</td></tr>
        <tr><td>${t.parceiros}</td><td class="n">${vinculos.length}</td></tr>
      </tbody></table></div>

      <h3 style="margin-top:22px">${t.metodologia}</h3>
      <p class="dica">${t.metodologiaTxt}</p>

      <div class="aviso" style="margin-top:18px"><strong>${t.ressalva}</strong>${t.ressalvaTxt}</div>
    </div>
    <div class="linha" style="margin-top:16px">
      <button class="btn btn--sec" id="btn-vendor-print">Imprimir / PDF</button>
      <button class="btn btn--sec" id="btn-vendor-json">Exportar JSON</button>
    </div>`;

  $('#btn-vendor-print').addEventListener('click', () => window.print());
  $('#btn-vendor-json').addEventListener('click', () => {
    ui.baixarArquivo(`vendor-esg-${EMPRESA.cnpj}-${ano}-${idioma}.json`, JSON.stringify({
      report: t.titulo, company: EMPRESA.razao_social, cnpj: EMPRESA.cnpj, year: ano,
      emissions_tco2e: b.passivo, removals_tco2e: b.ativo, net_tco2e: b.liquido,
      by_scope: b.porEscopo, reverse_logistics: { batches: destinados.length, mass_kg: massa,
      certificates: (certs ?? []).length }, source_documents: docs.length,
      isp_partners: vinculos.length, disclaimer: t.ressalvaTxt,
    }, null, 2), 'application/json');
  });
}

/* ========================================================= formulários */
function ligarFormularios() {
  /* --- DI --- */
  $('#form-di').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const form = ev.target;
      const f = ui.lerForm(form);
      const arquivo = form.arquivo.files[0] ?? null;

      let docId = null;
      if (arquivo) {
        const { doc } = await registrarDocumento({
          empresaId: EMPRESA.id, tipo: 'di', arquivo,
          payload: { numero_di: f.numero_di, enquadramento: f.enquadramento },
        });
        docId = doc.id;
      }

      const sem = Number(f.icms_sem_beneficio ?? 0);
      const com = Number(f.icms_com_beneficio ?? 0);

      const { error } = await sb.from('declaracoes_importacao').insert({
        empresa_id: EMPRESA.id, numero_di: f.numero_di, data_registro: f.data_registro,
        uf_desembaraco: f.uf_desembaraco ? f.uf_desembaraco.toUpperCase() : null,
        valor_aduaneiro: Number(f.valor_aduaneiro),
        icms_sem_beneficio: sem, icms_com_beneficio: com,
        enquadramento: f.enquadramento, documento_fonte_id: docId,
        memoria_calculo: {
          formula: 'economia = ICMS sem benefício − ICMS com benefício',
          icms_sem_beneficio: sem, icms_com_beneficio: com, economia: sem - com,
          fonte_dos_valores: arquivo ? 'documento anexado' : 'declarado pelo usuário',
          aviso: 'Valor de economia é estimativa técnica; conferência fiscal é do contador (§12).',
        },
      });
      if (error) throw error;

      ui.toast(`DI registrada. Economia: ${ui.fmtMoeda(sem - com)}.`);
      form.reset(); renderImportacao();
    } catch (e) { ui.erro(e); }
  });

  /* --- condicionante --- */
  $('#form-cond').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ui.lerForm(ev.target);
    const { error } = await sb.from('condicionantes_ttd').insert({
      empresa_id: EMPRESA.id, enquadramento: f.enquadramento, descricao: f.descricao,
      periodicidade: f.periodicidade, proximo_prazo: f.proximo_prazo,
    });
    if (error) return ui.erro(error);
    ui.toast('Condicionante adicionada.');
    ev.target.reset(); renderImportacao();
  });

  /* --- NCM --- */
  $('#form-ncm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ui.lerForm(ev.target);
    const { error } = await sb.from('portfolio_ncm').insert({
      empresa_id: EMPRESA.id, ncm: f.ncm, descricao: f.descricao, volume_anual: f.volume_anual,
    });
    if (error) return ui.erro(error);
    ui.toast('NCM adicionado ao portfólio.');
    ev.target.reset(); renderExTarifario();
  });

  /* --- CT-e em lote --- */
  $('#form-cte').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const arquivos = [...form.arquivos.files];
    const km = Number(form.km.value);
    const rel = $('#relatorio-cte');
    rel.innerHTML = `<p class="dica">Processando ${arquivos.length} arquivo(s)…</p>`;

    const t0 = performance.now();
    const resultados = await lerLote(arquivos, lerCTe);
    const linhas = [];

    for (const r of resultados) {
      if (!r.ok) { linhas.push({ nome: r.arquivo.name, situacao: 'erro', detalhe: r.erro }); continue; }
      try {
        const d = { ...r.dados, distancia_km: km };
        d.inconsistencias = [...d.inconsistencias,
          `Distância de ${km} km informada pelo usuário como premissa do lote.`];

        const { doc, reaproveitado } = await registrarDocumento({
          empresaId: EMPRESA.id, tipo: 'cte', arquivo: r.arquivo,
          payload: d, chaveAcesso: d.chave_acesso, inconsistencias: d.inconsistencias,
        });

        if (reaproveitado) { linhas.push({ nome: r.arquivo.name, situacao: 'duplicado', detalhe: 'mesmo hash já registrado' }); continue; }

        if (!d.peso_toneladas) {
          linhas.push({ nome: r.arquivo.name, situacao: 'sem_lancamento',
            detalhe: 'CT-e gravado, mas sem peso em KG/TON — t·km não calculável.' });
          continue;
        }

        const tkm = d.peso_toneladas * km;
        await lancar({
          empresaId: EMPRESA.id, documentoFonteId: doc.id, perfil: 'distribuidor_telecom',
          categoria: d.modal === 'aereo' ? 'cte_aereo' : 'cte_transporte',
          quantidadeOrigem: tkm,
          competencia: `${(d.emissao ?? ui.hoje()).slice(0, 7)}-01`,
          observacao: `Rota ${d.uf_inicio ?? '?'}→${d.uf_fim ?? '?'} · ${d.peso_toneladas} t × ${km} km (km declarado).`,
        });

        linhas.push({ nome: r.arquivo.name, situacao: 'ok',
          detalhe: `${ui.fmtNum(d.peso_toneladas, 3)} t × ${km} km = ${ui.fmtNum(tkm, 2)} t·km` });
      } catch (e) {
        linhas.push({ nome: r.arquivo.name, situacao: 'erro', detalhe: e.message });
      }
    }

    const seg = ((performance.now() - t0) / 1000).toFixed(1);
    const cor = { ok: 'validado', duplicado: 'neutro', sem_lancamento: 'nao_validado', erro: 'risco' };
    const ok = linhas.filter((l) => l.situacao === 'ok').length;

    rel.innerHTML = `
      <p class="dica"><strong>${ok}/${linhas.length}</strong> lançados em ${seg}s
        (RNF-004: 1.000 CT-e em ≤ 60 s).</p>
      <div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Arquivo</th><th>Situação</th><th>Detalhe</th></tr></thead>
        <tbody>${linhas.map((l) => `<tr>
          <td class="num" style="font-size:12px">${ui.esc(l.nome)}</td>
          <td><span class="selo selo--${cor[l.situacao]}">${l.situacao.replace('_', ' ')}</span></td>
          <td style="font-size:12px">${ui.esc(l.detalhe)}</td></tr>`).join('')}</tbody>
      </table></div>`;

    renderLogistica();
  });

  /* --- lote de reversa --- */
  $('#form-lote').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const f = ui.lerForm(form);
    const opt = form.isp_parceiro_id.selectedOptions[0];

    const { error } = await sb.from('lotes_reversa').insert({
      empresa_id: EMPRESA.id,
      identificacao: f.identificacao,
      peso_kg: Number(f.peso_kg),
      qtd_equipamentos: f.qtd_equipamentos,
      destinador_cnpj: f.destinador_cnpj ? normalizaCnpj(f.destinador_cnpj) : null,
      destinador_nome: f.destinador_nome,
      isp_parceiro_id: f.isp_parceiro_id,
      rateio_isp_pct: f.isp_parceiro_id ? Number(opt?.dataset.rateio ?? 50) : 0,
      status: 'coleta', coletado_em: ui.hoje(),
    });
    if (error) return ui.erro(error);
    ui.toast('Lote criado. Anexe o MTR para avançar.');
    form.reset(); renderReversa();
  });

  /* --- reforma --- */
  $('#form-reforma').addEventListener('submit', (ev) => {
    ev.preventDefault();
    renderReforma(Number(ui.lerForm(ev.target).economia)).catch(ui.erro);
  });

  $('#btn-usar-di').addEventListener('click', async () => {
    const total = economiaIcmsTotal(await dis());
    $('#form-reforma').economia.value = total.toFixed(2);
    ui.toast(`Economia acumulada das DIs: ${ui.fmtMoeda(total)}.`);
    renderReforma(total).catch(ui.erro);
  });

  /* --- vendor --- */
  $('#btn-vendor').addEventListener('click', () => renderVendorRelatorio().catch(ui.erro));
}

const CARREGADORES = {
  dashboard: renderDashboard, importacao: renderImportacao,
  extarifario: renderExTarifario, logistica: renderLogistica,
  reversa: renderReversa, reforma: () => renderReforma(),
  incentivos: renderIncentivos,
  vendor: async () => {},
};
