/* =====================================================================
 * index.html — autenticação, cadastro multiempresa, vínculos §8,
 * trilha de auditoria e painel consolidado.
 * ===================================================================== */
import { sb, configurado, usuarioAtual, sair, minhasEmpresas, definirEmpresaAtiva,
         consultaCnpj, normalizaCnpj, formataCnpj, perfilPorCnae } from './db.js';
import { balanco } from './carbono.js';
import * as ui from './ui.js';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const mostrar = (id) => {
  ['tela-config', 'tela-login', 'app'].forEach((t) =>
    $(`#${t}`).classList.toggle('aba-oculta', t !== id));
};

let EMPRESAS = [];

/* ============================================================ arranque */
(async function iniciar() {
  if (!configurado()) { mostrar('tela-config'); return ligarConfig(); }

  const u = await usuarioAtual();
  if (!u) { mostrar('tela-login'); return ligarLogin(); }

  mostrar('app');
  $('#box-usuario').textContent = u.email ?? '';
  $('#btn-sair').addEventListener('click', sair);

  const TITULOS = {
    painel:    ['Painel', 'Consolidado de carbono e economia fiscal por empresa'],
    empresas:  ['Empresas', 'Cadastro por CNPJ com classificação automática de perfil'],
    vinculos:  ['Vínculos ISP ↔ Distribuidor', 'Ciclo de sinergia do §8, com consentimento explícito'],
    auditoria: ['Trilha de auditoria', 'RNF-005 — registro imutável de cada escrita'],
    catalogo:  ['Catálogo de incentivos', '§3 — base legal, reforma e status de validação'],
  };

  ui.montarNavegacao({
    nav: $('#nav'),
    telas: $$('.conteudo > section'),
    aoTrocar: (id) => {
      const [t, s] = TITULOS[id] ?? [id, ''];
      $('#titulo').textContent = t;
      $('#subtitulo').textContent = s;
      CARREGADORES[id]?.();
    },
  });

  ligarFormularios();
  await carregarEmpresas();
})().catch(ui.erro);

/* ========================================================= configuração */
function ligarConfig() {
  $('#form-config').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const { url, key } = ui.lerForm(ev.target);
    localStorage.setItem('cf.supabaseUrl', url);
    localStorage.setItem('cf.supabaseKey', key);
    location.reload();
  });
}

/* =============================================================== login */
function ligarLogin() {
  let acao = 'entrar';
  $$('#form-login button[data-acao]').forEach((b) =>
    b.addEventListener('click', () => { acao = b.dataset.acao; }));

  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { email, senha } = ui.lerForm(ev.target);
    try {
      if (acao === 'criar') {
        const { error } = await sb.auth.signUp({ email, password: senha });
        if (error) throw error;
        ui.toast('Conta criada. Se a confirmação por e-mail estiver ativa, confirme antes de entrar.', 'aviso', 9000);
      }
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw error;
      location.reload();
    } catch (e) { ui.erro(e); }
  });
}

/* ============================================================ empresas */
async function carregarEmpresas() {
  EMPRESAS = await minhasEmpresas();

  const box = $('#box-empresa');
  box.innerHTML = EMPRESAS.length
    ? `<strong>${ui.esc(EMPRESAS[0].razao_social)}</strong>
       <code>${formataCnpj(EMPRESAS[0].cnpj)}</code>
       <div style="margin-top:4px;color:var(--ink-400)">${EMPRESAS.length} empresa(s)</div>`
    : '<span style="color:var(--ink-400)">Nenhuma empresa cadastrada</span>';

  const selDist = $('#form-vinculo select[name="distribuidor_id"]');
  selDist.innerHTML = EMPRESAS
    .filter((e) => e.perfil_setorial === 'distribuidor_telecom')
    .map((e) => `<option value="${e.id}">${ui.esc(e.razao_social)}</option>`)
    .join('') || '<option value="">— cadastre um distribuidor —</option>';

  $('#sel-aud-empresa').innerHTML = EMPRESAS
    .map((e) => `<option value="${e.id}">${ui.esc(e.razao_social)}</option>`).join('');
}

const PERFIL_ROTULO = { isp: 'ISP', distribuidor_telecom: 'Distribuidor' };
const REGIME_ROTULO = { simples: 'Simples', presumido: 'Presumido', real: 'Lucro Real' };

function renderEmpresas() {
  ui.preencherTabela($('#tb-empresas'), EMPRESAS, (e) => `
    <tr>
      <td><strong>${ui.esc(e.razao_social)}</strong>
          ${e.nome_fantasia ? `<div style="color:var(--ink-400);font-size:12px">${ui.esc(e.nome_fantasia)}</div>` : ''}</td>
      <td class="num">${formataCnpj(e.cnpj)}</td>
      <td><span class="selo selo--neutro">${PERFIL_ROTULO[e.perfil_setorial]}</span></td>
      <td>${ui.esc(e.uf ?? '—')}</td>
      <td>${REGIME_ROTULO[e.regime] ?? '—'}</td>
      <td class="n">${ui.fmtMoeda(e.faturamento_anual)}</td>
      <td><button class="btn btn--peq" data-abrir="${e.id}" data-perfil="${e.perfil_setorial}">Abrir módulo</button></td>
    </tr>`, 7, 'Cadastre a primeira empresa acima.');

  $$('#tb-empresas [data-abrir]').forEach((b) =>
    b.addEventListener('click', () => {
      definirEmpresaAtiva(b.dataset.abrir);
      location.href = b.dataset.perfil === 'isp' ? 'isp.html' : 'dist.html';
    }));
}

function ligarFormularios() {
  /* --- consulta CNPJ (BrasilAPI com degradação graciosa) --- */
  $('#btn-consultar').addEventListener('click', async () => {
    const form = $('#form-empresa');
    const cnpj = normalizaCnpj(form.cnpj.value);
    if (cnpj.replace(/0/g, '') === '') return ui.toast('Informe um CNPJ.', 'aviso');

    const btn = $('#btn-consultar');
    btn.disabled = true; btn.textContent = 'Consultando…';
    const d = await consultaCnpj(cnpj);
    btn.disabled = false; btn.textContent = 'Consultar';

    if (!d) {
      return ui.toast('BrasilAPI indisponível — preencha os campos manualmente.', 'aviso', 7000);
    }
    form.razao_social.value   = d.razao_social ?? '';
    form.uf.value             = d.uf ?? '';
    form.municipio.value      = d.municipio ?? '';
    form.cnae_principal.value = d.cnae_principal ?? '';

    const p = perfilPorCnae(d.cnae_principal);
    if (p) {
      form.perfil_setorial.value = p.perfil;
      ui.toast(`CNAE ${d.cnae_principal} → perfil "${PERFIL_ROTULO[p.perfil]}".`);
    } else {
      ui.toast('CNAE não mapeado automaticamente — confira o perfil setorial.', 'aviso', 7000);
    }
  });

  /* --- cadastro --- */
  $('#form-empresa').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ui.lerForm(ev.target);
    const u = await usuarioAtual();
    const perfil = f.perfil_setorial;

    const { error } = await sb.from('empresas').insert({
      cnpj: normalizaCnpj(f.cnpj),
      razao_social: f.razao_social,
      cnae_principal: f.cnae_principal,
      uf: f.uf ? f.uf.toUpperCase() : null,
      municipio: f.municipio,
      regime: f.regime,
      perfil_setorial: perfil,
      tipo_operacao: perfil === 'isp' ? 'isp' : 'distribuidor',
      faturamento_anual: f.faturamento_anual,
      qtd_assinantes: f.qtd_assinantes,
      origem_cadastro: f.cnae_principal ? 'brasilapi' : 'manual',
      criado_por: u.id,
    });

    if (error) return ui.erro(error);
    ui.toast('Empresa cadastrada.');
    ev.target.reset();
    await carregarEmpresas();
    renderEmpresas();
  });

  /* --- vínculo §8 --- */
  $('#form-vinculo').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ui.lerForm(ev.target);

    const { data: isp, error: e1 } = await sb.from('empresas')
      .select('id').eq('cnpj', normalizaCnpj(f.isp_cnpj)).maybeSingle();
    if (e1) return ui.erro(e1);
    if (!isp) {
      return ui.toast('ISP não encontrado ou ainda sem acesso concedido a você.', 'aviso', 8000);
    }

    const { error } = await sb.from('vinculos_comerciais').insert({
      distribuidor_id: f.distribuidor_id,
      isp_id: isp.id,
      rateio_isp_pct: f.rateio_isp_pct ?? 50,
      consentido: false,
    });
    if (error) return ui.erro(error);

    ui.toast('Vínculo solicitado. Aguardando consentimento do ISP.');
    renderVinculos();
  });
}

/* ============================================================= painel */
async function renderPainel() {
  const ano = new Date().getFullYear();
  const de = `${ano}-01-01`, ate = `${ano}-12-31`;

  const linhas = [];
  for (const e of EMPRESAS) {
    const b = await balanco(e.id, { de, ate });
    linhas.push({ e, b });
  }

  const passivo = linhas.reduce((a, l) => a + l.b.passivo, 0);
  const ativo   = linhas.reduce((a, l) => a + l.b.ativo, 0);

  const { data: funis } = await sb.from('incentivos_empresa')
    .select('etapa_funil, economia_estimada_anual, economia_realizada_anual');

  const estimada  = (funis ?? []).reduce((a, f) => a + Number(f.economia_estimada_anual ?? 0), 0);
  const realizada = (funis ?? []).reduce((a, f) => a + Number(f.economia_realizada_anual ?? 0), 0);
  const emValidacao = (funis ?? []).filter((f) => f.etapa_funil === 'validacao_parceiro').length;

  $('#kpis').innerHTML = `
    <div class="kpi kpi--passivo"><dt>Passivo — emissões</dt>
      <dd>${ui.fmtTCO2e(passivo)}<small>tCO₂e</small></dd>
      <div class="rodape">Escopos 1, 2 e 3 no exercício ${ano}</div></div>
    <div class="kpi kpi--ativo"><dt>Ativo — remoções e desvios</dt>
      <dd>${ui.fmtTCO2e(ativo)}<small>tCO₂e</small></dd>
      <div class="rodape">GD solar, refurb e reversa certificada</div></div>
    <div class="kpi kpi--fiscal"><dt>Economia estimada / ano</dt>
      <dd style="font-size:21px">${ui.fmtMoeda(estimada)}</dd>
      <div class="rodape">${ui.seloValidacao('nao_validado')} até o parceiro validar</div></div>
    <div class="kpi kpi--alerta"><dt>Economia validada</dt>
      <dd style="font-size:21px">${ui.fmtMoeda(realizada)}</dd>
      <div class="rodape">${emValidacao} tese(s) na etapa de validação</div></div>`;

  ui.preencherTabela($('#tb-painel'), linhas, ({ e, b }) => `
    <tr>
      <td><strong>${ui.esc(e.razao_social)}</strong></td>
      <td>${PERFIL_ROTULO[e.perfil_setorial]}</td>
      <td>${ui.esc(e.uf ?? '—')}</td>
      <td class="n">${ui.fmtTCO2e(b.passivo)}</td>
      <td class="n">${ui.fmtTCO2e(b.ativo)}</td>
      <td class="n"><strong>${ui.fmtTCO2e(b.liquido)}</strong></td>
      <td>${ui.barraBalanco(b.passivo, b.ativo)}</td>
      <td><a class="btn btn--peq btn--sec" href="${e.perfil_setorial === 'isp' ? 'isp' : 'dist'}.html"
             data-abrir-link="${e.id}">Abrir</a></td>
    </tr>`, 8, 'Cadastre uma empresa para começar.');

  $$('#tb-painel [data-abrir-link]').forEach((a) =>
    a.addEventListener('click', () => definirEmpresaAtiva(a.dataset.abrirLink)));
}

/* =========================================================== vínculos */
async function renderVinculos() {
  const { data, error } = await sb.from('vinculos_comerciais')
    .select('*, dist:distribuidor_id(razao_social, cnpj), isp:isp_id(razao_social, cnpj)')
    .order('criado_em', { ascending: false });
  if (error) return ui.erro(error);

  const meusIds = new Set(EMPRESAS.map((e) => e.id));

  ui.preencherTabela($('#tb-vinculos'), data, (v) => `
    <tr>
      <td>${ui.esc(v.dist?.razao_social ?? '—')}</td>
      <td>${ui.esc(v.isp?.razao_social ?? '—')}</td>
      <td>${v.consentido
        ? `<span class="selo selo--validado">consentido</span>
           <div style="font-size:11px;color:var(--ink-400)">${ui.fmtData(v.consentido_em)}</div>`
        : '<span class="selo selo--nao_validado">pendente</span>'}</td>
      <td class="n">${ui.fmtNum(v.rateio_isp_pct, 2)}%</td>
      <td>${meusIds.has(v.isp_id)
        ? `<button class="btn btn--peq ${v.consentido ? 'btn--risco' : ''}"
             data-consent="${v.id}" data-valor="${v.consentido ? 'false' : 'true'}">
             ${v.consentido ? 'Revogar' : 'Consentir'}</button>`
        : '<span style="color:var(--ink-400);font-size:12px">só o ISP decide</span>'}</td>
    </tr>`, 5, 'Nenhum vínculo.');

  $$('#tb-vinculos [data-consent]').forEach((b) =>
    b.addEventListener('click', async () => {
      const { error } = await sb.from('vinculos_comerciais')
        .update({ consentido: b.dataset.valor === 'true' })
        .eq('id', b.dataset.consent);
      if (error) return ui.erro(error);
      ui.toast('Consentimento atualizado.');
      renderVinculos();
    }));
}

/* ========================================================== auditoria */
async function renderAuditoria() {
  const empresaId = $('#sel-aud-empresa').value || EMPRESAS[0]?.id;
  if (!empresaId) return ui.preencherTabela($('#tb-auditoria'), [], () => '', 4);

  const { data, error } = await sb.from('auditoria')
    .select('*').eq('empresa_id', empresaId)
    .order('ocorrido_em', { ascending: false }).limit(200);
  if (error) return ui.erro(error);

  ui.preencherTabela($('#tb-auditoria'), data, (a) => `
    <tr>
      <td class="num">${new Date(a.ocorrido_em).toLocaleString('pt-BR')}</td>
      <td><code>${ui.esc(a.tabela)}</code></td>
      <td><span class="selo selo--neutro">${a.operacao}</span></td>
      <td class="num" style="font-size:11px;color:var(--ink-400)">${ui.esc(a.registro_id ?? '—')}</td>
    </tr>`, 4, 'Sem eventos registrados ainda.');
}
$('#sel-aud-empresa')?.addEventListener('change', renderAuditoria);

/* =========================================================== catálogo */
async function renderCatalogo() {
  const { data, error } = await sb.from('incentivos_catalogo')
    .select('*').order('esfera').order('nome');
  if (error) return ui.erro(error);

  ui.preencherTabela($('#tb-catalogo'), data, (i) => `
    <tr>
      <td><strong>${ui.esc(i.nome)}</strong>
          <div style="color:var(--ink-500);font-size:12px;max-width:52ch">${ui.esc(i.ementa ?? '')}</div></td>
      <td class="num" style="font-size:12px">${ui.esc(i.base_legal)}</td>
      <td>${ui.esc(i.esfera)}${i.uf ? ` / ${ui.esc(i.uf)}` : ''}</td>
      <td style="font-size:12px">${(i.aplica_perfil ?? []).map((p) => PERFIL_ROTULO[p] ?? p).join(', ')}</td>
      <td>${ui.seloReforma(i.status_reforma)}</td>
      <td>${ui.seloValidacao(i.validacao)}</td>
    </tr>`, 6);
}

const CARREGADORES = {
  painel: renderPainel,
  empresas: renderEmpresas,
  vinculos: renderVinculos,
  auditoria: renderAuditoria,
  catalogo: renderCatalogo,
};
