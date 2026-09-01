/* =====================================================================
 * Camada de apresentação: formatação, shell (sidebar + abas), toasts.
 * Sem framework — o padrão da spec é SPA single-file por módulo.
 * ===================================================================== */

/* ---------------------------------------------------------- formatação */
const nf = (min, max) => new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: min, maximumFractionDigits: max,
});

export const fmtNum   = (v, c = 2) => (v == null || isNaN(v)) ? '—' : nf(c, c).format(Number(v));
export const fmtInt   = (v)        => (v == null || isNaN(v)) ? '—' : nf(0, 0).format(Number(v));
export const fmtMoeda  = (v) => (v == null || isNaN(v))
  ? '—'
  : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v));
export const fmtTCO2e = (v) => `${fmtNum(v, 3)}`;
export const fmtData  = (v) => v ? new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
export const fmtComp  = (v) => v ? String(v).slice(0,7).split('-').reverse().join('/') : '—';
export const hoje     = () => new Date().toISOString().slice(0, 10);
export const competenciaAtual = () => `${new Date().toISOString().slice(0, 7)}-01`;

export const esc = (s) => String(s ?? '')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

/* --------------------------------------------------------------- selos */
const ROTULO_VALIDACAO = {
  validado:     'validado',
  em_validacao: 'em validação',
  nao_validado: 'não validado',
};

/** §12.3: toda tela que exibe economia carrega o selo de validação. */
export function seloValidacao(status) {
  const s = status ?? 'nao_validado';
  return `<span class="selo selo--${esc(s)}" title="${
    s === 'validado'
      ? 'Tese validada por parceiro licenciado.'
      : 'Estimativa técnica — sem validação de parceiro licenciado (§12).'
  }">${ROTULO_VALIDACAO[s] ?? s}</span>`;
}

const ROTULO_REFORMA = {
  sobrevive:    'sobrevive à reforma',
  extinto_2032: 'extinto até 2032',
  substituido:  'substituído',
  indefinido:   'indefinido',
};

export function seloReforma(status) {
  const cls = status === 'sobrevive' ? 'validado'
            : status === 'extinto_2032' ? 'risco'
            : 'neutro';
  return `<span class="selo selo--${cls}">${ROTULO_REFORMA[status] ?? status}</span>`;
}

export const ROTULO_ETAPA = {
  triagem: 'Triagem', elegivel: 'Elegível', dossie: 'Dossiê',
  validacao_parceiro: 'Validação parceiro', ativo: 'Ativo', negado: 'Negado',
};
export const ORDEM_ETAPAS = ['triagem','elegivel','dossie','validacao_parceiro','ativo'];

/* -------------------------------------------------------------- toasts */
export function toast(msg, tipo = 'ok', ms = 5000) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast${tipo === 'ok' ? '' : ` toast--${tipo}`}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function erro(e) {
  const msg = e?.message ?? String(e);
  console.error(e);
  toast(msg, 'erro', 9000);
}

/* ------------------------------------------------- abas / navegação SPA */
export function montarNavegacao({ nav, telas, aoTrocar }) {
  const botoes = [...nav.querySelectorAll('button[data-tela]')];

  const ir = (id) => {
    botoes.forEach((b) => {
      if (b.dataset.tela === id) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    telas.forEach((t) => t.classList.toggle('aba-oculta', t.id !== `tela-${id}`));
    if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
    aoTrocar?.(id);
  };

  botoes.forEach((b) => b.addEventListener('click', () => ir(b.dataset.tela)));
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (botoes.some((b) => b.dataset.tela === id)) ir(id);
  });

  const inicial = location.hash.slice(1);
  ir(botoes.some((b) => b.dataset.tela === inicial) ? inicial : botoes[0].dataset.tela);
  return ir;
}

/* ------------------------------------------------------------- tabelas */
export function preencherTabela(tbody, linhas, render, colunas, vazio = 'Nenhum registro.') {
  if (!linhas?.length) {
    tbody.innerHTML = `<tr><td class="vazio" colspan="${colunas}">${esc(vazio)}</td></tr>`;
    return;
  }
  tbody.innerHTML = linhas.map(render).join('');
}

/** Barra de partidas dobradas: passivo à esquerda, ativo à direita. */
export function barraBalanco(passivo, ativo) {
  const total = Number(passivo || 0) + Number(ativo || 0);
  if (!total) return '<div class="barra"></div>';
  const p = (Number(passivo || 0) / total) * 100;
  return `<div class="barra">
    <i class="b-passivo" style="width:${p.toFixed(1)}%"></i>
    <i class="b-ativo" style="width:${(100 - p).toFixed(1)}%"></i>
  </div>`;
}

/** Lê um <form> como objeto, convertendo vazios em null. */
export function lerForm(form) {
  const o = {};
  new FormData(form).forEach((v, k) => {
    const s = typeof v === 'string' ? v.trim() : v;
    o[k] = s === '' ? null : s;
  });
  return o;
}

export function baixarArquivo(nome, conteudo, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([conteudo], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
