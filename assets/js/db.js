/* =====================================================================
 * Cliente Supabase + sessão + empresa ativa.
 * Na v0 o Supabase É o backend: PostgREST substitui os routers do §10.
 * A tabela de equivalência com a spec está no README.
 * ===================================================================== */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm';
import { CONFIG, configurado } from './config.js';

export const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export { configurado };

/* --------------------------------------------------------------- sessão */
export async function usuarioAtual() {
  const { data, error } = await sb.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

export async function exigirSessao(destino = 'index.html') {
  const u = await usuarioAtual();
  if (!u) { location.href = destino; throw new Error('sem sessão'); }
  return u;
}

export async function sair() {
  await sb.auth.signOut();
  try { localStorage.removeItem('cf.empresaId'); } catch {}
  location.href = 'index.html';
}

/* ------------------------------------------------------- empresa ativa */
export function empresaAtivaId() {
  try { return localStorage.getItem('cf.empresaId'); } catch { return null; }
}

export function definirEmpresaAtiva(id) {
  try { localStorage.setItem('cf.empresaId', id); } catch {}
}

export async function minhasEmpresas() {
  const { data, error } = await sb
    .from('empresas')
    .select('id, cnpj, razao_social, nome_fantasia, uf, regime, tipo_operacao, perfil_setorial, qtd_assinantes, faturamento_anual')
    .order('razao_social');
  if (error) throw error;
  return data ?? [];
}

/**
 * Resolve a empresa de trabalho. `perfil` opcional restringe ao módulo
 * (isp.html só opera empresas de perfil `isp`, e assim por diante).
 */
export async function empresaDeTrabalho(perfil = null) {
  const empresas = await minhasEmpresas();
  const candidatas = perfil ? empresas.filter((e) => e.perfil_setorial === perfil) : empresas;
  if (!candidatas.length) return null;

  const salva = candidatas.find((e) => e.id === empresaAtivaId());
  const escolhida = salva ?? candidatas[0];
  definirEmpresaAtiva(escolhida.id);
  return escolhida;
}

/* ----------------------------------------------------- CNPJ / BrasilAPI */
export const soDigitos = (v) => (v ?? '').replace(/\D/g, '');

/** Preserva zeros à esquerda (fix herdado do 15.042) */
export const normalizaCnpj = (v) => soDigitos(v).padStart(14, '0').slice(-14);

export const formataCnpj = (v) => {
  const d = normalizaCnpj(v);
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
};

/** CNAE → perfil setorial. 61xx = telecom (ISP); 46xx/465x = distribuição */
export function perfilPorCnae(cnae) {
  const c = soDigitos(cnae);
  if (c.startsWith('61')) return { perfil: 'isp', tipo: 'isp' };
  if (c.startsWith('46') || c.startsWith('47')) {
    return { perfil: 'distribuidor_telecom', tipo: 'distribuidor' };
  }
  return null;
}

/**
 * §4.1 princípio 3 — degradação graciosa: se a BrasilAPI falhar, devolve
 * `null` e a tela cai para entrada manual em vez de travar o cadastro.
 */
export async function consultaCnpj(cnpj) {
  const d = normalizaCnpj(cnpj);
  try {
    const r = await fetch(CONFIG.brasilApiCnpj + d, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    return {
      cnpj: d,
      razao_social: j.razao_social ?? j.nome_fantasia ?? '',
      nome_fantasia: j.nome_fantasia ?? null,
      cnae_principal: String(j.cnae_fiscal ?? ''),
      cnae_descricao: j.cnae_fiscal_descricao ?? null,
      uf: j.uf ?? null,
      municipio: j.municipio ?? null,
    };
  } catch {
    return null;
  }
}
