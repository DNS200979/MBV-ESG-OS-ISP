-- =====================================================================
-- SEED: catálogo de incentivos (§3 da especificação)
--
--  ⚠️  Todos entram com validacao = 'nao_validado' (§12.2/§12.3).
--      Nenhuma economia é prometida antes da validação por parceiro
--      licenciado (advogado tributarista + contador).
--
--  `requisitos` alimenta o funil de qualificação (assets/js/fiscal.js):
--    {"chave": <campo da empresa>, "operador": in|>=|<=|=|existe, "valor": ...}
-- =====================================================================

insert into incentivos_catalogo
  (codigo, nome, esfera, uf, base_legal, ementa, aplica_perfil,
   regimes_elegiveis, requisitos, status_reforma)
values
  ('LEI_DO_BEM', 'Lei do Bem — dedução adicional de P&D', 'federal', null,
   'Lei 11.196/2005',
   'Exclusão adicional de 60% a 100% dos dispêndios de P&D na apuração de IRPJ/CSLL. '
   'Para ISP: automação de rede, IPv6, provisionamento, orquestração.',
   '{isp,distribuidor_telecom}', '{real}',
   '[{"chave":"regime","operador":"in","valor":["real"],"rotulo":"Apurar pelo Lucro Real"},
     {"chave":"tem_projeto_pd","operador":"=","valor":true,"rotulo":"Projeto de P&D cadastrado com elemento tecnológico"},
     {"chave":"lucro_no_exercicio","operador":"=","valor":true,"rotulo":"Lucro fiscal no exercício"}]',
   'sobrevive'),

  ('ICMS_INTERNET_POPULAR', 'ICMS — Internet Popular', 'estadual', null,
   'Convênios CONFAZ (adesão por UF)',
   'Isenção/redução de base de ICMS em planos de banda larga popular. '
   'Depende de adesão da UF e de enquadramento do plano.',
   '{isp}', '{simples,presumido,real}',
   '[{"chave":"uf","operador":"existe","valor":null,"rotulo":"UF com convênio vigente — conferir adesão"},
     {"chave":"qtd_assinantes","operador":">=","valor":1,"rotulo":"Base de assinantes cadastrada"}]',
   'extinto_2032'),

  ('SUDAM_SUDENE', 'SUDAM/SUDENE — redução de 75% do IRPJ', 'federal', null,
   'MP 2.199-14/2001 e legislação das superintendências',
   'Redução de 75% do IRPJ sobre o lucro da exploração para empreendimentos '
   'em área de atuação da SUDAM/SUDENE, com projeto aprovado.',
   '{isp,distribuidor_telecom}', '{real}',
   '[{"chave":"regime","operador":"in","valor":["real"],"rotulo":"Lucro Real"},
     {"chave":"uf","operador":"in","valor":["AC","AP","AM","PA","RO","RR","TO","MA","PI","CE","RN","PB","PE","AL","SE","BA","MG","ES"],"rotulo":"Sede/projeto na área de atuação"}]',
   'sobrevive'),

  ('GD_SOLAR', 'Geração distribuída solar (Lei 14.300)', 'federal', null,
   'Lei 14.300/2022',
   'Marco legal da GD: compensação de energia em UC própria. Reduz OPEX de '
   'energia dos POPs e gera lançamento ATIVO de carbono via fatura compensada.',
   '{isp,distribuidor_telecom}', '{simples,presumido,real}',
   '[{"chave":"tem_uc_propria","operador":"=","valor":true,"rotulo":"Unidade consumidora própria cadastrada"}]',
   'sobrevive'),

  ('TTD_SC_IMPORTACAO', 'TTD-SC 409/410/411 — importação', 'estadual', 'SC',
   'RICMS/SC e TTDs 409, 410 e 411',
   'Tratamento Tributário Diferenciado de SC na importação por conta própria. '
   'Alíquotas efetivas típicas de ~1–3%. Exige condicionantes e obrigações acessórias em dia.',
   '{distribuidor_telecom}', '{presumido,real}',
   '[{"chave":"uf","operador":"in","valor":["SC"],"rotulo":"Estabelecimento importador em SC"},
     {"chave":"tem_di","operador":"=","valor":true,"rotulo":"Operações de importação registradas (DI)"},
     {"chave":"condicionantes_em_dia","operador":"=","valor":true,"rotulo":"Condicionantes do TTD sem pendência"}]',
   'extinto_2032'),

  ('EX_TARIFARIO', 'Ex-tarifário — redução de II', 'federal', null,
   'Resoluções Gecex/Camex',
   'Redução temporária do Imposto de Importação para bens de capital e de '
   'informática sem similar nacional. OLTs, ONUs e equipamentos de rede são '
   'frequentemente elegíveis.',
   '{distribuidor_telecom}', '{simples,presumido,real}',
   '[{"chave":"tem_portfolio_ncm","operador":"=","valor":true,"rotulo":"Portfólio de NCM cadastrado"},
     {"chave":"tem_di","operador":"=","valor":true,"rotulo":"Importação própria"}]',
   'sobrevive'),

  ('LEI_INFORMATICA', 'Lei de Informática — PPB', 'federal', null,
   'Lei 8.248/1991',
   'Produtos com Processo Produtivo Básico. Não é benefício direto do '
   'distribuidor: entra como otimização do mix de compra (nacional '
   'incentivado × importado com TTD/ex-tarifário).',
   '{distribuidor_telecom}', '{presumido,real}',
   '[{"chave":"tem_portfolio_ncm","operador":"=","valor":true,"rotulo":"Portfólio de NCM cadastrado"}]',
   'indefinido'),

  ('RECICLA_MAIS', 'Certificados de crédito de reciclagem (Recicla+)', 'federal', null,
   'Decreto 11.413/2023',
   'Transforma a logística reversa (obrigação da PNRS) em crédito negociável '
   'e em ativo de carbono com lastro documental MTR/CDF.',
   '{isp,distribuidor_telecom}', '{simples,presumido,real}',
   '[{"chave":"tem_lote_reversa","operador":"=","valor":true,"rotulo":"Lote de reversa com CDF emitido"}]',
   'sobrevive'),

  ('PNRS_LOGISTICA_REVERSA', 'PNRS — logística reversa de eletroeletrônicos', 'federal', null,
   'Lei 12.305/2010 + Decreto 10.240/2020',
   'OBRIGAÇÃO JÁ EXISTENTE, não incentivo. Âncora regulatória do produto: '
   'o custo de compliance vira ativo (§1.3).',
   '{isp,distribuidor_telecom}', '{simples,presumido,real}',
   '[{"chave":"tem_lote_reversa","operador":"=","valor":true,"rotulo":"Programa de retorno estruturado"}]',
   'sobrevive'),

  ('FUST', 'FUST — fomento à banda larga', 'federal', null,
   'Lei 14.109/2020',
   'Linha de acesso a recursos para expansão de banda larga. Não é benefício '
   'fiscal — entra como caixa.',
   '{isp}', '{simples,presumido,real}',
   '[{"chave":"qtd_assinantes","operador":">=","valor":1,"rotulo":"ISP em operação"}]',
   'sobrevive'),

  ('FUNDO_COMPENSACAO', 'Fundo de Compensação de Benefícios Fiscais', 'federal', null,
   'EC 132/2023 + LC 214/2025',
   'Compensação de benefícios onerosos de ICMS extintos na transição. '
   'Exige HABILITAÇÃO prévia — o alerta de prazo é entregável do módulo.',
   '{distribuidor_telecom}', '{presumido,real}',
   '[{"chave":"tem_beneficio_icms","operador":"=","valor":true,"rotulo":"Benefício oneroso de ICMS vigente"}]',
   'substituido')
on conflict (codigo) do nothing;
