-- =====================================================================
-- SEED: curva de transição da reforma tributária (EC 132/2023 + LC 214/2025)
--
--  ⚠️  PARÂMETROS, não regra hard-coded (§15 — mitigação do risco nº 1).
--      validacao = 'nao_validado' até conferência com o texto vigente.
-- =====================================================================

insert into reforma_transicao
  (ano, cbs_pct, ibs_pct, icms_iss_pct, beneficios_icms_pct, observacao)
values
  (2026, 0.90, 0.10, 100.0, 100.0, 'Ano-teste: alíquotas compensáveis'),
  (2027, 100.0, 0.10, 100.0, 100.0, 'CBS integral; PIS/COFINS extintos'),
  (2028, 100.0, 0.10, 100.0, 100.0, 'Manutenção do teste do IBS'),
  (2029, 100.0, 10.00,  90.0,  90.0, 'Início da redução de ICMS/ISS e dos benefícios'),
  (2030, 100.0, 20.00,  80.0,  80.0, 'Fundo de Compensação exige habilitação prévia'),
  (2031, 100.0, 30.00,  70.0,  70.0, null),
  (2032, 100.0, 40.00,  60.0,  60.0, 'Último ano de benefícios estaduais de ICMS'),
  (2033, 100.0, 100.0,   0.0,   0.0, 'IBS integral; ICMS/ISS extintos')
on conflict (ano) do nothing;
