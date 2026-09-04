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
  incentivos: renderIncentivos, simulador: renderSimulador,
  pd: renderPd, mrv: renderMrv, selo: renderSelo,
};
