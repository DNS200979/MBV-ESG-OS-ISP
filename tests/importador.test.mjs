import { DOMParser } from '@xmldom/xmldom';
globalThis.DOMParser = DOMParser;
globalThis.crypto ??= (await import('node:crypto')).webcrypto;

const m = await import('../assets/js/importador.js');
let falhas = 0;
const ok = (c, msg) => { console.log((c ? '  ok  ' : 'FALHA ') + msg); if (!c) falhas++; };

console.log('— CSV (RFC 4180) —');
const csv = m.parseCSV(`SKU;Descrição do Produto;Peso (kg);NCM
ONU-1;"ONU GPON; 1GE";0,42;8517.62.59
ONU-2;"Roteador ""AC1200""";1.250,50;85176259
ONU-3;"Linha com
quebra";0,3;85176259`);
ok(csv.cabecalho.length === 4, `4 colunas (veio ${csv.cabecalho.length})`);
ok(csv.linhas.length === 3, `3 linhas (veio ${csv.linhas.length})`);
ok(csv.linhas[0]['Descrição do Produto'] === 'ONU GPON; 1GE', 'separador dentro de aspas preservado');
ok(csv.linhas[1]['Descrição do Produto'] === 'Roteador "AC1200"', 'aspas escapadas');
ok(csv.linhas[2]['Descrição do Produto'] === 'Linha com\nquebra', 'quebra de linha dentro do campo');

console.log('— separador e BOM —');
const bom = m.parseCSV('﻿a,b\n1,2');
ok(bom.cabecalho[0] === 'a', 'BOM removido do primeiro cabeçalho');
ok(m.parseCSV('a\tb\n1\t2').cabecalho.length === 2, 'TSV detectado');

console.log('— números BR e US —');
ok(m.paraNumero('1.234,56') === 1234.56, 'formato BR');
ok(m.paraNumero('1,234.56') === 1234.56, 'formato US');
ok(m.paraNumero('0,42') === 0.42, 'decimal com vírgula');
ok(m.paraNumero('R$ 1.200,00') === 1200, 'símbolo de moeda ignorado');
ok(m.paraNumero('abc') === null, 'texto vira null');
ok(m.paraNumero('') === null, 'vazio vira null');

console.log('— datas —');
ok(m.paraData('31/12/2026') === '2026-12-31', 'dd/mm/aaaa');
ok(m.paraData('2026-12-31') === '2026-12-31', 'ISO');
ok(m.paraData('lixo') === null, 'data inválida vira null');

console.log('— mapeamento automático —');
const mapa = m.sugerirMapeamento(['SKU','Descrição do Produto','Peso (kg)','NCM'], 'produtos');
ok(mapa.sku === 'SKU', 'SKU casado');
ok(mapa.modelo === 'Descrição do Produto', 'descrição → modelo');
ok(mapa.peso_kg === 'Peso (kg)', 'peso casado com unidade no nome');
ok(mapa.ncm === 'NCM', 'NCM casado');
const mapa2 = m.sugerirMapeamento(['codigo','produto','peso','classificacao fiscal'], 'produtos');
ok(mapa2.sku === 'codigo' && mapa2.modelo === 'produto' && mapa2.ncm === 'classificacao fiscal',
   'sinônimos sem acento e sem maiúscula');

console.log('— conversão e validação linha a linha —');
const conv = m.converter({
  linhas: csv.linhas, mapa, alvo: 'produtos', empresaId: 'e1',
});
ok(conv.validos.length === 3, `3 registros válidos (veio ${conv.validos.length})`);
ok(conv.validos[0].ncm === '85176259', 'NCM com pontos normalizado para 8 dígitos');
ok(conv.validos[0].peso_kg === 0.42, 'peso convertido');
ok(conv.validos[0].origem_cadastro === 'planilha', 'procedência marcada como planilha');
ok(conv.validos[0].peso_fonte === 'planilha', 'fonte do peso marcada');

const ruim = m.converter({
  linhas: [{ SKU: 'X', 'Descrição do Produto': '', 'Peso (kg)': 'abc', NCM: '123' }],
  mapa, alvo: 'produtos', empresaId: 'e1',
});
ok(ruim.validos.length === 0 && ruim.erros.length === 1, 'linha ruim isolada, lote não aborta');
ok(ruim.erros[0].linha === 2, 'número da linha aponta para a planilha (com cabeçalho)');
ok(/não é número/.test(ruim.erros[0].erro) && /obrigatório/.test(ruim.erros[0].erro)
   && /8 dígitos/.test(ruim.erros[0].erro), 'os três problemas reportados juntos');

console.log('— XML tabular genérico —');
const xml = m.parseXMLTabular(`<?xml version="1.0"?><export>
  <produto><sku>A1</sku><descricao>ONU</descricao><peso>0,42</peso></produto>
  <produto><sku>A2</sku><descricao>OLT</descricao><peso>3,8</peso></produto>
</export>`);
ok(xml.elemento === 'produto', `elemento repetido detectado (${xml.elemento})`);
ok(xml.linhas.length === 2, '2 linhas do XML');
ok(xml.linhas[0].sku === 'A1', 'campo lido do XML');

console.log('— token de conector —');
const h = await m.sha256Hex('mbv_tok_exemplo');
ok(h === '79be48ed4c6102c0d1feca05c9192ff7cfe5d010e5f6a9495b3f0e919de9bfef',
   'SHA-256 idêntico ao do Postgres');

process.exit(falhas ? 1 : 0);
