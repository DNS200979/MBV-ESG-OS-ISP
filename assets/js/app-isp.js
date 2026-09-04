/* =====================================================================
 * isp.html — Módulo 1 (§6). Sete telas mais P&D e fechamento MRV.
 * ===================================================================== */
import { sb, exigirSessao, empresaDeTrabalho, formataCnpj, consultaCnpj } from './db.js';
import { registrarDocumento, listarDocumentos } from './docfonte.js';
import { lancar, balanco, lancamentos, fecharCompetencia, fechamentos,
         categoriasDoPerfil, carregarFatores, fatorProvisorio } from './carbono.js';
import { funilDaEmpresa, salvarFunil, simularRegimes, PARAMETROS_FISCAIS } from './fiscal.js';
import { lerNFe, lerLote } from './xml.js';
import * as rev from './reversa.js';
import * as imp from './importador.js';
import * as impio from './importador-io.js';
import * as ui from './ui.js';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let EMPRESA = null;
let FUNIL = [];

const CATS = categoriasDoPerfil('isp');

/* ============================================================ arranque */
(async function () {
  await exigirSessao();
  EMPRESA = await empresaDeTrabalho('isp');
  if (!EMPRESA) {
    alert('Nenhuma empresa com perfil ISP encontrada. Cadastre uma no painel.');
    location.href = 'index.html';
    return;
  }

  $('#app').classList.remove('aba-oculta');
  $('#box-empresa').innerHTML =
    `<strong>${ui.esc(EMPRESA.razao_social)}</strong>
     <code>${formataCnpj(EMPRESA.cnpj)}</code>
     <div style="margin-top:4px;color:var(--ink-400)">${ui.esc(EMPRESA.uf ?? '')} · ${EMPRESA.regime ?? 'regime não informado'}</div>`;

  const TITULOS = {
    dashboard:  ['Dashboard', 'Balanço de carbono e economia fiscal'],
    energia:    ['Energia & POPs', 'Unidades consumidoras, faturas e oportunidade de GD'],
    frota:      ['Frota', 'NF-e de combustível — escopo 1'],
    comodato:   ['Comodato & inventário', 'Ativo de rede agora, triagem e destinação'],
    destinadores: ['Destinadores', 'Quem recebe o equipamento — com licença conferida'],
    produtos:   ['Catálogo de produtos', 'Peso e carbono incorporado com procedência'],
    importar:   ['Importar planilhas', 'CSV, XLSX e XML com de-para assistido'],
    conectores: ['Conectores ERP/CRM', 'Integração por token com escopo restrito'],
    incentivos: ['Incentivos', 'Funil de qualificação e dossiê probatório'],
    simulador:  ['Simulador de regime', 'Simples × Presumido × Real, com e sem reforma'],
    pd:         ['Projetos P&D', 'Lei do Bem — evidência técnica'],
    mrv:        ['Fechamento MRV', 'Consolidação mensal'],
    selo:       ['Selo ISP Verde', 'Relatório público de balanço'],
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

/* =========================================================== dashboard */
async function renderDashboard() {
  const ano = new Date().getFullYear();
  const b = await balanco(EMPRESA.id, { de: `${ano}-01-01`, ate: `${ano}-12-31` });
  const funil = FUNIL.length ? FUNIL : (FUNIL = await funilDaEmpresa(EMPRESA));

  const estimada = funil.reduce((a, f) => a + Number(f.economia_estimada ?? 0), 0);
  const validados = funil.filter((f) => f.etapa === 'ativo').length;
  const elegiveis = funil.filter((f) => f.elegivel).length;

  $('#kpis').innerHTML = `
    <div class="kpi kpi--passivo"><dt>Passivo (emissões)</dt>
      <dd>${ui.fmtTCO2e(b.passivo)}<small>tCO₂e</small></dd>
      <div class="rodape">Exercício ${ano}</div></div>
    <div class="kpi kpi--ativo"><dt>Ativo (remoções)</dt>
      <dd>${ui.fmtTCO2e(b.ativo)}<small>tCO₂e</small></dd>
      <div class="rodape">GD solar, refurb e reversa</div></div>
    <div class="kpi kpi--fiscal"><dt>Saldo líquido</dt>
      <dd>${ui.fmtTCO2e(b.liquido)}<small>tCO₂e</small></dd>
      <div class="rodape">${b.liquido < 0 ? 'Balanço positivo de remoção' : 'Abaixo do limiar SBCE de 10.000 t'}</div></div>
    <div class="kpi kpi--alerta"><dt>Economia estimada/ano</dt>
      <dd style="font-size:21px">${ui.fmtMoeda(estimada)}</dd>
      <div class="rodape">${elegiveis} elegível(is) · ${validados} validado(s) ${ui.seloValidacao(validados ? 'validado' : 'nao_validado')}</div></div>`;

  const escopos = [1, 2, 3].map((e) => ({ escopo: e, ...(b.porEscopo[e] ?? { passivo: 0, ativo: 0 }) }));
  ui.preencherTabela($('#tb-escopos'), escopos, (l) => `
    <tr><td>Escopo ${l.escopo}</td>
      <td class="n">${ui.fmtTCO2e(l.passivo)}</td>
      <td class="n">${ui.fmtTCO2e(l.ativo)}</td>
      <td>${ui.barraBalanco(l.passivo, l.ativo)}</td></tr>`, 4);

  const cats = Object.entries(b.porCategoria)
    .sort((a, c) => (c[1].passivo + c[1].ativo) - (a[1].passivo + a[1].ativo));
  ui.preencherTabela($('#tb-categorias'), cats, ([k, v]) => `
    <tr><td>${ui.esc(CATS[k]?.rotulo ?? k)}</td>
      <td class="n">${ui.fmtTCO2e(v.passivo)}</td>
      <td class="n">${ui.fmtTCO2e(v.ativo)}</td></tr>`, 3, 'Nenhum lançamento — importe um documento.');

  const ls = await lancamentos(EMPRESA.id, 40);
  ui.preencherTabela($('#tb-lancamentos'), ls, (l) => `
    <tr>
      <td>${ui.fmtComp(l.competencia)}</td>
      <td>${ui.esc(CATS[l.categoria]?.rotulo ?? l.categoria)}</td>
      <td><span class="selo selo--${l.natureza}">${l.natureza}</span></td>
      <td class="n">${l.escopo}</td>
      <td class="n"><strong>${ui.fmtTCO2e(l.quantidade_tco2e)}</strong></td>
      <td><code style="font-size:11px">${ui.esc(l.documentos_fonte?.tipo ?? '—')}</code>
        <div style="font-size:10.5px;color:var(--ink-400)" class="num">${(l.documentos_fonte?.hash_sha256 ?? '').slice(0, 16)}…</div></td>
      <td><button class="btn btn--peq btn--sec" data-memoria='${ui.esc(JSON.stringify(l.memoria_calculo))}'>memória</button></td>
    </tr>`, 7, 'Nenhum lançamento ainda.');

  $$('#tb-lancamentos [data-memoria]').forEach((b) =>
    b.addEventListener('click', () => {
      const m = JSON.parse(b.dataset.memoria);
      alert(`Memória de cálculo\n\n${m.formula}\n\n`
        + `Insumo: ${m.insumo.valor} ${m.insumo.unidade}\n`
        + `Fator: ${m.fator.valor} ${m.fator.unidade}\n`
        + `Fonte: ${m.fator.fonte}\n`
        + `Validação do fator: ${m.fator.validacao}\n`
        + (m.rateio_pct != null ? `Rateio: ${m.rateio_pct}%\n` : '')
        + `Resultado: ${m.resultado_tco2e} tCO2e\n`
        + (m.aviso ? `\n⚠ ${m.aviso}` : ''));
    }));
}

/* ============================================================= energia */
async function ucs() {
  const { data, error } = await sb.from('unidades_consumidoras')
    .select('*').eq('empresa_id', EMPRESA.id).order('apelido');
  if (error) throw error;
  return data ?? [];
}

async function renderEnergia() {
  const lista = await ucs();

  $('#sel-uc').innerHTML = lista.length
    ? lista.map((u) => `<option value="${u.id}">${ui.esc(u.apelido)}</option>`).join('')
    : '<option value="">— cadastre uma UC primeiro —</option>';

  const docs = await listarDocumentos(EMPRESA.id, 'fatura_energia', 500);
  const kwhPorUc = {};
  for (const d of docs) {
    const uc = d.payload?.uc_id;
    if (uc) kwhPorUc[uc] = (kwhPorUc[uc] ?? 0) + Number(d.payload?.kwh_rede ?? 0);
  }

  ui.preencherTabela($('#tb-ucs'), lista, (u) => `
    <tr>
      <td><strong>${ui.esc(u.apelido)}</strong></td>
      <td class="num">${ui.esc(u.codigo_uc ?? '—')}</td>
      <td>${ui.esc(u.tipo)}</td>
      <td>${ui.esc(u.uf ?? '—')}</td>
      <td>${u.tem_gd_solar
        ? `<span class="selo selo--ativo">${ui.fmtNum(u.potencia_gd_kwp, 2)} kWp</span>`
        : '<span class="selo selo--neutro">sem GD</span>'}</td>
      <td class="n">${ui.fmtNum(kwhPorUc[u.id] ?? 0, 0)}</td>
    </tr>`, 6, 'Cadastre a primeira unidade consumidora.');
}

/* =============================================================== frota */
async function renderFrota() {
  const docs = await listarDocumentos(EMPRESA.id, 'nfe', 200);
  ui.preencherTabela($('#tb-nfe'), docs, (d) => `
    <tr>
      <td>${ui.fmtData(d.payload?.emissao)}</td>
      <td class="num" style="font-size:11px">${ui.esc((d.chave_acesso ?? '—').slice(0, 20))}…</td>
      <td>${ui.esc(d.payload?.emitente?.nome ?? '—')}</td>
      <td class="n">${ui.fmtNum(d.payload?.litros_combustivel, 2)}</td>
      <td class="n">${ui.fmtMoeda(d.payload?.valor_total)}</td>
      <td>${(d.inconsistencias ?? []).length
        ? `<span class="selo selo--nao_validado">${d.inconsistencias.length}</span>`
        : '<span class="selo selo--validado">ok</span>'}</td>
    </tr>`, 6, 'Nenhuma NF-e importada.');
}

/* ============================================================ comodato */
const ESTADOS = ['novo', 'em_campo', 'retorno', 'triagem', 'reparo', 'refurb', 'descarte', 'baixado'];
const ROTULO_ESTADO = {
  novo: 'novo', em_campo: 'em campo', retorno: 'retorno', triagem: 'triagem',
  reparo: 'reparo', refurb: 'refurb', descarte: 'descarte', baixado: 'baixado',
};

async function todosAtivos() {
  const { data, error } = await sb.from('ativos_equipamento')
    .select('*').eq('isp_id', EMPRESA.id)
    .order('atualizado_em', { ascending: false }).limit(2000);
  if (error) throw error;
  return data ?? [];
}

async function renderComodato() {
  const [lista, inventario, destinadores] = await Promise.all([
    todosAtivos(), rev.inventarioRede(EMPRESA.id), rev.listarDestinadores(EMPRESA.id),
  ]);

  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, lista.filter((a) => a.estado === e).length]));
  const emCampo = porEstado.em_campo;
  const provisorios = lista.filter((a) => a.serial_provisorio).length;
  const valorTotal = lista.reduce((a, x) => a + Number(x.valor_aquisicao ?? 0), 0);
  const reutilizados = lista.filter((a) => (a.ciclos_refurb ?? 0) > 0).length;

  $('#kpis-inventario').innerHTML = `
    <div class="kpi kpi--fiscal"><dt>Ativo de rede em campo</dt>
      <dd>${ui.fmtInt(emCampo)}<small>un.</small></dd>
      <div class="rodape">${ui.fmtInt(lista.length)} equipamentos no inventário</div></div>
    <div class="kpi"><dt>Valor de aquisição</dt>
      <dd style="font-size:21px">${ui.fmtMoeda(valorTotal)}</dd>
      <div class="rodape">base das NF-e importadas</div></div>
    <div class="kpi kpi--ativo"><dt>Reaproveitados</dt>
      <dd>${ui.fmtInt(reutilizados)}<small>un.</small></dd>
      <div class="rodape">CAPEX de reposição evitado</div></div>
    <div class="kpi kpi--alerta"><dt>Seriais provisórios</dt>
      <dd>${ui.fmtInt(provisorios)}<small>un.</small></dd>
      <div class="rodape">${provisorios ? 'corrigir em campo' : 'inventário conferido'}</div></div>`;

  const total = lista.length || 1;
  $('#resumo-comodato').innerHTML = ESTADOS.map((e) => `
    <div class="funil__etapa">
      <span>${ROTULO_ESTADO[e]}</span>
      <div class="trilho"><i style="width:${(porEstado[e] / total * 100).toFixed(1)}%"></i></div>
      <span class="num" style="text-align:right">${porEstado[e]}</span>
    </div>`).join('');

  /* --- fila de triagem --- */
  const emRetorno = lista.filter((a) => a.estado === 'retorno');
  $('#selo-triagem').textContent = `${emRetorno.length} aguardando decisão`;
  ui.preencherTabela($('#tb-triagem'), emRetorno, (a) => {
    const dias = Math.floor((Date.now() - new Date(a.atualizado_em)) / 864e5);
    return `<tr>
      <td class="num">${ui.esc(a.serial)}${a.serial_provisorio ? ' <span class="selo selo--nao_validado">prov.</span>' : ''}</td>
      <td>${ui.esc(a.modelo ?? '—')}</td>
      <td>${ui.fmtData(a.atualizado_em)} <span style="color:${dias > 15 ? 'var(--rubro-600)' : 'var(--ink-400)'}">(${dias}d)</span></td>
      <td class="n">${ui.fmtMoeda(a.valor_aquisicao)}</td>
      <td><button class="btn btn--peq" data-triar="${a.id}">Triar</button></td>
    </tr>`;
  }, 5, 'Nenhum equipamento aguardando triagem.');

  $$('#tb-triagem [data-triar]').forEach((b) =>
    b.addEventListener('click', () => abrirTriagem(lista.find((a) => a.id === b.dataset.triar), destinadores)));

  /* --- em reparo --- */
  const emReparo = lista.filter((a) => a.estado === 'reparo');
  const { data: triagens } = await sb.from('triagens')
    .select('ativo_id, custo_reparo_estimado, triado_em, destinador:destinador_id(razao_social, prazo_medio_dias)')
    .eq('empresa_id', EMPRESA.id).eq('destino', 'reparo').order('triado_em', { ascending: false });
  const ultimaTriagem = new Map();
  for (const t of triagens ?? []) if (!ultimaTriagem.has(t.ativo_id)) ultimaTriagem.set(t.ativo_id, t);

  ui.preencherTabela($('#tb-reparo'), emReparo, (a) => {
    const t = ultimaTriagem.get(a.id);
    const dias = t ? Math.floor((Date.now() - new Date(t.triado_em)) / 864e5) : null;
    const prazo = t?.destinador?.prazo_medio_dias ?? 30;
    const atrasado = dias != null && dias > prazo;
    return `<tr>
      <td class="num">${ui.esc(a.serial)}</td>
      <td>${ui.esc(a.modelo ?? '—')}</td>
      <td>${ui.esc(t?.destinador?.razao_social ?? '—')}</td>
      <td>${ui.fmtData(t?.triado_em)}
        ${dias != null ? `<span style="color:${atrasado ? 'var(--rubro-600)' : 'var(--ink-400)'}">(${dias}d de ${prazo})</span>` : ''}</td>
      <td class="n">${ui.fmtMoeda(t?.custo_reparo_estimado)}</td>
      <td>
        <button class="btn btn--peq" data-reparo-ok="${a.id}">Recuperado</button>
        <button class="btn btn--peq btn--risco" data-reparo-nok="${a.id}">Irrecuperável</button>
      </td></tr>`;
  }, 6, 'Nenhum equipamento em reparo.');

  $$('#tb-reparo [data-reparo-ok]').forEach((b) =>
    b.addEventListener('click', () => concluir(lista.find((a) => a.id === b.dataset.reparoOk), true)));
  $$('#tb-reparo [data-reparo-nok]').forEach((b) =>
    b.addEventListener('click', () => concluir(lista.find((a) => a.id === b.dataset.reparoNok), false)));

  /* --- descarte aguardando lote --- */
  const aguardando = await rev.aguardandoLote(EMPRESA.id);
  ui.preencherTabela($('#tb-descarte'), aguardando, (a) => `
    <tr><td class="num">${ui.esc(a.serial)}</td><td>${ui.esc(a.modelo ?? '—')}</td>
      <td class="n">${ui.fmtMoeda(a.valor_aquisicao)}</td></tr>`,
    3, 'Nenhum equipamento aguardando lote.');
  $('#btn-formar-lote').disabled = aguardando.length === 0;
  $('#btn-formar-lote').textContent = aguardando.length
    ? `Formar lote (${aguardando.length} un.)` : 'Formar lote de reversa';

  /* --- inventário completo --- */
  const filtroEstado = $('#filtro-estado').value;
  const busca = ($('#busca-ativo').value ?? '').toLowerCase();
  const visiveis = lista
    .filter((a) => !filtroEstado || a.estado === filtroEstado)
    .filter((a) => !busca || `${a.serial} ${a.modelo ?? ''}`.toLowerCase().includes(busca))
    .slice(0, 300);

  ui.preencherTabela($('#tb-ativos'), visiveis, (a) => `
    <tr>
      <td class="num">${ui.esc(a.serial)}${a.serial_provisorio
        ? ` <button class="btn btn--peq btn--sec" data-serial="${a.id}" title="corrigir serial">prov.</button>` : ''}</td>
      <td>${ui.esc(a.modelo ?? '—')}</td>
      <td><span class="selo selo--${a.estado === 'refurb' ? 'ativo' : a.estado === 'descarte' ? 'risco' : 'neutro'}">${ROTULO_ESTADO[a.estado]}</span></td>
      <td class="n">${a.ciclos_refurb}</td>
      <td>${ui.fmtData(a.data_entrada)}</td>
      <td>${proximaAcao(a)}</td>
    </tr>`, 6, 'Inventário vazio — importe uma NF-e de compra.');

  $$('#tb-ativos [data-mover]').forEach((b) =>
    b.addEventListener('click', () => moverAtivo(b.dataset.mover, b.dataset.estado).catch(ui.erro)));
  $$('#tb-ativos [data-triar2]').forEach((b) =>
    b.addEventListener('click', () => abrirTriagem(lista.find((a) => a.id === b.dataset.triar2), destinadores)));
  $$('#tb-ativos [data-serial]').forEach((b) =>
    b.addEventListener('click', () => corrigirSerial(lista.find((a) => a.id === b.dataset.serial))));
}

/** A ação disponível depende do estado — evita transição sem sentido. */
function proximaAcao(a) {
  if (a.estado === 'novo' || a.estado === 'refurb')
    return `<button class="btn btn--peq btn--sec" data-mover="${a.id}" data-estado="em_campo">enviar a campo</button>`;
  if (a.estado === 'em_campo')
    return `<button class="btn btn--peq btn--sec" data-mover="${a.id}" data-estado="retorno">registrar retorno</button>`;
  if (a.estado === 'retorno')
    return `<button class="btn btn--peq" data-triar2="${a.id}">triar</button>`;
  if (a.estado === 'descarte')
    return '<span style="color:var(--ink-400);font-size:12px">aguardando lote</span>';
  if (a.estado === 'baixado')
    return '<span style="color:var(--ink-400);font-size:12px">baixado</span>';
  return '';
}

async function moverAtivo(id, novoEstado) {
  const { data: antes } = await sb.from('ativos_equipamento').select('*').eq('id', id).single();
  const { error } = await sb.from('ativos_equipamento').update({ estado: novoEstado }).eq('id', id);
  if (error) throw error;
  await sb.from('ativos_historico').insert({
    ativo_id: id, estado_de: antes.estado, estado_para: novoEstado,
  });
  ui.toast(`Equipamento movido para "${ROTULO_ESTADO[novoEstado]}".`);
  renderComodato();
}

async function corrigirSerial(ativo) {
  const novo = prompt(`Serial provisório: ${ativo.serial}\n\nInforme o serial real lido no equipamento:`);
  if (!novo?.trim()) return;
  const { error } = await sb.from('ativos_equipamento')
    .update({ serial: novo.trim(), serial_provisorio: false }).eq('id', ativo.id);
  if (error) return ui.erro(error);
  ui.toast('Serial corrigido.');
  renderComodato();
}

async function concluir(ativo, recuperado) {
  try {
    const r = await rev.concluirReparo({ empresaId: EMPRESA.id, ativo, recuperado });
    ui.toast(recuperado
      ? `Recuperado e devolvido ao estoque.${r.lancamento ? ' Lançamento ativo de carbono gerado.' : ''}`
      : 'Marcado como irrecuperável — segue para descarte.');
    renderComodato();
  } catch (e) { ui.erro(e); }
}

/* ------------------------------------------------------ wizard de triagem */
async function abrirTriagem(ativo, destinadores) {
  if (!ativo) return;

  const feito = await ui.wizard({
    titulo: `Triagem — ${ativo.serial}`,
    estadoInicial: { valorReposicao: ativo.valor_aquisicao ?? null },
    etapas: [
      {
        titulo: 'Diagnóstico',
        render: () => `
          <p class="dica">Modelo: <strong>${ui.esc(ativo.modelo ?? '—')}</strong>
             · entrada ${ui.fmtData(ativo.data_entrada)}
             · ${ativo.ciclos_refurb} ciclo(s) de reaproveitamento.</p>
          <label class="campo"><span>Motivo do retorno</span>
            <select name="motivo">
              ${Object.entries(rev.MOTIVOS).map(([k, v]) =>
                `<option value="${k}">${ui.esc(v)}</option>`).join('')}
            </select></label>
          <div class="linha">
            <label class="campo"><span>Custo estimado do reparo (R$)</span>
              <input name="custo" type="number" step="0.01" min="0"></label>
            <label class="campo"><span>Valor de reposição (R$)</span>
              <input name="valor" type="number" step="0.01" min="0"
                     value="${ativo.valor_aquisicao ?? ''}"></label>
          </div>
          <label class="campo"><span>Laudo técnico</span>
            <textarea name="laudo" rows="3" placeholder="O que foi constatado na inspeção"></textarea></label>`,
        aoSair: (el, est) => {
          est.motivo = el.querySelector('[name=motivo]').value;
          est.custoReparo = el.querySelector('[name=custo]').value || null;
          est.valorReposicao = el.querySelector('[name=valor]').value || null;
          est.laudo = el.querySelector('[name=laudo]').value || null;
          est.sugestao = rev.sugerirDestino({
            motivo: est.motivo, custoReparo: est.custoReparo, valorReposicao: est.valorReposicao,
          });
        },
      },
      {
        titulo: 'Destino',
        render: (est) => `
          <div class="sugestao"><strong>Sugestão:</strong>
            ${ui.esc(rev.DESTINOS[est.sugestao.destino].rotulo)} — ${ui.esc(est.sugestao.razao)}
            <div style="margin-top:4px;font-size:11.5px">A decisão e o laudo são seus; a sugestão é só a conta.</div></div>
          <div class="opcoes">
            ${Object.entries(rev.DESTINOS).map(([k, v]) => `
              <label class="opcao">
                <input type="radio" name="destino" value="${k}"${k === est.sugestao.destino ? ' checked' : ''}>
                <div><strong>${ui.esc(v.rotulo)}</strong>
                  <span>${k === 'reparo' ? 'Vai para assistência técnica; volta ao estoque se recuperado.'
                       : k === 'reposicao' ? 'Volta ao estoque agora — gera lançamento ativo de carbono.'
                       : 'Entra em lote de reversa; o ativo de carbono nasce no CDF.'}</span></div>
              </label>`).join('')}
          </div>`,
        aoSair: (el, est) => {
          est.destino = el.querySelector('[name=destino]:checked')?.value;
          if (!est.destino) { ui.toast('Escolha um destino.', 'aviso'); return false; }
        },
      },
      {
        titulo: 'Empresa de recebimento',
        render: (est) => {
          if (est.destino === 'reposicao') {
            return `<div class="aviso aviso--info"><strong>Sem destinador</strong>
              O equipamento volta ao seu estoque como reposição de campo. Nenhuma
              empresa externa recebe.</div>`;
          }
          const tipo = est.destino === 'reparo' ? 'assistencia_tecnica' : 'reciclador';
          const aptos = destinadores.filter((d) => d.tipo === tipo || d.tipo === 'fabricante' || d.tipo === 'refurbisher');
          if (!aptos.length) {
            return `<div class="aviso"><strong>Nenhum destinador cadastrado</strong>
              Cadastre uma empresa de recebimento na tela <em>Destinadores</em>.
              É possível concluir a triagem sem destinador, mas o lastro documental
              fica incompleto.</div>`;
          }
          return `<label class="campo"><span>Empresa que vai receber</span>
            <select name="destinador">
              <option value="">— definir depois —</option>
              ${aptos.map((d) => {
                const lic = rev.situacaoLicenca(d);
                return `<option value="${d.id}"${lic.bloqueia ? ' disabled' : ''}>
                  ${ui.esc(d.razao_social)} — licença ${ui.esc(lic.rotulo)}${lic.bloqueia ? ' (bloqueado)' : ''}
                </option>`;
              }).join('')}
            </select></label>
            <p class="dica">Empresas com licença ambiental vencida aparecem bloqueadas:
              destinação sem licença vigente não sustenta o dossiê.</p>`;
        },
        aoSair: (el, est) => {
          est.destinadorId = el.querySelector('[name=destinador]')?.value || null;
        },
      },
    ],
    aoConcluir: async (est) => rev.registrarTriagem({
      empresaId: EMPRESA.id, ativo,
      destino: est.destino, motivo: est.motivo, laudo: est.laudo,
      custoReparo: est.custoReparo, valorReposicao: est.valorReposicao,
      destinadorId: est.destinadorId,
    }),
  });

  if (!feito) return;
  ui.toast(feito.aviso ?? `Triagem registrada — equipamento em "${ROTULO_ESTADO[feito.novoEstado]}".`,
           feito.aviso ? 'aviso' : 'ok', feito.aviso ? 9000 : 5000);
  renderComodato();
}

/* --------------------------------------------------- wizard de formação de lote */
async function abrirFormarLote() {
  const [aguardando, destinadores, { data: vinculos }] = await Promise.all([
    rev.aguardandoLote(EMPRESA.id),
    rev.listarDestinadores(EMPRESA.id, { tipo: 'reciclador' }),
    sb.from('vinculos_comerciais')
      .select('distribuidor_id, rateio_isp_pct, dist:distribuidor_id(razao_social)')
      .eq('isp_id', EMPRESA.id).eq('consentido', true),
  ]);

  if (!aguardando.length) return ui.toast('Nenhum equipamento em descarte.', 'aviso');

  const lote = await ui.wizard({
    titulo: 'Formar lote de logística reversa',
    etapas: [
      {
        titulo: 'Conteúdo',
        render: () => `
          <p class="dica">${aguardando.length} equipamento(s) em descarte sem lote.
            Todos entram neste lote.</p>
          <div class="tabela-wrap" style="max-height:200px;overflow:auto">
            <table class="tabela"><thead><tr><th>Serial</th><th>Modelo</th></tr></thead>
            <tbody>${aguardando.slice(0, 100).map((a) =>
              `<tr><td class="num">${ui.esc(a.serial)}</td><td>${ui.esc(a.modelo ?? '—')}</td></tr>`).join('')}
            </tbody></table>
          </div>
          <div class="linha" style="margin-top:14px">
            <label class="campo"><span>Identificação do lote</span>
              <input name="ident" placeholder="deixe vazio para gerar automaticamente"></label>
            <label class="campo" style="flex:0 1 190px"><span>Peso médio por unidade (kg)</span>
              <input name="peso" type="number" step="0.01" min="0.01" value="0.35"></label>
          </div>
          <p class="dica">0,35 kg ≈ ONU/roteador. Substitua pela pesagem real quando
            houver — o peso é a base do ativo de carbono da reversa.</p>`,
        aoSair: (el, est) => {
          est.identificacao = el.querySelector('[name=ident]').value || null;
          est.pesoMedio = Number(el.querySelector('[name=peso]').value || 0.35);
          if (!(est.pesoMedio > 0)) { ui.toast('Peso médio inválido.', 'aviso'); return false; }
        },
      },
      {
        titulo: 'Destinador',
        render: () => destinadores.length
          ? `<label class="campo"><span>Reciclador / destinador final</span>
              <select name="destinador">
                <option value="">— definir depois —</option>
                ${destinadores.map((d) => {
                  const lic = rev.situacaoLicenca(d);
                  return `<option value="${d.id}"${lic.bloqueia ? ' disabled' : ''}>
                    ${ui.esc(d.razao_social)} — licença ${ui.esc(lic.rotulo)}</option>`;
                }).join('')}
              </select></label>
             <p class="dica">O banco recusa o lote se a licença estiver vencida — a
               validação não é só da tela.</p>`
          : `<div class="aviso"><strong>Nenhum reciclador cadastrado</strong>
              O lote pode ser criado sem destinador e completado depois, mas só chega
              a "destinado" com o CDF anexado.</div>`,
        aoSair: (el, est) => { est.destinadorId = el.querySelector('[name=destinador]')?.value || null; },
      },
      {
        titulo: 'Rateio §8',
        render: () => (vinculos ?? []).length
          ? `<p class="dica">O ativo de carbono do lote é rateado com o distribuidor
               parceiro conforme o vínculo consentido.</p>
             <label class="campo"><span>Distribuidor parceiro</span>
               <select name="parceiro">
                 <option value="">— sem rateio (100% do ISP) —</option>
                 ${vinculos.map((v) => `<option value="${v.distribuidor_id}">
                   ${ui.esc(v.dist?.razao_social ?? '')} — ISP fica com ${ui.fmtNum(v.rateio_isp_pct, 0)}%
                 </option>`).join('')}
               </select></label>`
          : `<div class="aviso aviso--info"><strong>Sem vínculo consentido</strong>
              O ativo de carbono deste lote fica integralmente com o ISP. Para ratear
              com o distribuidor, crie o vínculo no painel e consinta o acesso.</div>`,
        aoSair: (el, est) => { est.parceiroId = el.querySelector('[name=parceiro]')?.value || null; },
      },
    ],
    aoConcluir: async (est) => rev.formarLote({
      empresaId: EMPRESA.id, destinadorId: est.destinadorId,
      ispParceiroId: est.parceiroId, pesoMedioKg: est.pesoMedio,
      identificacao: est.identificacao,
    }),
  });

  if (!lote) return;
  ui.toast(`Lote formado com ${aguardando.length} equipamento(s). Anexe o MTR para avançar.`, 'ok', 8000);
  renderComodato();
}

/* ========================================================= destinadores */
async function renderDestinadores() {
  const lista = await rev.listarDestinadores(EMPRESA.id, { apenasAtivos: false });

  ui.preencherTabela($('#tb-destinadores'), lista, (d) => {
    const lic = rev.situacaoLicenca(d);
    return `<tr${d.ativo ? '' : ' style="opacity:.5"'}>
      <td><strong>${ui.esc(d.razao_social)}</strong>
        ${d.contato_email ? `<div style="font-size:11.5px;color:var(--ink-500)">${ui.esc(d.contato_email)}</div>` : ''}</td>
      <td class="num">${ui.esc(d.cnpj)}</td>
      <td>${ui.esc(rev.TIPOS_DESTINADOR[d.tipo] ?? d.tipo)}</td>
      <td>${ui.esc(d.uf ?? '—')}</td>
      <td><span class="selo selo--${lic.nivel}">${ui.esc(lic.rotulo)}</span>
        ${d.licenca_ambiental ? `<div style="font-size:11px;color:var(--ink-400)">${ui.esc(d.licenca_ambiental)}</div>` : ''}</td>
      <td style="font-size:11.5px">${(d.aceita_categorias ?? []).map((c) => c.replace(/_/g, ' ')).join(', ') || '—'}</td>
      <td><button class="btn btn--peq btn--sec" data-edit-dest="${d.id}">editar</button></td>
    </tr>`;
  }, 7, 'Cadastre a primeira empresa de recebimento.');

  $$('#tb-destinadores [data-edit-dest]').forEach((b) =>
    b.addEventListener('click', () => abrirDestinador(lista.find((d) => d.id === b.dataset.editDest))));
}

async function abrirDestinador(existente = null) {
  const salvo = await ui.wizard({
    titulo: existente ? `Destinador — ${existente.razao_social}` : 'Cadastrar destinador',
    estadoInicial: existente ? { ...existente } : {},
    etapas: [
      {
        titulo: 'Identificação',
        render: (est) => `
          <div class="linha">
            <label class="campo"><span>CNPJ</span>
              <input name="cnpj" value="${ui.esc(est.cnpj ?? '')}" required inputmode="numeric"></label>
            <button class="btn btn--sec" type="button" name="buscar">Consultar</button>
          </div>
          <label class="campo" style="margin-top:12px"><span>Razão social</span>
            <input name="razao_social" value="${ui.esc(est.razao_social ?? '')}" required></label>
          <div class="linha">
            <label class="campo"><span>Tipo</span>
              <select name="tipo">
                ${Object.entries(rev.TIPOS_DESTINADOR).map(([k, v]) =>
                  `<option value="${k}"${est.tipo === k ? ' selected' : ''}>${ui.esc(v)}</option>`).join('')}
              </select></label>
            <label class="campo" style="flex:0 1 90px"><span>UF</span>
              <input name="uf" maxlength="2" value="${ui.esc(est.uf ?? '')}" style="text-transform:uppercase"></label>
            <label class="campo"><span>Município</span>
              <input name="municipio" value="${ui.esc(est.municipio ?? '')}"></label>
          </div>`,
        aoEntrar: (el, est) => {
          el.querySelector('[name=buscar]').addEventListener('click', async (ev) => {
            const btn = ev.target;
            btn.disabled = true; btn.textContent = 'Consultando…';
            const d = await consultaCnpj(el.querySelector('[name=cnpj]').value);
            btn.disabled = false; btn.textContent = 'Consultar';
            if (!d) return ui.toast('BrasilAPI indisponível — preencha manualmente.', 'aviso', 7000);
            el.querySelector('[name=razao_social]').value = d.razao_social ?? '';
            el.querySelector('[name=uf]').value = d.uf ?? '';
            el.querySelector('[name=municipio]').value = d.municipio ?? '';
            ui.toast('Dados preenchidos pela BrasilAPI.');
          });
        },
        aoSair: (el, est) => {
          const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
          if (!v('cnpj') || !v('razao_social')) { ui.toast('CNPJ e razão social são obrigatórios.', 'aviso'); return false; }
          Object.assign(est, {
            cnpj: v('cnpj'), razao_social: v('razao_social'), tipo: v('tipo'),
            uf: v('uf').toUpperCase() || null, municipio: v('municipio') || null,
          });
        },
      },
      {
        titulo: 'Licença ambiental',
        render: (est) => `
          <p class="dica">É a licença que transforma descarte em destinação regular.
            Sem validade preenchida, o cadastro fica marcado como não validado e
            o alerta de vencimento não funciona.</p>
          <div class="linha">
            <label class="campo"><span>Número da licença</span>
              <input name="licenca_ambiental" value="${ui.esc(est.licenca_ambiental ?? '')}"></label>
            <label class="campo"><span>Órgão emissor</span>
              <input name="licenca_orgao" value="${ui.esc(est.licenca_orgao ?? '')}" placeholder="IMA, CETESB, IBAMA…"></label>
          </div>
          <div class="linha" style="margin-top:12px">
            <label class="campo"><span>Validade</span>
              <input name="licenca_validade" type="date" value="${est.licenca_validade ?? ''}"></label>
            <label class="campo"><span>CADRI (quando aplicável)</span>
              <input name="cadri" value="${ui.esc(est.cadri ?? '')}"></label>
            <label class="campo" style="flex:0 1 170px"><span>Prazo médio (dias)</span>
              <input name="prazo_medio_dias" type="number" min="1" value="${est.prazo_medio_dias ?? ''}"></label>
          </div>`,
        aoSair: (el, est) => {
          const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
          Object.assign(est, {
            licenca_ambiental: v('licenca_ambiental') || null,
            licenca_orgao: v('licenca_orgao') || null,
            licenca_validade: v('licenca_validade') || null,
            cadri: v('cadri') || null,
            prazo_medio_dias: v('prazo_medio_dias') ? Number(v('prazo_medio_dias')) : null,
          });
        },
      },
      {
        titulo: 'Escopo e contato',
        render: (est) => `
          <label class="campo"><span>Categorias que aceita</span></label>
          <div class="opcoes" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
            ${rev.CATEGORIAS_ACEITAS.map((c) => `
              <label class="opcao"><input type="checkbox" name="cat" value="${c}"
                ${(est.aceita_categorias ?? []).includes(c) ? 'checked' : ''}>
                <div><strong>${c.replace(/_/g, ' ')}</strong></div></label>`).join('')}
          </div>
          <div class="linha" style="margin-top:14px">
            <label class="campo"><span>Contato</span>
              <input name="contato_nome" value="${ui.esc(est.contato_nome ?? '')}"></label>
            <label class="campo"><span>E-mail</span>
              <input name="contato_email" type="email" value="${ui.esc(est.contato_email ?? '')}"></label>
            <label class="campo"><span>Telefone</span>
              <input name="contato_telefone" value="${ui.esc(est.contato_telefone ?? '')}"></label>
          </div>
          <label class="opcao" style="margin-top:12px">
            <input type="checkbox" name="ativo" ${est.ativo === false ? '' : 'checked'}>
            <div><strong>Destinador ativo</strong><span>Desmarque para aposentar sem apagar o histórico.</span></div>
          </label>`,
        aoSair: (el, est) => {
          Object.assign(est, {
            aceita_categorias: [...el.querySelectorAll('[name=cat]:checked')].map((c) => c.value),
            contato_nome: el.querySelector('[name=contato_nome]').value.trim() || null,
            contato_email: el.querySelector('[name=contato_email]').value.trim() || null,
            contato_telefone: el.querySelector('[name=contato_telefone]').value.trim() || null,
            ativo: el.querySelector('[name=ativo]').checked,
          });
        },
      },
    ],
    aoConcluir: async (est) => rev.salvarDestinador({
      empresaId: EMPRESA.id, id: existente?.id ?? null,
      cnpj: est.cnpj, razao_social: est.razao_social, tipo: est.tipo,
      uf: est.uf, municipio: est.municipio,
      licenca_ambiental: est.licenca_ambiental, licenca_orgao: est.licenca_orgao,
      licenca_validade: est.licenca_validade, cadri: est.cadri,
      prazo_medio_dias: est.prazo_medio_dias, aceita_categorias: est.aceita_categorias,
      contato_nome: est.contato_nome, contato_email: est.contato_email,
      contato_telefone: est.contato_telefone, ativo: est.ativo,
      validacao: est.licenca_validade ? 'em_validacao' : 'nao_validado',
    }),
  });

  if (!salvo) return;
  ui.toast('Destinador salvo.');
  renderDestinadores();
}

/* ============================================================= produtos */
const FONTE_ROTULO = {
  pesagem_propria: 'pesagem própria', epd_fabricante: 'EPD do fabricante',
  catalogo_fabricante: 'catálogo do fabricante', erp: 'ERP', planilha: 'planilha',
  estimado: 'estimado',
};
const FONTE_NIVEL = {
  pesagem_propria: 'validado', epd_fabricante: 'validado',
  catalogo_fabricante: 'em_validacao', erp: 'em_validacao',
  planilha: 'nao_validado', estimado: 'risco',
};

async function renderProdutos() {
  const [{ data: prods }, { data: pesos }] = await Promise.all([
    sb.from('produtos').select('*').eq('empresa_id', EMPRESA.id).order('modelo'),
    sb.from('pesos_referencia').select('*').eq('empresa_id', EMPRESA.id).order('ncm'),
  ]);

  const lista = prods ?? [];
  const comPeso = lista.filter((p) => p.peso_kg != null);
  const confiaveis = comPeso.filter((p) => ['pesagem_propria', 'epd_fabricante'].includes(p.peso_fonte));
  const comCarbono = lista.filter((p) => p.carbono_incorporado_tco2e != null);

  $('#kpis-produtos').innerHTML = `
    <div class="kpi kpi--fiscal"><dt>Produtos no catálogo</dt>
      <dd>${ui.fmtInt(lista.length)}</dd>
      <div class="rodape">${ui.fmtInt(pesos?.length ?? 0)} peso(s) de referência por NCM</div></div>
    <div class="kpi kpi--ativo"><dt>Com peso cadastrado</dt>
      <dd>${ui.fmtInt(comPeso.length)}</dd>
      <div class="rodape">${lista.length ? Math.round(comPeso.length / lista.length * 100) : 0}% do catálogo</div></div>
    <div class="kpi ${confiaveis.length === comPeso.length && comPeso.length ? 'kpi--ativo' : 'kpi--alerta'}">
      <dt>Peso com prova</dt>
      <dd>${ui.fmtInt(confiaveis.length)}</dd>
      <div class="rodape">pesagem própria ou EPD do fabricante</div></div>
    <div class="kpi"><dt>Com carbono incorporado</dt>
      <dd>${ui.fmtInt(comCarbono.length)}</dd>
      <div class="rodape">base do lançamento de refurb</div></div>`;

  const busca = ($('#busca-produto').value ?? '').toLowerCase();
  const visiveis = busca
    ? lista.filter((p) => `${p.modelo} ${p.sku ?? ''} ${p.ncm ?? ''}`.toLowerCase().includes(busca))
    : lista;

  ui.preencherTabela($('#tb-produtos'), visiveis, (p) => `
    <tr>
      <td><strong>${ui.esc(p.modelo)}</strong>
        ${p.fabricante ? `<div style="font-size:11.5px;color:var(--ink-500)">${ui.esc(p.fabricante)}</div>` : ''}</td>
      <td class="num" style="font-size:11.5px">${ui.esc(p.sku ?? '—')}
        ${p.gtin ? `<div style="color:var(--ink-400)">${ui.esc(p.gtin)}</div>` : ''}</td>
      <td class="num">${ui.esc(p.ncm ?? '—')}</td>
      <td style="font-size:12px">${ui.esc((p.categoria_reversa ?? '—').replace(/_/g, ' '))}</td>
      <td class="n">${p.peso_kg != null ? `${ui.fmtNum(p.peso_kg, 3)} kg` : '—'}</td>
      <td>${p.peso_fonte
        ? `<span class="selo selo--${FONTE_NIVEL[p.peso_fonte]}">${FONTE_ROTULO[p.peso_fonte]}</span>`
        : '<span class="selo selo--risco">sem peso</span>'}</td>
      <td class="n">${p.carbono_incorporado_tco2e != null ? ui.fmtNum(p.carbono_incorporado_tco2e, 4) : '—'}</td>
      <td><button class="btn btn--peq btn--sec" data-edit-prod="${p.id}">editar</button></td>
    </tr>`, 8, 'Catálogo vazio — cadastre ou importe uma planilha.');

  $$('#tb-produtos [data-edit-prod]').forEach((b) =>
    b.addEventListener('click', () => abrirProduto(lista.find((p) => p.id === b.dataset.editProd))));

  ui.preencherTabela($('#tb-pesos-ncm'), pesos, (r) => `
    <tr><td class="num">${ui.esc(r.ncm)}</td><td>${ui.esc(r.descricao ?? '—')}</td>
      <td class="n">${ui.fmtNum(r.peso_kg, 3)}</td>
      <td><span class="selo selo--${FONTE_NIVEL[r.fonte]}">${FONTE_ROTULO[r.fonte]}</span></td></tr>`,
    4, 'Nenhum peso de referência.');
}

async function abrirProduto(existente = null) {
  const salvo = await ui.wizard({
    titulo: existente ? `Produto — ${existente.modelo}` : 'Cadastrar produto',
    estadoInicial: existente ? { ...existente } : {},
    etapas: [
      {
        titulo: 'Identificação',
        render: (e) => `
          <label class="campo"><span>Modelo / descrição</span>
            <input name="modelo" required value="${ui.esc(e.modelo ?? '')}"></label>
          <div class="linha">
            <label class="campo"><span>SKU / código interno</span>
              <input name="sku" value="${ui.esc(e.sku ?? '')}"></label>
            <label class="campo"><span>GTIN / EAN</span>
              <input name="gtin" inputmode="numeric" value="${ui.esc(e.gtin ?? '')}"></label>
            <label class="campo" style="flex:0 1 130px"><span>NCM</span>
              <input name="ncm" maxlength="8" inputmode="numeric" value="${ui.esc(e.ncm ?? '')}"></label>
          </div>
          <div class="linha" style="margin-top:12px">
            <label class="campo"><span>Fabricante</span>
              <input name="fabricante" value="${ui.esc(e.fabricante ?? '')}"></label>
            <label class="campo"><span>Categoria de reversa</span>
              <select name="categoria_reversa">
                <option value="">—</option>
                ${['onu_roteador','olt_chassi','fonte_carregador','bateria','cabo_fibra','placa_eletronica','servidor','outro']
                  .map((c) => `<option value="${c}"${e.categoria_reversa === c ? ' selected' : ''}>${c.replace(/_/g,' ')}</option>`).join('')}
              </select></label>
          </div>
          <p class="dica">GTIN e SKU são as chaves de casamento com a NF-e: quanto mais
            preenchido, mais item de nota resolve sozinho.</p>`,
        aoSair: (el, e) => {
          const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
          if (!v('modelo')) { ui.toast('Modelo é obrigatório.', 'aviso'); return false; }
          Object.assign(e, {
            modelo: v('modelo'), sku: v('sku') || null,
            gtin: v('gtin').replace(/\D/g, '') || null,
            ncm: v('ncm').replace(/\D/g, '') || null,
            fabricante: v('fabricante') || null,
            categoria_reversa: v('categoria_reversa') || null,
          });
        },
      },
      {
        titulo: 'Peso',
        render: (e) => `
          <p class="dica">A procedência importa tanto quanto o número: é ela que decide
            se o dossiê do lote sai como definitivo ou preliminar.</p>
          <div class="linha">
            <label class="campo"><span>Peso (kg)</span>
              <input name="peso_kg" type="number" step="0.0001" min="0" value="${e.peso_kg ?? ''}"></label>
            <label class="campo"><span>Procedência</span>
              <select name="peso_fonte">
                <option value="">—</option>
                ${Object.entries(FONTE_ROTULO).map(([k, r]) =>
                  `<option value="${k}"${e.peso_fonte === k ? ' selected' : ''}>${r}</option>`).join('')}
              </select></label>
            <label class="campo"><span>Medido em</span>
              <input name="peso_medido_em" type="date" value="${e.peso_medido_em ?? ''}"></label>
          </div>
          <div class="aviso" style="margin-top:14px">
            <strong>Ordem de força da prova</strong>
            pesagem própria &gt; EPD do fabricante &gt; catálogo comercial &gt; ERP &gt;
            planilha &gt; estimado. Só as duas primeiras sustentam número em dossiê.
          </div>`,
        aoSair: (el, e) => {
          const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
          const peso = v('peso_kg');
          if (peso && !(Number(peso) > 0)) { ui.toast('Peso deve ser maior que zero.', 'aviso'); return false; }
          if (peso && !v('peso_fonte')) { ui.toast('Informe a procedência do peso.', 'aviso'); return false; }
          Object.assign(e, {
            peso_kg: peso ? Number(peso) : null,
            peso_fonte: v('peso_fonte') || null,
            peso_medido_em: v('peso_medido_em') || null,
          });
        },
      },
      {
        titulo: 'Carbono e vida útil',
        render: (e) => `
          <div class="linha">
            <label class="campo"><span>Carbono incorporado (tCO₂e/unidade)</span>
              <input name="carbono" type="number" step="0.000001" min="0"
                     value="${e.carbono_incorporado_tco2e ?? ''}"></label>
            <label class="campo"><span>Procedência</span>
              <select name="carbono_fonte">
                <option value="">—</option>
                ${Object.entries(FONTE_ROTULO).map(([k, r]) =>
                  `<option value="${k}"${e.carbono_fonte === k ? ' selected' : ''}>${r}</option>`).join('')}
              </select></label>
          </div>
          <div class="linha" style="margin-top:12px">
            <label class="campo"><span>Vida útil (meses)</span>
              <input name="vida" type="number" min="1" value="${e.vida_util_meses ?? ''}"></label>
            <label class="campo"><span>Valor de referência (R$)</span>
              <input name="valor" type="number" step="0.01" min="0" value="${e.valor_referencia ?? ''}"></label>
          </div>
          <p class="dica">O carbono incorporado por unidade é o que dá lastro ao
            lançamento de refurb — hoje o motor usa um fator genérico marcado como
            provisório. Com a EPD do fabricante em mãos, o número passa a ser do produto.</p>`,
        aoSair: (el, e) => {
          const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
          Object.assign(e, {
            carbono_incorporado_tco2e: v('carbono') ? Number(v('carbono')) : null,
            carbono_fonte: v('carbono_fonte') || null,
            vida_util_meses: v('vida') ? Number(v('vida')) : null,
            valor_referencia: v('valor') ? Number(v('valor')) : null,
          });
        },
      },
    ],
    aoConcluir: async (e) => {
      const linha = {
        empresa_id: EMPRESA.id, modelo: e.modelo, sku: e.sku, gtin: e.gtin, ncm: e.ncm,
        fabricante: e.fabricante, categoria_reversa: e.categoria_reversa,
        peso_kg: e.peso_kg, peso_fonte: e.peso_fonte, peso_medido_em: e.peso_medido_em,
        carbono_incorporado_tco2e: e.carbono_incorporado_tco2e, carbono_fonte: e.carbono_fonte,
        vida_util_meses: e.vida_util_meses, valor_referencia: e.valor_referencia,
        validacao: ['pesagem_propria', 'epd_fabricante'].includes(e.peso_fonte)
          ? 'em_validacao' : 'nao_validado',
      };
      const q = existente
        ? sb.from('produtos').update(linha).eq('id', existente.id)
        : sb.from('produtos').insert(linha);
      const { error } = await q;
      if (error) throw error;
      return true;
    },
  });
  if (salvo) { ui.toast('Produto salvo.'); renderProdutos(); }
}

/* ============================================================ importar */
async function renderImportar() {
  $('#sel-alvo').innerHTML = Object.entries(imp.ALVOS)
    .map(([k, v]) => `<option value="${k}">${ui.esc(v.rotulo)}</option>`).join('');

  const hist = await impio.historicoImportacoes(EMPRESA.id);
  const COR = { concluida: 'validado', parcial: 'nao_validado', falhou: 'risco', processando: 'neutro' };

  ui.preencherTabela($('#tb-importacoes'), hist, (h) => `
    <tr>
      <td class="num" style="font-size:11.5px">${new Date(h.criado_em).toLocaleString('pt-BR')}</td>
      <td>${ui.esc(imp.ALVOS[h.alvo]?.rotulo ?? h.alvo)}</td>
      <td><span class="selo selo--neutro">${ui.esc(h.origem)}</span>
        ${h.conector ? `<div style="font-size:11px;color:var(--ink-400)">${ui.esc(h.conector.nome)}</div>` : ''}</td>
      <td style="font-size:12px">${ui.esc(h.nome_arquivo ?? '—')}</td>
      <td class="n">${h.total_linhas}</td>
      <td class="n">${h.criados}</td>
      <td class="n"${h.erros ? ' style="color:var(--rubro-600)"' : ''}>${h.erros}</td>
      <td><span class="selo selo--${COR[h.status]}">${h.status}</span></td>
      <td>${h.erros ? `<button class="btn btn--peq btn--sec" data-rel="${h.id}">ver erros</button>` : ''}</td>
    </tr>`, 9, 'Nenhuma importação ainda.');

  $$('#tb-importacoes [data-rel]').forEach((b) =>
    b.addEventListener('click', () => {
      const h = hist.find((x) => x.id === b.dataset.rel);
      ui.modal({
        titulo: `Erros da importação — ${imp.ALVOS[h.alvo]?.rotulo ?? h.alvo}`,
        corpo: `<div class="tabela-wrap"><table class="tabela">
          <thead><tr><th class="n">Linha</th><th>Problema</th></tr></thead>
          <tbody>${(h.relatorio ?? []).map((r) => `<tr>
            <td class="n">${r.linha}</td><td style="font-size:12px">${ui.esc(r.erro)}</td>
          </tr>`).join('')}</tbody></table></div>`,
      });
    }));
}

async function abrirImportacao(alvo, arquivo) {
  let lido;
  try {
    lido = await imp.lerArquivo(arquivo);
  } catch (e) { return ui.erro(e); }

  if (!lido.linhas.length) return ui.toast('Arquivo sem linhas de dados.', 'aviso');

  const def = imp.ALVOS[alvo];
  const feito = await ui.wizard({
    titulo: `Importar — ${def.rotulo}`,
    estadoInicial: { mapa: imp.sugerirMapeamento(lido.cabecalho, alvo) },
    etapas: [
      {
        titulo: 'Colunas',
        render: (e) => `
          <p class="dica">${lido.linhas.length} linha(s) em <strong>${ui.esc(arquivo.name)}</strong>
            (${lido.formato.toUpperCase()}). Confira o de-para sugerido:</p>
          ${Object.entries(def.campos).map(([campo, cfg]) => `
            <label class="campo"><span>${ui.esc(cfg.rotulo)}${cfg.obrigatorio ? ' *' : ''}</span>
              <select data-campo="${campo}">
                <option value="">— não importar —</option>
                ${lido.cabecalho.map((c) => `<option value="${ui.esc(c)}"${
                  e.mapa[campo] === c ? ' selected' : ''}>${ui.esc(c)}</option>`).join('')}
              </select></label>`).join('')}`,
        aoSair: (el, e) => {
          e.mapa = {};
          el.querySelectorAll('[data-campo]').forEach((s) => {
            if (s.value) e.mapa[s.dataset.campo] = s.value;
          });
          const faltando = Object.entries(def.campos)
            .filter(([k, c]) => c.obrigatorio && !e.mapa[k]).map(([, c]) => c.rotulo);
          if (faltando.length) {
            ui.toast(`Mapeie os campos obrigatórios: ${faltando.join(', ')}.`, 'aviso', 8000);
            return false;
          }
          Object.assign(e, imp.converter({
            linhas: lido.linhas, mapa: e.mapa, alvo, empresaId: EMPRESA.id,
          }));
        },
      },
      {
        titulo: 'Conferência',
        render: (e) => {
          const cols = Object.keys(e.validos[0] ?? {}).filter((c) => !c.endsWith('_id')).slice(0, 6);
          return `
            <div class="linha" style="gap:18px;margin-bottom:14px">
              <div><strong style="font-size:19px;color:var(--verde-600)">${e.validos.length}</strong>
                <div style="font-size:12px;color:var(--ink-500)">prontos para gravar</div></div>
              <div><strong style="font-size:19px;color:${e.erros.length ? 'var(--rubro-600)' : 'var(--ink-400)'}">${e.erros.length}</strong>
                <div style="font-size:12px;color:var(--ink-500)">com problema</div></div>
            </div>
            ${e.validos.length ? `<h3>Amostra do que será gravado</h3>
              <div class="tabela-wrap" style="max-height:190px;overflow:auto"><table class="tabela">
                <thead><tr>${cols.map((c) => `<th>${ui.esc(c)}</th>`).join('')}</tr></thead>
                <tbody>${e.validos.slice(0, 8).map((v) =>
                  `<tr>${cols.map((c) => `<td style="font-size:12px">${ui.esc(v[c] ?? '—')}</td>`).join('')}</tr>`).join('')}
                </tbody></table></div>` : ''}
            ${e.erros.length ? `<h3 style="margin-top:16px">Linhas com problema</h3>
              <div class="tabela-wrap" style="max-height:190px;overflow:auto"><table class="tabela">
                <thead><tr><th class="n">Linha</th><th>Problema</th></tr></thead>
                <tbody>${e.erros.slice(0, 30).map((x) =>
                  `<tr><td class="n">${x.linha}</td><td style="font-size:12px">${ui.esc(x.erro)}</td></tr>`).join('')}
                </tbody></table></div>
              <p class="dica" style="margin-top:8px">As linhas boas são gravadas mesmo assim;
                o relatório completo fica no histórico.</p>` : ''}`;
        },
        aoSair: (el, e) => {
          if (!e.validos.length) { ui.toast('Nenhuma linha válida para gravar.', 'aviso'); return false; }
        },
      },
    ],
    aoConcluir: async (e) => impio.importar({
      empresaId: EMPRESA.id, alvo, arquivo,
      validos: e.validos, erros: e.erros, formato: lido.formato,
    }),
  });

  if (!feito) return;
  if (feito.erroGravacao) return ui.erro(new Error(feito.erroGravacao));
  ui.toast(`${feito.gravados} registro(s) gravados`
    + (feito.erros ? `, ${feito.erros} linha(s) com problema.` : '.'),
    feito.erros ? 'aviso' : 'ok', 8000);
  renderImportar();
}

/* ========================================================== conectores */
async function renderConectores() {
  const lista = await impio.listarConectores(EMPRESA.id);

  ui.preencherTabela($('#tb-conectores'), lista, (c) => `
    <tr${c.ativo ? '' : ' style="opacity:.5"'}>
      <td><strong>${ui.esc(c.nome)}</strong>
        <div style="font-size:11.5px;color:var(--ink-500)">${ui.esc(c.tipo)}</div></td>
      <td>${ui.esc(c.sistema ?? '—')}</td>
      <td class="num" style="font-size:11.5px">${ui.esc(c.token_prefixo)}…
        <div style="color:var(--ink-400);font-size:11px">só o hash é guardado</div></td>
      <td style="font-size:11.5px">${(c.escopos ?? []).join(', ')}</td>
      <td class="n">${ui.fmtInt(c.total_recebido)}</td>
      <td style="font-size:11.5px">${c.ultima_sync ? new Date(c.ultima_sync).toLocaleString('pt-BR') : 'nunca'}</td>
      <td><button class="btn btn--peq ${c.ativo ? 'btn--risco' : 'btn--sec'}" data-toggle-con="${c.id}"
            data-ativo="${c.ativo}">${c.ativo ? 'desativar' : 'reativar'}</button></td>
    </tr>`, 7, 'Nenhum conector. Crie um para o ERP começar a enviar dados.');

  $$('#tb-conectores [data-toggle-con]').forEach((b) =>
    b.addEventListener('click', async () => {
      const { error } = await sb.from('conectores')
        .update({ ativo: b.dataset.ativo !== 'true' }).eq('id', b.dataset.toggleCon);
      if (error) return ui.erro(error);
      ui.toast('Conector atualizado.');
      renderConectores();
    }));

  const base = `${new URL(sb.supabaseUrl).origin}/functions/v1/ingest`;
  $('#doc-conector').innerHTML = `
    <p class="dica">O ERP faz um POST para o endereço abaixo, com o token no cabeçalho.
      A resposta traz o resultado linha a linha; reenviar o mesmo lote não duplica nada
      (a gravação é idempotente pela chave natural de cada alvo).</p>
    <pre style="background:var(--ink-50);padding:13px;border-radius:6px;overflow:auto;font-size:11.5px">POST ${ui.esc(base)}
Content-Type: application/json
x-conector-token: mbv_...

{
  "alvo": "produtos",
  "registros": [
    { "sku": "ONU-100", "modelo": "ONU GPON 1GE", "ncm": "85176259",
      "peso_kg": 0.42, "gtin": "7891234567890" }
  ]
}</pre>
    <h3 style="margin-top:16px">Alvos disponíveis</h3>
    <div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Alvo</th><th>O que é</th><th>Campos obrigatórios</th><th>Chave (não duplica)</th></tr></thead>
      <tbody>${Object.entries(imp.ALVOS).map(([k, v]) => `<tr>
        <td class="num">${k}</td><td>${ui.esc(v.rotulo)}</td>
        <td style="font-size:12px">${Object.entries(v.campos)
          .filter(([, c]) => c.obrigatorio).map(([n]) => n).join(', ') || '—'}</td>
        <td class="num" style="font-size:11.5px">${ui.esc(v.conflito.replace('empresa_id,', ''))}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

async function abrirConector() {
  const r = await ui.wizard({
    titulo: 'Novo conector',
    etapas: [
      {
        titulo: 'Sistema',
        render: () => `
          <div class="linha">
            <label class="campo"><span>Nome do conector</span>
              <input name="nome" required placeholder="ERP financeiro, WMS do CD…"></label>
            <label class="campo"><span>Tipo</span>
              <select name="tipo">
                <option value="erp">ERP</option><option value="crm">CRM</option>
                <option value="wms">WMS</option><option value="webhook">Webhook</option>
                <option value="outro">Outro</option>
              </select></label>
          </div>
          <label class="campo" style="margin-top:12px"><span>Sistema (opcional)</span>
            <input name="sistema" placeholder="Omie, Bling, Tiny, TOTVS, SAP, Salesforce…"></label>`,
        aoSair: (el, e) => {
          const v = (n) => el.querySelector(`[name=${n}]`).value.trim();
          if (!v('nome')) { ui.toast('Dê um nome ao conector.', 'aviso'); return false; }
          Object.assign(e, { nome: v('nome'), tipo: v('tipo'), sistema: v('sistema') || null });
        },
      },
      {
        titulo: 'Escopos',
        render: () => `
          <p class="dica">Marque só o que este sistema precisa escrever. Um conector de
            catálogo não deve conseguir mexer no inventário.</p>
          <div class="opcoes">
            ${Object.entries(imp.ALVOS).map(([k, v]) => `
              <label class="opcao"><input type="checkbox" name="escopo" value="${k}"
                ${k === 'produtos' ? 'checked' : ''}>
                <div><strong>${ui.esc(v.rotulo)}</strong><span>${k}</span></div></label>`).join('')}
          </div>`,
        aoSair: (el, e) => {
          e.escopos = [...el.querySelectorAll('[name=escopo]:checked')].map((c) => c.value);
          if (!e.escopos.length) { ui.toast('Escolha ao menos um escopo.', 'aviso'); return false; }
        },
      },
    ],
    aoConcluir: async (e) => impio.criarConector({
      empresaId: EMPRESA.id, nome: e.nome, tipo: e.tipo, sistema: e.sistema, escopos: e.escopos,
    }),
  });

  if (!r) return;
  await ui.modal({
    titulo: 'Token criado — copie agora',
    rotuloOk: 'Já copiei',
    corpo: `
      <div class="aviso"><strong>Este token aparece uma única vez</strong>
        O servidor guarda apenas o hash. Se você perder o valor, não há como
        recuperá-lo — só gerar um novo conector.</div>
      <label class="campo"><span>Token do conector "${ui.esc(r.conector.nome)}"</span>
        <input value="${ui.esc(r.token)}" readonly onclick="this.select()"
               style="font-family:var(--mono);font-size:12px"></label>
      <p class="dica">Configure no seu ERP como cabeçalho
        <code>x-conector-token</code>. Escopos: ${(r.conector.escopos ?? []).join(', ')}.</p>`,
  });
  renderConectores();
}

/* ========================================================== incentivos */
async function renderIncentivos() {
  FUNIL = await funilDaEmpresa(EMPRESA);

  const contagem = Object.fromEntries(ui.ORDEM_ETAPAS.map((e) => [e, FUNIL.filter((f) => f.etapa === e).length]));
  const total = FUNIL.length || 1;
  $('#funil-resumo').innerHTML = ui.ORDEM_ETAPAS.map((e) => `
    <div class="funil__etapa">
      <span>${ui.ROTULO_ETAPA[e]}</span>
      <div class="trilho"><i style="width:${(contagem[e] / total * 100).toFixed(1)}%"></i></div>
      <span class="num" style="text-align:right">${contagem[e]}</span>
    </div>`).join('');

  ui.preencherTabela($('#tb-incentivos'), FUNIL, (f) => {
    const reqs = f.requisitos.map((r) => {
      const cls = r.situacao === 'atendido' ? 'validado' : r.situacao === 'pendente' ? 'nao_validado' : 'risco';
      return `<div><span class="selo selo--${cls}" style="min-width:74px">${
        r.situacao === 'atendido' ? 'ok' : r.situacao === 'pendente' ? 'confirmar' : 'não'
      }</span> <span style="font-size:12px">${ui.esc(r.rotulo ?? r.chave)}</span></div>`;
    }).join('');

    return `<tr>
      <td><strong>${ui.esc(f.incentivo.nome)}</strong>
        <div style="font-size:11.5px;color:var(--ink-500)">${ui.esc(f.incentivo.base_legal)}</div>
        ${!f.regimeOk ? '<div class="selo selo--risco" style="margin-top:4px">regime incompatível</div>' : ''}</td>
      <td style="min-width:210px">${reqs || '<span style="color:var(--ink-400)">—</span>'}</td>
      <td><span class="selo selo--${f.etapa === 'ativo' ? 'validado' : 'neutro'}">${ui.ROTULO_ETAPA[f.etapa]}</span></td>
      <td class="n">
        <input type="number" step="0.01" min="0" style="width:130px;text-align:right"
               data-est="${f.incentivo.id}" value="${f.economia_estimada ?? ''}" placeholder="0,00"></td>
      <td>${ui.seloReforma(f.incentivo.status_reforma)}</td>
      <td>${ui.seloValidacao(f.incentivo.validacao)}</td>
      <td><select data-etapa="${f.incentivo.id}" style="min-width:150px">
        ${['triagem','elegivel','dossie','validacao_parceiro','ativo','negado'].map((e) =>
          `<option value="${e}"${e === f.etapa ? ' selected' : ''}>${ui.ROTULO_ETAPA[e]}</option>`).join('')}
      </select></td>
    </tr>`;
  }, 7);

  $$('#tb-incentivos [data-etapa]').forEach((sel) =>
    sel.addEventListener('change', () => gravarFunil(sel.dataset.etapa).catch(ui.erro)));
  $$('#tb-incentivos [data-est]').forEach((inp) =>
    inp.addEventListener('change', () => gravarFunil(inp.dataset.est).catch(ui.erro)));

  $('#sel-dossie').innerHTML = FUNIL
    .map((f) => `<option value="${f.incentivo.id}">${ui.esc(f.incentivo.nome)}</option>`).join('');
}

async function gravarFunil(incentivoId) {
  const etapa = $(`#tb-incentivos [data-etapa="${incentivoId}"]`).value;
  const est   = $(`#tb-incentivos [data-est="${incentivoId}"]`).value;

  let parceiro = null, validadoEm = null;
  if (etapa === 'ativo') {
    // §12.4 — o banco recusa "ativo" sem isso; a tela pede antes de tentar.
    parceiro = prompt('Etapa "ativo" exige validação de parceiro licenciado (§12.4).\n\nNome/registro do parceiro (OAB ou CRC):');
    if (!parceiro) { ui.toast('Etapa não alterada: sem parceiro validador.', 'aviso'); return renderIncentivos(); }
    validadoEm = ui.hoje();
  }

  await salvarFunil({
    empresaId: EMPRESA.id, incentivoId, etapa,
    estimada: est === '' ? null : Number(est),
    memoria: { origem: 'funil de qualificação', atualizado_em: new Date().toISOString() },
    parceiro, validadoEm,
  });
  ui.toast('Funil atualizado.');
  renderIncentivos();
}

/* ------------------------------------------------------------ dossiê */
async function montarDossie() {
  const incentivoId = $('#sel-dossie').value;
  const item = FUNIL.find((f) => f.incentivo.id === incentivoId);
  if (!item) throw new Error('Selecione um incentivo.');

  const [docs, { data: aud }] = await Promise.all([
    listarDocumentos(EMPRESA.id, null, 500),
    sb.from('auditoria').select('*').eq('empresa_id', EMPRESA.id)
      .order('ocorrido_em', { ascending: false }).limit(100),
  ]);

  return {
    titulo: `Dossiê probatório — ${item.incentivo.nome}`,
    gerado_em: new Date().toISOString(),
    empresa: {
      razao_social: EMPRESA.razao_social, cnpj: EMPRESA.cnpj,
      uf: EMPRESA.uf, regime: EMPRESA.regime, perfil: EMPRESA.perfil_setorial,
    },
    incentivo: {
      nome: item.incentivo.nome, codigo: item.incentivo.codigo,
      base_legal: item.incentivo.base_legal, ementa: item.incentivo.ementa,
      esfera: item.incentivo.esfera,
      status_reforma: item.incentivo.status_reforma,
      status_validacao: item.incentivo.validacao,
    },
    qualificacao: {
      etapa: item.etapa,
      requisitos: item.requisitos.map((r) => ({
        requisito: r.rotulo ?? r.chave, situacao: r.situacao, valor_encontrado: r.valor_encontrado,
      })),
      economia_estimada_anual: item.economia_estimada,
      economia_realizada_anual: item.economia_realizada,
    },
    documentos_fonte: docs.map((d) => ({
      tipo: d.tipo, chave_acesso: d.chave_acesso,
      hash_sha256: d.hash_sha256, arquivo: d.nome_arquivo,
      registrado_em: d.criado_em,
      inconsistencias: d.inconsistencias,
    })),
    trilha_auditoria: (aud ?? []).map((a) => ({
      quando: a.ocorrido_em, tabela: a.tabela, operacao: a.operacao, registro: a.registro_id,
    })),
    ressalva: 'Documento de evidência técnica emitido pela plataforma MBV ESG OS ISP. '
            + 'NÃO constitui parecer jurídico ou contábil (§12). Valores marcados como '
            + '"não validado" são estimativas pendentes de conferência por parceiro licenciado.',
  };
}

/* =========================================================== simulador */
async function renderSimulador() { /* preenchido sob demanda */ }

function ligarSimulador() {
  $('#form-sim').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const f = ui.lerForm(ev.target);
      const r = await simularRegimes({
        faturamento: f.faturamento, custos: f.custos ?? 0,
        capex: f.capex ?? 0, ano: Number(f.ano ?? new Date().getFullYear()),
      });

      const linha = (rot, c) => c?.aplicavel === false
        ? `<tr><td>${rot}</td><td colspan="2" style="color:var(--ink-400)">${ui.esc(c.motivo)}</td></tr>`
        : `<tr${rot.toLowerCase().includes(r.recomendado ?? '@') ? ' style="background:var(--verde-100)"' : ''}>
             <td><strong>${rot}</strong></td>
             <td class="n">${ui.fmtMoeda(c.total)}</td>
             <td class="n">${ui.fmtNum(c.aliquota_efetiva * 100, 2)}%</td></tr>`;

      $('#resultado-sim').innerHTML = `
        <div class="aviso"><strong>Comparativo técnico, não apuração fiscal</strong>
          ${ui.esc(r.disclaimer)} Parâmetros: ${ui.seloValidacao(PARAMETROS_FISCAIS.validacao)}</div>
        <div class="grade grade--2">
          <section class="cartao">
            <header><h2>Carga por regime — ano ${r.parametros.ano}</h2></header>
            <div class="tabela-wrap"><table class="tabela">
              <thead><tr><th>Regime</th><th class="n">Carga anual</th><th class="n">Efetiva</th></tr></thead>
              <tbody>
                ${linha('Simples', r.cenarios.simples)}
                ${linha('Presumido', r.cenarios.presumido)}
                ${linha('Real', r.cenarios.real)}
                <tr style="border-top:2px solid var(--ink-300)">
                  <td><strong>Cenário CBS/IBS</strong>
                    <div style="font-size:11.5px;color:var(--ink-500)">crédito amplo sobre CAPEX de rede</div></td>
                  <td class="n">${ui.fmtMoeda(r.cenarios.reforma.total)}</td>
                  <td class="n">${ui.fmtNum(r.cenarios.reforma.aliquota_efetiva * 100, 2)}%</td></tr>
              </tbody>
            </table></div>
          </section>
          <section class="cartao">
            <header><h2>Memória de cálculo</h2>
              <button class="btn btn--peq btn--sec" id="btn-salvar-sim">Salvar simulação</button></header>
            <div class="cartao__corpo">
              <p><strong>Menor carga:</strong> ${ui.esc(r.recomendado ?? '—')}
                 ${r.economia_vs_pior != null ? `· diferença para o pior cenário: <strong>${ui.fmtMoeda(r.economia_vs_pior)}</strong>` : ''}</p>
              <pre style="background:var(--ink-50);padding:12px;border-radius:6px;overflow:auto;font-size:11px;max-height:340px">${
                ui.esc(JSON.stringify(r.cenarios, null, 2))}</pre>
            </div>
          </section>
        </div>`;

      $('#btn-salvar-sim').addEventListener('click', async () => {
        const { error } = await sb.from('simulacoes_tributarias').insert({
          empresa_id: EMPRESA.id,
          rotulo: `Simulação ${r.parametros.ano}`,
          parametros: r.parametros, resultado: r,
        });
        if (error) return ui.erro(error);
        ui.toast('Simulação salva com memória de cálculo.');
      });
    } catch (e) { ui.erro(e); }
  });
}

/* ================================================================= P&D */
async function renderPd() {
  const { data, error } = await sb.from('projetos_pd')
    .select('*').eq('empresa_id', EMPRESA.id).order('exercicio', { ascending: false });
  if (error) throw error;

  ui.preencherTabela($('#tb-pd'), data, (p) => `
    <tr>
      <td><strong>${ui.esc(p.titulo)}</strong>
        ${p.elemento_tecnologico ? `<div style="font-size:11.5px;color:var(--ink-500);max-width:44ch">${ui.esc(p.elemento_tecnologico)}</div>` : ''}</td>
      <td class="n">${p.exercicio}</td>
      <td class="n">${ui.fmtMoeda(p.dispendio_total)}</td>
      <td class="n">${ui.fmtNum(p.percentual_exclusao, 2)}%</td>
      <td class="n">${ui.fmtMoeda(Number(p.dispendio_total ?? 0) * Number(p.percentual_exclusao ?? 0) / 100)}</td>
      <td><span class="selo selo--neutro">${ui.ROTULO_ETAPA[p.status] ?? p.status}</span></td>
    </tr>`, 6, 'Nenhum projeto registrado.');
}

/* ================================================================= MRV */
async function renderMrv() {
  const fs = await fechamentos(EMPRESA.id);
  ui.preencherTabela($('#tb-mrv'), fs, (f) => `
    <tr>
      <td>${ui.fmtComp(f.competencia)}</td>
      <td class="n">${ui.fmtTCO2e(f.total_passivo)}</td>
      <td class="n">${ui.fmtTCO2e(f.total_ativo)}</td>
      <td class="n"><strong>${ui.fmtTCO2e(f.saldo_liquido)}</strong></td>
      <td class="n">${f.qtd_documentos}</td>
      <td><span class="selo selo--${f.status === 'fechado' ? 'validado' : 'neutro'}">${f.status}</span></td>
    </tr>`, 6, 'Nenhuma competência fechada.');
}

/* ================================================================ selo */
async function renderSelo() {
  const ano = new Date().getFullYear();
  const b = await balanco(EMPRESA.id, { de: `${ano}-01-01`, ate: `${ano}-12-31` });
  const fatores = await carregarFatores();
  const preliminar = [...fatores.values()].some(fatorProvisorio);

  const verificacao = `${location.origin}${location.pathname.replace('isp.html', '')}#verificar=${EMPRESA.cnpj}-${ano}`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(verificacao)}`;

  $('#cartao-selo').innerHTML = `
    <div class="cartao">
      <header><h2>Selo ISP Verde ${ano}</h2>
        ${preliminar ? '<span class="selo selo--nao_validado">preliminar</span>'
                     : '<span class="selo selo--validado">validado</span>'}</header>
      <div class="cartao__corpo">
        ${preliminar ? `<div class="aviso"><strong>Selo preliminar</strong>
          Há fatores de emissão ainda não validados (§17). O selo só perde a marca
          "preliminar" quando todos os fatores aplicados estiverem validados.</div>` : ''}
        <div class="grade grade--2" style="align-items:start">
          <div>
            <h3>${ui.esc(EMPRESA.razao_social)}</h3>
            <p class="num" style="color:var(--ink-500)">${formataCnpj(EMPRESA.cnpj)}</p>
            <dl class="grade grade--3" style="margin-top:16px">
              <div class="kpi kpi--passivo"><dt>Emissões</dt><dd style="font-size:19px">${ui.fmtTCO2e(b.passivo)}<small>t</small></dd></div>
              <div class="kpi kpi--ativo"><dt>Remoções</dt><dd style="font-size:19px">${ui.fmtTCO2e(b.ativo)}<small>t</small></dd></div>
              <div class="kpi"><dt>Líquido</dt><dd style="font-size:19px">${ui.fmtTCO2e(b.liquido)}<small>t</small></dd></div>
            </dl>
            <p class="dica" style="margin-top:16px">
              Balanço apurado por partidas dobradas, com cada lançamento amarrado a um
              documento-fonte com hash SHA-256 verificável. Empresa abaixo do limiar de
              10.000 tCO₂e/ano do SBCE (Lei 15.042/2024) — monitorada, não obrigada.
            </p>
          </div>
          <div style="text-align:center">
            <img src="${qr}" alt="QR de verificação" width="140" height="140"
                 style="border:1px solid var(--ink-100);border-radius:6px;background:#fff;padding:6px">
            <p class="dica" style="margin-top:8px;font-size:11px">Verificação pública</p>
            <button class="btn btn--sec btn--peq" id="btn-selo-json">Exportar dados do selo</button>
          </div>
        </div>
      </div>
    </div>`;

  $('#btn-selo-json').addEventListener('click', () => {
    ui.baixarArquivo(`selo-isp-verde-${EMPRESA.cnpj}-${ano}.json`,
      JSON.stringify({ empresa: EMPRESA.razao_social, cnpj: EMPRESA.cnpj, exercicio: ano,
        passivo_tco2e: b.passivo, ativo_tco2e: b.ativo, liquido_tco2e: b.liquido,
        preliminar, verificacao }, null, 2), 'application/json');
  });
}

/* ======================================================= formulários */
function ligarFormularios() {
  ligarSimulador();

  /* --- unidade consumidora --- */
  $('#form-uc').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ui.lerForm(ev.target);
    const { error } = await sb.from('unidades_consumidoras').insert({
      empresa_id: EMPRESA.id, apelido: f.apelido, codigo_uc: f.codigo_uc,
      distribuidora: f.distribuidora, uf: f.uf ? f.uf.toUpperCase() : null,
      tipo: f.tipo, tem_gd_solar: f.tem_gd_solar === 'true',
      potencia_gd_kwp: f.potencia_gd_kwp,
    });
    if (error) return ui.erro(error);
    ui.toast('Unidade consumidora cadastrada.');
    ev.target.reset(); renderEnergia();
  });

  /* --- fatura de energia: documento + até dois lançamentos --- */
  $('#form-fatura').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const form = ev.target;
      const f = ui.lerForm(form);
      const arquivo = form.arquivo.files[0];
      if (!arquivo) throw new Error('Anexe a fatura.');
      if (!f.uc_id) throw new Error('Cadastre uma unidade consumidora primeiro.');

      const competencia = `${f.competencia}-01`;
      const kwhRede = Number(f.kwh_rede);
      const kwhGd   = Number(f.kwh_gd ?? 0);

      const { doc, reaproveitado } = await registrarDocumento({
        empresaId: EMPRESA.id, tipo: 'fatura_energia', arquivo,
        payload: {
          uc_id: f.uc_id, competencia, kwh_rede: kwhRede, kwh_gd: kwhGd,
          valor: f.valor == null ? null : Number(f.valor),
          extracao: 'assistida — valores confirmados pelo usuário (RF-ISP-002)',
        },
      });

      if (reaproveitado) {
        ui.toast('Esta fatura já havia sido importada (mesmo hash). Nenhum lançamento duplicado.', 'aviso', 8000);
        return;
      }

      await lancar({
        empresaId: EMPRESA.id, documentoFonteId: doc.id, perfil: 'isp',
        categoria: 'energia_pop', quantidadeOrigem: kwhRede, competencia,
      });

      if (kwhGd > 0) {
        await lancar({
          empresaId: EMPRESA.id, documentoFonteId: doc.id, perfil: 'isp',
          categoria: 'gd_solar', quantidadeOrigem: kwhGd, competencia,
          observacao: 'Energia compensada — Lei 14.300/2022.',
        });
      }

      ui.toast(`Fatura importada. ${kwhGd > 0 ? 'Dois lançamentos gerados (passivo + ativo).' : 'Lançamento passivo gerado.'}`);
      form.reset(); renderEnergia();
    } catch (e) { ui.erro(e); }
  });

  /* --- lote de NF-e de combustível --- */
  $('#form-nfe').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const arquivos = [...ev.target.arquivos.files];
    const rel = $('#relatorio-nfe');
    rel.innerHTML = '<p class="dica">Processando…</p>';

    const resultados = await lerLote(arquivos, lerNFe);
    const linhas = [];

    for (const r of resultados) {
      if (!r.ok) { linhas.push({ nome: r.arquivo.name, situacao: 'erro', detalhe: r.erro }); continue; }
      try {
        const d = r.dados;
        const { doc, reaproveitado } = await registrarDocumento({
          empresaId: EMPRESA.id, tipo: 'nfe', arquivo: r.arquivo,
          payload: d, chaveAcesso: d.chave_acesso, inconsistencias: d.inconsistencias,
        });

        if (reaproveitado) { linhas.push({ nome: r.arquivo.name, situacao: 'duplicado', detalhe: 'mesmo hash já registrado' }); continue; }

        if (!d.litros_combustivel) {
          linhas.push({ nome: r.arquivo.name, situacao: 'sem_lancamento',
            detalhe: 'Documento gravado, mas sem litros de combustível identificados.' });
          continue;
        }

        await lancar({
          empresaId: EMPRESA.id, documentoFonteId: doc.id, perfil: 'isp',
          categoria: 'frota', quantidadeOrigem: d.litros_combustivel,
          competencia: `${(d.emissao ?? ui.hoje()).slice(0, 7)}-01`,
          sobrescreverFator: d.itens.find((i) => i.fator_sugerido)?.fator_sugerido ?? null,
        });
        linhas.push({ nome: r.arquivo.name, situacao: 'ok',
          detalhe: `${ui.fmtNum(d.litros_combustivel, 2)} L · ${d.inconsistencias.length} inconsistência(s)` });
      } catch (e) {
        linhas.push({ nome: r.arquivo.name, situacao: 'erro', detalhe: e.message });
      }
    }

    // §10: relatório linha a linha — nunca falha silenciosa
    const cor = { ok: 'validado', duplicado: 'neutro', sem_lancamento: 'nao_validado', erro: 'risco' };
    rel.innerHTML = `<div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Arquivo</th><th>Situação</th><th>Detalhe</th></tr></thead>
      <tbody>${linhas.map((l) => `<tr>
        <td class="num" style="font-size:12px">${ui.esc(l.nome)}</td>
        <td><span class="selo selo--${cor[l.situacao]}">${l.situacao.replace('_', ' ')}</span></td>
        <td style="font-size:12px">${ui.esc(l.detalhe)}</td></tr>`).join('')}</tbody>
    </table></div>`;

    renderFrota();
  });

  /* --- ativo em comodato (registro manual) --- */
  $('#form-ativo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ui.lerForm(ev.target);
    const { error } = await sb.from('ativos_equipamento').insert({
      serial: f.serial, modelo: f.modelo, fabricante: f.fabricante,
      ncm: f.ncm, isp_id: EMPRESA.id, estado: 'novo', data_entrada: ui.hoje(),
    });
    if (error) return ui.erro(error);
    ui.toast('Equipamento registrado.');
    ev.target.reset(); renderComodato();
  });

  $('#busca-ativo').addEventListener('input', () => renderComodato().catch(ui.erro));
  $('#filtro-estado').addEventListener('change', () => renderComodato().catch(ui.erro));
  $('#btn-formar-lote').addEventListener('click', () => abrirFormarLote().catch(ui.erro));
  $('#btn-novo-destinador').addEventListener('click', () => abrirDestinador().catch(ui.erro));
  $('#btn-novo-produto').addEventListener('click', () => abrirProduto().catch(ui.erro));
  $('#busca-produto').addEventListener('input', () => renderProdutos().catch(ui.erro));
  $('#btn-novo-conector').addEventListener('click', () => abrirConector().catch(ui.erro));

  /* --- importação de planilhas --- */
  $('#arq-import').addEventListener('change', (ev) => {
    $('#btn-importar').disabled = !ev.target.files[0];
  });
  $('#btn-importar').addEventListener('click', () => {
    const arq = $('#arq-import').files[0];
    if (arq) abrirImportacao($('#sel-alvo').value, arq).catch(ui.erro);
  });

  /* --- peso por NCM --- */
  $('#btn-novo-peso-ncm').addEventListener('click', async () => {
    const ncm = prompt('NCM (8 dígitos):')?.replace(/\D/g, '');
    if (!ncm || ncm.length !== 8) return ui.toast('NCM precisa de 8 dígitos.', 'aviso');
    const peso = prompt(`Peso médio em kg para o NCM ${ncm}:`);
    const n = Number(String(peso ?? '').replace(',', '.'));
    if (!(n > 0)) return ui.toast('Peso inválido.', 'aviso');
    const { error } = await sb.from('pesos_referencia').upsert({
      empresa_id: EMPRESA.id, ncm, peso_kg: n, fonte: 'estimado',
    }, { onConflict: 'empresa_id,ncm' });
    if (error) return ui.erro(error);
    ui.toast('Peso de referência salvo.');
    renderProdutos();
  });

  /* --- NF-e de compra → inventário de rede --- */
  $('#form-nfe-equip').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const arquivos = [...ev.target.arquivos.files];
    const rel = $('#relatorio-equip');
    rel.innerHTML = `<p class="dica">Processando ${arquivos.length} arquivo(s)…</p>`;

    const resultados = await lerLote(arquivos, lerNFe);
    const linhas = [];

    for (const r of resultados) {
      if (!r.ok) { linhas.push({ nome: r.arquivo.name, situacao: 'erro', detalhe: r.erro }); continue; }
      try {
        const d = r.dados;
        const { doc, reaproveitado } = await registrarDocumento({
          empresaId: EMPRESA.id, tipo: 'nfe', arquivo: r.arquivo,
          payload: d, chaveAcesso: d.chave_acesso, inconsistencias: d.inconsistencias,
        });

        const inv = await rev.inventariarNFe({
          empresaId: EMPRESA.id, documento: doc, dadosNFe: d,
        });

        if (inv.semEquipamento) {
          linhas.push({ nome: r.arquivo.name, situacao: 'sem_equipamento',
            detalhe: 'NF-e gravada como documento-fonte, mas sem item de equipamento de rede.' });
        } else if (inv.criados === 0) {
          linhas.push({ nome: r.arquivo.name, situacao: 'duplicado',
            detalhe: `${inv.jaExistiam} equipamento(s) já estavam no inventário.` });
        } else {
          linhas.push({ nome: r.arquivo.name, situacao: 'ok',
            detalhe: `${inv.criados} equipamento(s) criados`
              + (inv.provisorios ? `, ${inv.provisorios} com serial provisório` : '')
              + (inv.jaExistiam ? `, ${inv.jaExistiam} já existiam` : '')
              + (inv.truncado ? ' — item truncado em 500 un.' : '')
              + (reaproveitado ? ' (NF-e já registrada antes)' : '') });
        }
      } catch (e) {
        linhas.push({ nome: r.arquivo.name, situacao: 'erro', detalhe: e.message });
      }
    }

    const cor = { ok: 'validado', duplicado: 'neutro', sem_equipamento: 'nao_validado', erro: 'risco' };
    rel.innerHTML = `<div class="tabela-wrap"><table class="tabela">
      <thead><tr><th>Arquivo</th><th>Situação</th><th>Detalhe</th></tr></thead>
      <tbody>${linhas.map((l) => `<tr>
        <td class="num" style="font-size:12px">${ui.esc(l.nome)}</td>
        <td><span class="selo selo--${cor[l.situacao]}">${l.situacao.replace(/_/g, ' ')}</span></td>
        <td style="font-size:12px">${ui.esc(l.detalhe)}</td></tr>`).join('')}</tbody>
    </table></div>`;

    renderComodato();
  });

  /* --- P&D --- */
  $('#form-pd').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ui.lerForm(ev.target);
    const { error } = await sb.from('projetos_pd').insert({
      empresa_id: EMPRESA.id, titulo: f.titulo, exercicio: Number(f.exercicio),
      elemento_tecnologico: f.elemento_tecnologico, barreira_tecnica: f.barreira_tecnica,
      horas_alocadas: f.horas_alocadas, dispendio_total: f.dispendio_total,
      percentual_exclusao: f.percentual_exclusao,
    });
    if (error) return ui.erro(error);
    ui.toast('Projeto de P&D registrado.');
    ev.target.reset(); renderPd();
  });

  /* --- MRV --- */
  $('#form-mrv').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const f = ui.lerForm(ev.target);
      await fecharCompetencia(EMPRESA.id, `${f.competencia}-01`);
      ui.toast('Competência fechada.');
      renderMrv();
    } catch (e) { ui.erro(e); }
  });

  /* --- dossiê --- */
  $('#btn-dossie').addEventListener('click', async () => {
    try {
      const d = await montarDossie();
      ui.baixarArquivo(`dossie-${d.incentivo.codigo}-${EMPRESA.cnpj}.json`,
        JSON.stringify(d, null, 2), 'application/json');
      ui.toast('Dossiê exportado.');
    } catch (e) { ui.erro(e); }
  });

  $('#btn-dossie-print').addEventListener('click', async () => {
    try {
      const d = await montarDossie();
      const w = window.open('', '_blank');
      w.document.write(`<!doctype html><meta charset="utf-8"><title>${ui.esc(d.titulo)}</title>
        <style>body{font:13px/1.6 system-ui;margin:40px;max-width:820px}
        h1{font-size:19px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-top:26px}
        table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ddd;padding:5px;text-align:left}
        .r{background:#fdf1d8;border-left:3px solid #c98a12;padding:10px;margin-top:24px;font-size:12px}
        code{font-size:11px;word-break:break-all}</style>
        <h1>${ui.esc(d.titulo)}</h1>
        <p>${ui.esc(d.empresa.razao_social)} · CNPJ ${ui.esc(d.empresa.cnpj)} · ${ui.esc(d.empresa.uf ?? '')}
           · gerado em ${new Date(d.gerado_em).toLocaleString('pt-BR')}</p>
        <h2>Base legal</h2><p>${ui.esc(d.incentivo.base_legal)}</p><p>${ui.esc(d.incentivo.ementa ?? '')}</p>
        <h2>Qualificação — etapa ${ui.esc(d.qualificacao.etapa)}</h2>
        <table><tr><th>Requisito</th><th>Situação</th></tr>${d.qualificacao.requisitos.map((r) =>
          `<tr><td>${ui.esc(r.requisito)}</td><td>${ui.esc(r.situacao)}</td></tr>`).join('')}</table>
        <h2>Documentos-fonte (${d.documentos_fonte.length})</h2>
        <table><tr><th>Tipo</th><th>Chave</th><th>Hash SHA-256</th></tr>${d.documentos_fonte.slice(0, 100).map((x) =>
          `<tr><td>${ui.esc(x.tipo)}</td><td><code>${ui.esc(x.chave_acesso ?? '—')}</code></td>
           <td><code>${ui.esc(x.hash_sha256)}</code></td></tr>`).join('')}</table>
        <div class="r">${ui.esc(d.ressalva)}</div>`);
      w.document.close(); w.print();
    } catch (e) { ui.erro(e); }
  });

  $('#btn-reavaliar').addEventListener('click', () => renderIncentivos().catch(ui.erro));
}

const CARREGADORES = {
  dashboard: renderDashboard, energia: renderEnergia, frota: renderFrota,
  comodato: renderComodato, destinadores: renderDestinadores,
  produtos: renderProdutos, importar: renderImportar, conectores: renderConectores,
  incentivos: renderIncentivos, simulador: renderSimulador,
  pd: renderPd, mrv: renderMrv, selo: renderSelo,
};
