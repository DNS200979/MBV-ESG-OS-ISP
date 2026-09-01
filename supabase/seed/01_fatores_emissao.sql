-- =====================================================================
-- SEED: fatores de emissão
--
--  ⚠️  TODOS OS VALORES ABAIXO SÃO PROVISÓRIOS (validacao = 'nao_validado').
--      §17 pendência: "Definir fatores de emissão oficiais por categoria
--      (fonte: inventários setoriais / GHG Protocol BR)".
--      Substitua antes de qualquer uso comercial — o campo `fonte` deve
--      apontar para a publicação oficial e `validacao` virar 'validado'.
-- =====================================================================

insert into fatores_emissao
  (chave, descricao, unidade_origem, fator_tco2e, escopo, fonte, vigencia_ini)
values
  ('energia_rede_sin', 'Energia elétrica comprada da rede (SIN)',
   'kWh', 0.0000385, 2,
   'PROVISÓRIO — substituir pelo Fator Médio Anual de Emissão do SIN (MCTI)', '2026-01-01'),

  ('gd_solar_compensada', 'Energia solar compensada em UC própria (evita compra da rede)',
   'kWh', 0.0000385, 2,
   'PROVISÓRIO — espelha o fator do SIN; Lei 14.300/2022', '2026-01-01'),

  ('diesel_b', 'Diesel B — frota própria (combustão móvel)',
   'L', 0.0025310, 1,
   'PROVISÓRIO — substituir por GHG Protocol BR / Ferramenta de cálculo', '2026-01-01'),

  ('gasolina_c', 'Gasolina C — frota própria (combustão móvel)',
   'L', 0.0019870, 1,
   'PROVISÓRIO — substituir por GHG Protocol BR / Ferramenta de cálculo', '2026-01-01'),

  ('etanol_hidratado', 'Etanol hidratado — fração fóssil',
   'L', 0.0000000, 1,
   'PROVISÓRIO — CO2 biogênico reportado à parte (GHG Protocol)', '2026-01-01'),

  ('refrigerante_r410a', 'Fuga de refrigerante R-410A em climatização de POP',
   'kg', 2.0880000, 1,
   'PROVISÓRIO — GWP-100 AR5; confirmar gás efetivamente usado', '2026-01-01'),

  ('transporte_rodoviario', 'Transporte rodoviário de carga (CT-e)',
   't.km', 0.0001160, 3,
   'PROVISÓRIO — substituir por fator setorial de transporte de carga', '2026-01-01'),

  ('transporte_aereo', 'Transporte aéreo de carga (CT-e)',
   't.km', 0.0011000, 3,
   'PROVISÓRIO — substituir por fator setorial', '2026-01-01'),

  ('ewaste_reciclado', 'Eletroeletrônico desviado de aterro via logística reversa',
   'kg', 0.0012000, 3,
   'PROVISÓRIO — lançamento ATIVO; Decreto 11.413/2023; carece de metodologia validada', '2026-01-01'),

  ('ewaste_descartado', 'Eletroeletrônico descartado sem destinação certificada',
   'kg', 0.0009000, 3,
   'PROVISÓRIO — lançamento PASSIVO', '2026-01-01'),

  ('refurb_onu', 'Refurbish de ONU/roteador — carbono incorporado evitado',
   'unidade', 0.0250000, 3,
   'PROVISÓRIO — carbono incorporado de CPE; carece de EPD do fabricante', '2026-01-01'),

  ('equipamento_novo_cpe', 'Aquisição de CPE nova — carbono incorporado (escopo 3)',
   'unidade', 0.0250000, 3,
   'PROVISÓRIO — carbono incorporado de CPE; carece de EPD do fabricante', '2026-01-01'),

  ('embalagem_papelao', 'Embalagem de papelão — insumo',
   'kg', 0.0008000, 3,
   'PROVISÓRIO — substituir por fator setorial', '2026-01-01')
on conflict (chave, vigencia_ini) do nothing;
