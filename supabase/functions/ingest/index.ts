/**
 * Conector de ingestão — endpoint para ERP / CRM / WMS.
 *
 * POST https://<ref>.supabase.co/functions/v1/ingest
 *   Header: x-conector-token: <token do conector>
 *   Body:   { "alvo": "produtos", "registros": [ {...}, {...} ] }
 *
 * Contrato:
 *   - o token identifica a empresa E o escopo; um conector de produtos
 *     não escreve ativos;
 *   - a resposta traz o resultado linha a linha — nunca falha em silêncio
 *     (§10 da especificação);
 *   - toda chamada vira um registro em `importacoes`, com relatório;
 *   - a operação é idempotente por chave natural, então reenviar o mesmo
 *     lote não duplica nada.
 *
 * Deploy: supabase functions deploy ingest --no-verify-jwt
 * (--no-verify-jwt porque a autenticação aqui é o token do conector, não
 *  um JWT de usuário final.)
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-conector-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/** Alvos aceitos e como cada um é identificado para não duplicar. */
const ALVOS: Record<string, { tabela: string; conflito: string; obrigatorios: string[] }> = {
  produtos: {
    tabela: 'produtos',
    conflito: 'empresa_id,sku',
    obrigatorios: ['modelo'],
  },
  pesos_referencia: {
    tabela: 'pesos_referencia',
    conflito: 'empresa_id,ncm',
    obrigatorios: ['ncm', 'peso_kg'],
  },
  ativos: {
    tabela: 'ativos_equipamento',
    conflito: 'serial',
    obrigatorios: ['serial'],
  },
  unidades_consumidoras: {
    tabela: 'unidades_consumidoras',
    conflito: 'empresa_id,codigo_uc',
    obrigatorios: ['apelido'],
  },
  destinadores: {
    tabela: 'destinadores',
    conflito: 'empresa_id,cnpj',
    obrigatorios: ['cnpj', 'razao_social', 'tipo'],
  },
  portfolio_ncm: {
    tabela: 'portfolio_ncm',
    conflito: 'empresa_id,ncm',
    obrigatorios: ['ncm', 'descricao'],
  },
};

/** Campos aceitos por alvo — o que não estiver aqui é descartado. */
const CAMPOS: Record<string, string[]> = {
  produtos: ['sku', 'gtin', 'ncm', 'modelo', 'fabricante', 'categoria_reversa',
             'peso_kg', 'peso_fonte', 'carbono_incorporado_tco2e', 'carbono_fonte',
             'vida_util_meses', 'valor_referencia', 'ativo'],
  pesos_referencia: ['ncm', 'descricao', 'peso_kg', 'fonte'],
  ativos: ['serial', 'modelo', 'fabricante', 'ncm', 'estado', 'valor_aquisicao',
           'data_entrada', 'peso_kg', 'observacao'],
  unidades_consumidoras: ['apelido', 'codigo_uc', 'distribuidora', 'uf', 'municipio',
                          'tipo', 'tem_gd_solar', 'potencia_gd_kwp'],
  destinadores: ['cnpj', 'razao_social', 'nome_fantasia', 'tipo', 'uf', 'municipio',
                 'contato_nome', 'contato_email', 'contato_telefone',
                 'licenca_ambiental', 'licenca_orgao', 'licenca_validade',
                 'cadri', 'aceita_categorias', 'prazo_medio_dias', 'ativo'],
  portfolio_ncm: ['ncm', 'descricao', 'volume_anual'],
};

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

async function sha256Hex(texto: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);

  const token = req.headers.get('x-conector-token');
  if (!token) return json({ erro: 'Header x-conector-token ausente.' }, 401);

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // O token nunca é comparado em claro: o banco guarda só o SHA-256.
  const hash = await sha256Hex(token);
  const { data: conectores, error: erroAuth } = await db
    .from('conectores')
    .select('id, empresa_id, escopos, ativo')
    .eq('token_hash', hash)
    .eq('ativo', true)
    .limit(1);

  if (erroAuth) return json({ erro: 'Falha ao validar o conector.' }, 500);
  if (!conectores?.length) return json({ erro: 'Token inválido ou conector inativo.' }, 401);
  const conector = conectores[0];

  let corpo: { alvo?: string; registros?: unknown[] };
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: 'Corpo não é JSON válido.' }, 400);
  }

  const alvo = corpo.alvo ?? '';
  const def = ALVOS[alvo];
  if (!def) {
    return json({ erro: `Alvo inválido: "${alvo}".`, alvos_aceitos: Object.keys(ALVOS) }, 400);
  }
  if (!conector.escopos?.includes(alvo)) {
    return json({
      erro: `Conector sem escopo para "${alvo}".`,
      escopos_do_conector: conector.escopos,
    }, 403);
  }

  const registros = Array.isArray(corpo.registros) ? corpo.registros : [];
  if (!registros.length) return json({ erro: 'Nenhum registro enviado.' }, 400);
  if (registros.length > 5000) {
    return json({ erro: 'Máximo de 5.000 registros por chamada.' }, 413);
  }

  // Normaliza e valida linha a linha, sem abortar o lote por causa de uma
  const validos: Record<string, unknown>[] = [];
  const relatorio: { linha: number; erro: string; dados?: unknown }[] = [];

  registros.forEach((bruto, i) => {
    const reg = (bruto ?? {}) as Record<string, unknown>;
    const linha: Record<string, unknown> = { empresa_id: conector.empresa_id };

    for (const campo of CAMPOS[alvo]) {
      if (reg[campo] !== undefined && reg[campo] !== null && reg[campo] !== '') {
        linha[campo] = reg[campo];
      }
    }

    if (alvo === 'destinadores' && linha.cnpj) linha.cnpj = soDigitos(linha.cnpj);
    if (linha.ncm) linha.ncm = soDigitos(linha.ncm);
    if (linha.gtin) linha.gtin = soDigitos(linha.gtin);
    if (alvo === 'ativos') {
      linha.isp_id = conector.empresa_id;
      delete linha.empresa_id;              // ativos_equipamento não tem essa coluna
    }
    if (alvo === 'produtos' || alvo === 'pesos_referencia') {
      linha[alvo === 'produtos' ? 'peso_fonte' : 'fonte'] ??= 'erp';
      if (alvo === 'produtos') linha.origem_cadastro = 'erp';
    }

    const faltando = def.obrigatorios.filter((c) => {
      const chave = alvo === 'ativos' && c === 'serial' ? 'serial' : c;
      return linha[chave] === undefined;
    });
    if (faltando.length) {
      relatorio.push({ linha: i + 1, erro: `Campo obrigatório ausente: ${faltando.join(', ')}`, dados: reg });
      return;
    }
    if (linha.ncm && String(linha.ncm).length !== 8) {
      relatorio.push({ linha: i + 1, erro: `NCM inválido: "${reg.ncm}" (esperado 8 dígitos)`, dados: reg });
      return;
    }
    if (linha.peso_kg !== undefined && !(Number(linha.peso_kg) > 0)) {
      relatorio.push({ linha: i + 1, erro: `Peso inválido: "${reg.peso_kg}"`, dados: reg });
      return;
    }

    validos.push(linha);
  });

  let gravados = 0;
  if (validos.length) {
    const { data, error } = await db
      .from(def.tabela)
      .upsert(validos, { onConflict: def.conflito })
      .select('id');
    if (error) {
      relatorio.push({ linha: 0, erro: `Falha ao gravar: ${error.message}` });
    } else {
      gravados = data?.length ?? 0;
    }
  }

  const status = relatorio.length === 0 ? 'concluida'
               : gravados === 0 ? 'falhou' : 'parcial';

  await db.from('importacoes').insert({
    empresa_id: conector.empresa_id,
    conector_id: conector.id,
    origem: 'api',
    alvo,
    total_linhas: registros.length,
    criados: gravados,
    erros: relatorio.length,
    relatorio: relatorio.slice(0, 500),
    status,
  });

  await db.rpc('incrementar_recebidos', { p_conector: conector.id, p_qtd: gravados })
    .then(() => {}, () => {});   // contador é conveniência, não pode derrubar a resposta

  return json({
    status,
    alvo,
    recebidos: registros.length,
    gravados,
    erros: relatorio.length,
    relatorio: relatorio.slice(0, 100),
  }, status === 'falhou' ? 422 : 200);
});
