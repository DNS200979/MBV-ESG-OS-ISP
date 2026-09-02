-- =====================================================================
-- SEED: pleitos de ex-tarifário — CONJUNTO INICIAL CURADO
--
--  ⚠️  validacao = 'nao_validado' em tudo. Contexto (set/2026):
--      os ex-tarifários vigentes de BIT estão consolidados na
--      Res. Gecex 781/2025 (BK na 780/2025) e zeram o II.
--      A lista completa (1.100+ itens BIT) é a planilha oficial:
--      gov.br/mdic → SDIC → Ex-Tarifário → Estatísticas → vigentes.
--      Carga completa: tools/carregar_ex_tarifario.py (CSV da planilha).
--
--  Cada linha abaixo é um NCM típico do portfólio telecom para o
--  cruzamento RF-DIST-004 começar a funcionar; o enquadramento fino
--  (Ex específico por descrição do bem) é do despachante/Comex.
-- =====================================================================

insert into ex_tarifario_pleitos
  (ncm, descricao, ato_normativo, aliquota_ii_reduzida, vigencia_ini, validacao)
values
  ('85176241', 'Roteadores digitais (redes com ou sem fio)',
   'Res. Gecex 781/2025 (BIT) — conferir Ex específico', 0.00, '2026-01-01', 'nao_validado'),
  ('85176249', 'Outros aparelhos para comutação de pacotes (switches)',
   'Res. Gecex 781/2025 (BIT) — conferir Ex específico', 0.00, '2026-01-01', 'nao_validado'),
  ('85176259', 'Outros aparelhos de transmissão/recepção de dados em rede (OLT, ONU/ONT, CPE)',
   'Res. Gecex 781/2025 (BIT) — conferir Ex específico', 0.00, '2026-01-01', 'nao_validado'),
  ('85177900', 'Partes de aparelhos de telecomunicação (placas de OLT, módulos)',
   'Res. Gecex 781/2025 (BIT) — conferir Ex específico', 0.00, '2026-01-01', 'nao_validado'),
  ('85447010', 'Cabos de fibras ópticas com revestimento externo dielétrico',
   'Res. Gecex 781/2025 (BIT) — conferir Ex específico', 0.00, '2026-01-01', 'nao_validado'),
  ('84715010', 'Unidades de processamento (servidores de headend/borda)',
   'Res. Gecex 780/2025 (BK) ou 781/2025 — conferir enquadramento', 0.00, '2026-01-01', 'nao_validado')
on conflict (ncm, descricao) do nothing;
