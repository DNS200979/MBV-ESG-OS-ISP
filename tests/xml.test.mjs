import { DOMParser } from '@xmldom/xmldom';
import fs from 'node:fs';
import path from 'node:path';

// caminhos relativos ao script, para rodar de qualquer cwd (inclusive CI)
const aqui = path.dirname(new URL(import.meta.url).pathname);
const fixture = (n) => fs.readFileSync(path.join(aqui, 'fixtures', n), 'utf8');
globalThis.DOMParser = DOMParser;
const { lerNFe, lerCTe, lerDocumentoXml } = await import('../assets/js/xml.js');

let falhas = 0;
const ok = (cond, msg) => { console.log((cond?'  ok  ':'FALHA ') + msg); if(!cond) falhas++; };

console.log('— NF-e —');
const n = lerNFe(fixture('nfe-combustivel.xml'));
ok(n.chave_acesso === '42260112345678000195550010000012341000012348', 'chave extraída do Id');
ok(n.emissao === '2026-01-15', 'data de emissão');
ok(n.emitente.cnpj === '12345678000195', 'CNPJ do emitente');
ok(n.valor_total === 1776, 'valor total');
ok(n.itens.length === 3, '3 itens lidos');
ok(n.itens[0].combustivel && n.itens[0].fator_sugerido === 'diesel_b', 'diesel identificado por NCM+descrição');
ok(n.itens[1].fator_sugerido === 'gasolina_c', 'gasolina identificada');
ok(n.itens[2].combustivel === false, 'ARLA 32 não é combustível');
ok(Math.abs(n.litros_combustivel - 230.5) < 1e-9, `litros somados = ${n.litros_combustivel}`);

console.log('— CT-e —');
const c = lerCTe(fixture('cte-rodoviario.xml'));
ok(c.chave_acesso === '42260198765432000188570010000045671000045675', 'chave extraída do Id');
ok(c.modal === 'rodoviario', 'modal 01 → rodoviário');
ok(c.uf_inicio === 'SC' && c.uf_fim === 'SP', 'rota SC → SP');
ok(Math.abs(c.peso_toneladas - 2.45) < 1e-9, `2450 kg → ${c.peso_toneladas} t`);
ok(c.valor_prestacao === 3200, 'valor da prestação');
ok(c.inconsistencias.some(i => i.includes('Distância')), 'inconsistência de distância registrada');

console.log('— NF-e de equipamentos (inventário de rede) —');
const { lerNFe: _ln } = await import('../assets/js/xml.js');
const eq = _ln(fixture('nfe-equipamentos.xml'));
const onu = eq.itens[0], olt = eq.itens[1], cabo = eq.itens[2], paraf = eq.itens[3];
ok(onu.equipamento === true, 'ONU classificada como equipamento (NCM 8517)');
ok(onu.unidades === 50, `50 unidades de ONU (veio ${onu.unidades})`);
ok(onu.seriais.length === 3, `3 seriais extraídos do infAdProd (veio ${onu.seriais.length})`);
ok(onu.seriais[0] === 'ALFA0000000001', 'serial correto do texto livre');
ok(onu.valor_unitario === 150, `valor unitário 150,00 (veio ${onu.valor_unitario})`);
ok(olt.seriais.length === 2, 'seriais no formato "N/S:" também extraídos');
ok(cabo.equipamento === true && cabo.unidades === 2000, 'cabo é equipamento; metros contados como unidades');
ok(paraf.equipamento === false, 'parafuso NÃO vira ativo de rede');
ok(eq.total_equipamentos === 2052, `total de equipamentos = ${eq.total_equipamentos}`);
ok(eq.inconsistencias.some(i => i.includes('série') || i.includes('provisório')),
   'inconsistência registrada para unidades sem série');

console.log('— roteamento e erro —');
ok(lerDocumentoXml(fixture('cte-rodoviario.xml')).tipo === 'cte', 'detecção automática de tipo');
try { lerDocumentoXml('<foo/>'); ok(false,'devia recusar XML desconhecido'); }
catch(e){ ok(e.message.includes('não reconhecido'), 'XML desconhecido recusado com mensagem clara'); }
try { lerNFe('não é xml <<<'); ok(false,'devia recusar lixo'); }
catch(e){ ok(true, 'entrada inválida recusada: ' + e.message.slice(0,40)); }

process.exit(falhas ? 1 : 0);
