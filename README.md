# ERP CarbonFree Telecom

**Especificação Técnica e Funcional — v0.1 (rascunho para validação)**

| | |
|---|---|
| **Produto** | Plataforma de contabilidade de carbono e redução de custo fiscal para o ecossistema de telecomunicações |
| **Módulos** | Módulo 1 — ISP (provedores de internet) · Módulo 2 — Distribuidor (equipamentos de telecom) |
| **Autor** | DNS-TI Consultoria — Florianópolis/SC |
| **Projeto-irmão** | `ERP-CarbonFree-15042` (núcleo SBCE / Lei 15.042/2024) |
| **Data** | Setembro/2026 |
| **Status** | Rascunho — pendente de validação jurídica com parceiros licenciados |

---

## Sumário

1. [Visão e tese do produto](#1-visão-e-tese-do-produto)
2. [Escopo](#2-escopo)
3. [Contexto regulatório e base legal](#3-contexto-regulatório-e-base-legal)
4. [Arquitetura técnica](#4-arquitetura-técnica)
5. [Núcleo compartilhado](#5-núcleo-compartilhado)
6. [Módulo 1 — ISP](#6-módulo-1--isp)
7. [Módulo 2 — Distribuidor](#7-módulo-2--distribuidor)
8. [Ciclo de sinergia ISP ↔ Distribuidor](#8-ciclo-de-sinergia-isp--distribuidor)
9. [Modelo de dados](#9-modelo-de-dados)
10. [APIs](#10-apis)
11. [Requisitos não funcionais](#11-requisitos-não-funcionais)
12. [Conformidade e limites de atuação](#12-conformidade-e-limites-de-atuação)
13. [Roadmap](#13-roadmap)
14. [Modelo de negócio](#14-modelo-de-negócio)
15. [Riscos](#15-riscos)
16. [Glossário](#16-glossário)
17. [Pendências da v0.1](#17-pendências-da-v01)

---

## 1. Visão e tese do produto

### 1.1 Tese central

> **O produto vendável não é relatório ESG — é o dossiê probatório recorrente que sustenta redução de custo fiscal ano após ano.**

Consultoria tributária tradicional mapeia incentivos. O que ninguém entrega bem é a **evidência técnica auditável** que sustenta o benefício continuamente — e essa evidência nasce de documentos que ISPs e distribuidores **já emitem e já são assinados digitalmente pelo Estado**: NF-e, CT-e, faturas de energia, MTR e CDF de resíduos, DI de importação.

O usuário não preenche formulário: **ele importa o XML que já emitiu.**

### 1.2 Carbono como partidas dobradas

Todo lançamento segue a lógica contábil herdada do CarbonFree 15.042:

| Natureza | Exemplos no ecossistema telecom |
|---|---|
| **Passivo** (emissão) | Energia de POPs/OLTs, combustível de frota, climatização, transporte de carga (CT-e), descarte de equipamentos |
| **Ativo** (remoção/redução) | Geração distribuída solar, refurbish de ONUs, desvio de e-waste via logística reversa, certificados de reciclagem, eficiência energética comprovada |

Cada lançamento nasce amarrado a um documento-fonte com hash e chave de acesso — é isso que separa um relatório de sustentabilidade de um **documento fiscalizável**.

### 1.3 Posicionamento de venda

ISPs e distribuidores raramente cruzam o limiar de 10.000 tCO₂e/ano do SBCE. Portanto a âncora comercial **não é obrigação de reporte de carbono** — é:

1. **Dinheiro no caixa** — redução de custo fiscal e de energia, mensurável mês a mês;
2. **Obrigação legal já existente** — logística reversa de eletroeletrônicos (PNRS) já é mandatória; o produto transforma custo de compliance em ativo;
3. **Vantagem comercial ESG** — editais públicos, contratos B2B corporativos e exigências de cadeia de suprimentos de vendors internacionais.

---

## 2. Escopo

### 2.1 Dentro do escopo (v1)

- Motor de partidas dobradas de carbono com perfis setoriais **ISP** e **Distribuidor**;
- Importadores de documentos-fonte: NF-e, CT-e, fatura de energia, MTR/CDF;
- Catálogo estruturado de incentivos fiscais com funil de qualificação por empresa;
- Simulador de regime tributário (Simples × Presumido × Real) com cenário da reforma tributária;
- Gestão do ciclo de vida de equipamentos em comodato (ISP ↔ Distribuidor);
- Gestão de lotes de logística reversa e certificados de reciclagem;
- Fechamento MRV mensal (reuso do módulo existente);
- Dossiê probatório exportável (PDF) por empresa e por incentivo.

### 2.2 Fora do escopo (v1)

- Emissão de pareceres jurídicos ou assinatura de obrigações fiscais (ver §12);
- Integração transacional com SEFAZ (v1 trabalha com upload/importação de XML);
- Marketplace de créditos de carbono ou de certificados de reciclagem (roadmap futuro);
- App mobile nativo (v1 é web responsivo).

---

## 3. Contexto regulatório e base legal

> ⚠️ **Todas as bases abaixo carregam o campo `status_validacao` no catálogo. Nenhuma economia é prometida ao cliente antes da validação pelos parceiros licenciados (advogado tributarista + contador).**

| Base legal | Tema | Relevância |
|---|---|---|
| Lei 15.042/2024 (SBCE) | Mercado regulado de carbono; limiares 10.000/25.000 tCO₂e | Metodologia MRV herdada; clientes ficam em faixa "abaixo do limiar, monitorado" |
| Lei 12.305/2010 (PNRS) + Decreto 10.240/2020 | Logística reversa de eletroeletrônicos | **Obrigação já existente** de ISPs e distribuidores — âncora regulatória do produto |
| Decreto 11.413/2023 | Certificados de crédito de reciclagem (Recicla+) | Transforma logística reversa em crédito negociável e ativo de carbono |
| Lei 11.196/2005 (Lei do Bem) | Incentivo a P&D (dedução adicional IRPJ/CSLL) | ISPs em Lucro Real com projetos de automação de rede, IPv6, provisionamento |
| Lei 14.300/2022 | Marco da geração distribuída | Solar em POPs: reduz OPEX de energia e gera lançamento ativo |
| EC 132/2023 + LC 214/2025 | Reforma tributária (CBS/IBS) | 2026 é ano-teste; benefícios de ICMS extintos gradualmente até 2032; Fundo de Compensação exige habilitação |
| Convênios CONFAZ — Internet Popular | Isenção de ICMS em planos populares | Depende de adesão da UF — checklist por estado |
| TTDs de SC (409/410/411) e regimes equivalentes | Benefício de ICMS na importação | Alíquotas efetivas típicas de ~1–3% — o maior número da planilha do distribuidor |
| Ex-tarifário (Gecex/Camex) | Redução de II para bens sem similar nacional | OLTs, ONUs e equipamentos de rede frequentemente elegíveis |
| Lei 8.248/1991 (Lei de Informática) | PPB / produtos incentivados | Otimização de mix de compra (nacional incentivado × importado) |
| SUDAM/SUDENE | Redução de 75% do IRPJ em projetos aprovados | ISPs regionais do Norte/Nordeste em Lucro Real |
| Lei 14.109/2020 (novo FUST) | Fomento à expansão de banda larga | Linha de acesso a recursos (não fiscal, mas caixa) |
| Lei 13.709/2018 (LGPD) | Proteção de dados | Governança de dados de assinantes e de documentos fiscais |

---

## 4. Arquitetura técnica

Reuso integral do stack do `ERP-CarbonFree-15042`:

| Camada | Tecnologia | Observação |
|---|---|---|
| Backend | **FastAPI** (Python) | Novos routers `/api/v1/isp`, `/api/v1/dist`, `/api/v1/fiscal` |
| Banco | **Supabase** (PostgreSQL) | Novas tabelas do §9; RLS por empresa |
| Frontend | **SPA single-file** (`index.html` + páginas dedicadas) | Padrão `mrv_mensal.html` com patch de sidebar |
| Deploy | **Vercel** | Mesmo pipeline |
| Motor de cálculo | `motor_ia.py` → extensão de `PERFIS_SETORIAIS` | Dois perfis novos: `isp`, `distribuidor_telecom` |
| Cadastro | BrasilAPI (CNPJ → CNAE → setor) | Reuso, incluindo o fix de zeros à esquerda |

### 4.1 Princípios

1. **Documento-fonte primeiro** — nenhum lançamento de carbono ou de economia fiscal sem documento amarrado (hash + chave);
2. **Arquivos completos, não patches** — convenção de entrega do projeto;
3. **Degradação graciosa** — APIs externas (BrasilAPI etc.) sempre com fallback manual;
4. **Multiempresa** — um distribuidor enxerga seus ISPs clientes (com consentimento), habilitando o ciclo do §8.

---

## 5. Núcleo compartilhado

Componentes usados pelos dois módulos:

| Componente | Descrição |
|---|---|
| **Motor de partidas dobradas** | Lançamentos ativo/passivo em tCO₂e, escopos 1/2/3, sempre com `documento_fonte_id` |
| **Importadores XML** | NF-e (mercadoria e combustível), CT-e (frete), parser de fatura de energia (PDF/OCR assistido), MTR/CDF |
| **Catálogo de incentivos** | Estrutura já existente no módulo de benefícios fiscais, estendida com: esfera, base legal, requisitos objetivos, vigência, `status_reforma` (sobrevive / extinto até 2032 / substituído), `status_validacao` |
| **Funil de qualificação** | Elegibilidade por empresa: regime tributário → CNAE → UF → requisitos objetivos → economia estimada → dossiê |
| **Fechamento MRV mensal** | Reuso de `fechamentos_mensais` + `/api/v1/mrv` |
| **Dossiê probatório** | Export PDF por incentivo: base legal, memória de cálculo, documentos-fonte, trilha de auditoria |

---

## 6. Módulo 1 — ISP

### 6.1 Personas

| Persona | Papel |
|---|---|
| Dono/diretor do ISP | Decide; quer número de economia anual e selo comercial |
| Financeiro/contador do ISP | Alimenta e valida; usa o simulador de regime |
| Gerente de rede | Fonte dos dados de energia, POPs e comodato |
| Parceiro licenciado (externo) | Valida teses e assina o que exigir assinatura |

### 6.2 Perfil de emissões (`PERFIS_SETORIAIS['isp']`)

| Categoria | Escopo | Documento-fonte |
|---|---|---|
| Energia de POPs / headend / data center | 2 | Fatura de energia (por unidade consumidora) |
| Frota de instalação e manutenção | 1 | NF-e de combustível / abastecimento |
| Climatização (fugas de refrigerante) | 1 | Ordens de serviço / notas de recarga |
| Equipamentos em comodato (ONUs, roteadores) | 3 | NF-e de compra + inventário de ativos |
| Descarte / e-waste | 3 | MTR / CDF |

### 6.3 Alavancas de redução de custo fiscal

| Alavanca | Requisito-chave | O que o módulo entrega |
|---|---|---|
| **Lei do Bem** (P&D em rede, IPv6, automação) | Lucro Real; lucro no exercício | Captura de projetos e horas, memória de cálculo da dedução adicional, dossiê FORMP&D |
| **ICMS Internet Popular** | Adesão da UF; plano enquadrado | Checklist por estado + simulação de impacto na base de assinantes |
| **SUDAM/SUDENE** | Sede/projeto na área; Lucro Real; projeto aprovado | Pré-qualificação e checklist documental do pleito |
| **GD solar (Lei 14.300)** | Unidades consumidoras próprias | ROI por POP + lançamento ativo de carbono automático via fatura compensada |
| **Simulador de regime** | — | Simples × Presumido × Real, com cenário CBS/IBS (crédito amplo sobre CAPEX de rede) e curva de transição 2026–2033 |
| **Logística reversa como ativo** | Programa de retorno de comodato | Redução de perda de ativo + créditos do §8 |

### 6.4 Requisitos funcionais

| ID | Requisito |
|---|---|
| RF-ISP-001 | Cadastrar ISP via CNPJ com autopreenchimento (BrasilAPI) e classificação automática no perfil `isp` |
| RF-ISP-002 | Cadastrar unidades consumidoras (POPs) e importar faturas de energia com extração assistida de kWh e valores |
| RF-ISP-003 | Importar NF-e de combustível e classificar automaticamente como escopo 1 da frota |
| RF-ISP-004 | Manter inventário de equipamentos em comodato por serial/modelo com estados: `novo → em campo → retorno → refurb → descarte` |
| RF-ISP-005 | Gerar lançamentos de carbono (ativo/passivo) automaticamente a partir dos documentos importados |
| RF-ISP-006 | Executar funil de qualificação de incentivos e exibir economia potencial anual por alavanca |
| RF-ISP-007 | Simular regimes tributários com os dados reais de faturamento e CAPEX importados |
| RF-ISP-008 | Registrar projetos de P&D (Lei do Bem) com dossiê de evidências técnicas |
| RF-ISP-009 | Gerar selo/relatório "ISP Verde" com QR de verificação pública do balanço de carbono |
| RF-ISP-010 | Exportar dossiê probatório em PDF por incentivo e por exercício |

### 6.5 Telas (`isp.html`)

1. **Dashboard** — balanço de carbono (ativo × passivo), economia fiscal estimada × validada, alertas de prazo;
2. **Energia & POPs** — unidades consumidoras, faturas, curva kWh, oportunidade GD;
3. **Frota** — abastecimentos importados, tCO₂e/mês;
4. **Comodato** — inventário e ciclo de vida dos equipamentos;
5. **Incentivos** — funil, checklist por alavanca, dossiês;
6. **Simulador de regime** — comparativo com e sem reforma;
7. **Selo ISP Verde** — relatório público.

---

## 7. Módulo 2 — Distribuidor

### 7.1 Personas

| Persona | Papel |
|---|---|
| Diretor comercial/financeiro do distribuidor | Decide; foco em ICMS de importação e transição da reforma |
| Comex / despachante (externo) | Fonte de DIs e enquadramentos |
| Operação logística | Fonte de CT-e e lotes de reversa |
| Vendor internacional | Consumidor do relatório ESG de cadeia de suprimentos |

### 7.2 Perfil de emissões (`PERFIS_SETORIAIS['distribuidor_telecom']`)

| Categoria | Escopo | Documento-fonte |
|---|---|---|
| Transporte de carga (inbound/outbound) | 3 | **CT-e** (distância, modal, peso) |
| Armazenagem (energia de CD) | 2 | Fatura de energia |
| Frota própria | 1 | NF-e de combustível |
| Logística reversa de eletroeletrônicos | 3 (ativo) | MTR / CDF / certificado de reciclagem |
| Embalagens | 3 | NF-e de insumos |

### 7.3 Alavancas de redução de custo fiscal

| Alavanca | Requisito-chave | O que o módulo entrega |
|---|---|---|
| **TTD-SC / regimes estaduais de importação** | Enquadramento e obrigações acessórias em dia | Painel de conformidade das condicionantes + economia realizada por DI |
| **Ex-tarifário** | Bem sem similar nacional | Monitor de pleitos vigentes × portfólio de produtos (NCM) |
| **Transição da reforma tributária** | Habilitação no Fundo de Compensação | Cronograma 2026–2032, simulação de perda/compensação por benefício, alertas de prazo de habilitação |
| **Lei de Informática (mix de compra)** | — | Comparador de custo total: nacional incentivado × importado com TTD/ex-tarifário |
| **Certificados de reciclagem (Recicla+)** | Lotes de reversa com CDF | Emissão/controle de lastro dos certificados + lançamento ativo de carbono |
| **Planejamento ST/DIFAL** | — | Mapa de carga tributária por UF de destino (relatório, sem parecer) |

### 7.4 Requisitos funcionais

| ID | Requisito |
|---|---|
| RF-DIST-001 | Cadastrar distribuidor via CNPJ e classificar no perfil `distribuidor_telecom` |
| RF-DIST-002 | Importar CT-e em lote e calcular escopo 3 de transporte por embarque |
| RF-DIST-003 | Registrar DIs com enquadramento de benefício estadual e calcular economia realizada por operação |
| RF-DIST-004 | Cruzar NCMs do portfólio com pleitos de ex-tarifário vigentes e sinalizar oportunidades |
| RF-DIST-005 | Manter painel de condicionantes do TTD (obrigações acessórias, fundos, metas) com alertas |
| RF-DIST-006 | Gerir lotes de logística reversa: coleta → destinador → CDF → certificado |
| RF-DIST-007 | Simular a curva de extinção de benefícios de ICMS (2029–2032) e a compensação estimada |
| RF-DIST-008 | Gerar relatório ESG de cadeia de suprimentos por vendor (inglês/português) |
| RF-DIST-009 | Comparar custo total de aquisição: produto incentivado nacional × importado |
| RF-DIST-010 | Exportar dossiê probatório por benefício e por exercício |

### 7.5 Telas (`dist.html`)

1. **Dashboard** — economia de ICMS realizada, exposição à reforma, balanço de carbono;
2. **Importação** — DIs, enquadramentos, condicionantes do TTD;
3. **Ex-tarifário** — NCMs × pleitos;
4. **Logística (CT-e)** — embarques e tCO₂e;
5. **Reversa & Certificados** — lotes, CDFs, certificados emitidos;
6. **Reforma 2026–2033** — curva de transição e habilitações;
7. **Relatório Vendor ESG** — export bilíngue.

---

## 8. Ciclo de sinergia ISP ↔ Distribuidor

O diferencial competitivo do produto — nenhum concorrente fecha este ciclo:

```
Distribuidor vende/loca equipamento ──► ISP coloca em comodato no assinante
        ▲                                            │
        │                                            ▼
Certificado de reciclagem ◄── Destinador ◄── Retorno de comodato (churn/troca)
        │                                            │
        ▼                                            ▼
Ativo de carbono (dos dois lados)          Triagem: refurb ──► volta ao estoque
```

| Efeito | Beneficiário |
|---|---|
| Refurb de ONUs reduz CAPEX de reposição | ISP |
| Lote de reversa com lastro documental (MTR/CDF) | Distribuidor (obrigação PNRS cumprida + certificado) |
| Lançamento ativo de carbono compartilhado por rateio | Ambos |
| Dossiê ESG de cadeia completa para o vendor internacional | Distribuidor + DNS-TI como intermediário |

**Regra de rateio:** o ativo de carbono de cada lote é dividido entre ISP e distribuidor conforme percentual configurável por contrato (default 50/50), sempre com trilha de auditoria.

---

## 9. Modelo de dados

Extensões sobre o schema do CarbonFree 15.042 (PostgreSQL/Supabase, RLS por `empresa_id`):

```sql
-- Extensão de cadastro
ALTER TABLE empresas ADD COLUMN tipo_operacao TEXT
  CHECK (tipo_operacao IN ('isp','distribuidor','hibrido'));

-- Documentos-fonte (todo lançamento aponta para cá)
CREATE TABLE documentos_fonte (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id),
  tipo TEXT CHECK (tipo IN ('nfe','cte','fatura_energia','mtr','cdf','di','outro')),
  chave_acesso TEXT,            -- chave NF-e/CT-e quando houver
  hash_sha256 TEXT NOT NULL,
  payload JSONB,                -- campos extraídos
  arquivo_url TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- Partidas dobradas de carbono
CREATE TABLE lancamentos_carbono (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id),
  documento_fonte_id UUID REFERENCES documentos_fonte(id),
  natureza TEXT CHECK (natureza IN ('ativo','passivo')),
  escopo SMALLINT CHECK (escopo IN (1,2,3)),
  categoria TEXT,               -- energia_pop, frota, cte, reversa, gd_solar...
  quantidade_tco2e NUMERIC(14,4) NOT NULL,
  competencia DATE NOT NULL,
  memoria_calculo JSONB,
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- Ciclo de vida de equipamentos (comodato)
CREATE TABLE ativos_equipamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial TEXT UNIQUE,
  modelo TEXT, ncm TEXT,
  distribuidor_id UUID REFERENCES empresas(id),
  isp_id UUID REFERENCES empresas(id),
  estado TEXT CHECK (estado IN ('novo','em_campo','retorno','refurb','descarte')),
  documento_entrada_id UUID REFERENCES documentos_fonte(id),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

-- Logística reversa
CREATE TABLE lotes_reversa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id),
  peso_kg NUMERIC(12,2),
  destinador_cnpj TEXT,
  mtr_id UUID REFERENCES documentos_fonte(id),
  cdf_id UUID REFERENCES documentos_fonte(id),
  status TEXT CHECK (status IN ('coleta','transporte','destinado','certificado')),
  rateio_isp NUMERIC(5,2) DEFAULT 50.0
);

CREATE TABLE certificados_reciclagem (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID REFERENCES lotes_reversa(id),
  tipo TEXT,                    -- ex.: crédito de reciclagem (Decreto 11.413/2023)
  quantidade NUMERIC(12,2),
  numero_externo TEXT
);

-- Catálogo e funil de incentivos (estende o módulo existente)
ALTER TABLE incentivos_catalogo ADD COLUMN status_reforma TEXT
  CHECK (status_reforma IN ('sobrevive','extinto_2032','substituido','indefinido'));
ALTER TABLE incentivos_catalogo ADD COLUMN status_validacao TEXT
  CHECK (status_validacao IN ('validado','em_validacao','nao_validado'))
  DEFAULT 'nao_validado';

CREATE TABLE incentivos_empresa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id),
  incentivo_id UUID REFERENCES incentivos_catalogo(id),
  etapa_funil TEXT CHECK (etapa_funil IN
    ('triagem','elegivel','dossie','validacao_parceiro','ativo','negado')),
  economia_estimada_anual NUMERIC(14,2),
  economia_realizada_anual NUMERIC(14,2),
  evidencias UUID[]             -- documentos_fonte
);

-- Simulações tributárias
CREATE TABLE simulacoes_tributarias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id),
  parametros JSONB,             -- faturamento, CAPEX, UF, regime...
  resultado JSONB,              -- carga por cenário, incl. CBS/IBS 2026-2033
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- Reuso direto: fechamentos_mensais (MRV)
```

---

## 10. APIs

Novos routers FastAPI (padrão dos existentes, autenticação Supabase):

| Router | Endpoints principais |
|---|---|
| `/api/v1/isp` | `POST /pops` · `POST /faturas-energia` · `POST /frota/nfe` · `GET/POST /comodato` · `GET /balanco` |
| `/api/v1/dist` | `POST /cte/lote` · `POST /di` · `GET /ex-tarifario/match` · `GET/POST /reversa` · `GET /reforma/curva` |
| `/api/v1/fiscal` | `GET /catalogo` · `POST /funil/{empresa_id}` · `POST /simulador-regime` · `GET /dossie/{incentivo_id}.pdf` |
| Reuso | `/api/v1/mrv` (fechamentos) · `/api/v1/cnpj` (BrasilAPI + CNAE→setor) |

**Convenções:** respostas com `memoria_calculo` sempre presente; erros de importação de XML retornam linha a linha (nunca falha silenciosa); todo endpoint de escrita registra trilha de auditoria.

---

## 11. Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF-001 | RLS por empresa em todas as tabelas; distribuidor só enxerga ISPs com vínculo consentido |
| RNF-002 | Imutabilidade probatória: documento-fonte nunca é editado, apenas versionado; hash verificável |
| RNF-003 | LGPD: nenhum dado de assinante final trafega no sistema (agregados apenas) |
| RNF-004 | Importação de 1.000 CT-e em lote ≤ 60 s com relatório de inconsistências |
| RNF-005 | Trilha de auditoria completa (quem, quando, o quê) em lançamentos e funil |
| RNF-006 | Frontend responsivo (uso em campo/CD via celular) |
| RNF-007 | Backup diário e export completo por empresa (portabilidade) |
| RNF-008 | Disponibilidade alvo 99,5% (Vercel + Supabase) |

---

## 12. Conformidade e limites de atuação

Regra estrutural do negócio, herdada do CarbonFree 15.042:

1. **A DNS-TI não emite parecer jurídico nem assina obrigações fiscais.** Pareceres são de advogados tributaristas; escrituração e assinatura fiscal, de contadores registrados — ambos via **parceiros licenciados formalizados**;
2. O papel da plataforma e da DNS-TI é **evidência técnica, memória de cálculo e dossiê probatório**;
3. Toda tela que exibe economia estimada carrega o selo do `status_validacao` e o disclaimer correspondente;
4. O funil possui a etapa obrigatória `validacao_parceiro` antes de qualquer incentivo virar `ativo`.

---

## 13. Roadmap

| Fase | Duração | Entrega |
|---|---|---|
| **F0 — Fundação** | 3 semanas | Schema §9, perfis setoriais, extensão do catálogo com `status_reforma`/`status_validacao` |
| **F1 — ISP MVP** | 5 semanas | Energia + frota + funil + dashboard (`isp.html`); 2 ISPs piloto |
| **F2 — Distribuidor MVP** | 5 semanas | CT-e + DI/TTD + curva da reforma (`dist.html`); 1 distribuidor piloto |
| **F3 — Ciclo de sinergia** | 4 semanas | Comodato + reversa + certificados + rateio |
| **F4 — Simuladores** | 3 semanas | Regime tributário + transição 2026–2033 + dossiê PDF |
| **F5 — GTM** | contínuo | Selo ISP Verde, relatório Vendor ESG bilíngue, material comercial |

**Critério de Go/No-Go da F1 → F2:** pelo menos 1 ISP piloto com economia validada por parceiro licenciado.

---

## 14. Modelo de negócio

| Linha de receita | Modelo | Observação |
|---|---|---|
| SaaS Módulo ISP | Mensalidade por CNPJ, faixas por nº de assinantes | Autosserviço com onboarding assistido |
| SaaS Módulo Distribuidor | Mensalidade por CNPJ, faixas por volume de NF/CT-e | Ticket maior (economia de ICMS é o driver) |
| Recorrência consultiva | Retainer trimestral: manutenção do dossiê + acompanhamento de prazos (reforma, condicionantes TTD, FORMP&D) | Núcleo do modelo de recorrência da DNS-TI |
| Success fee estruturada | Percentual sobre economia validada, **contratada via parceiros licenciados** | Respeita o §12 |
| Relatório Vendor ESG | Por relatório/ano, bilíngue | Alavanca a posição de intermediário com vendors internacionais |

---

## 15. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Reforma tributária altera regras durante o desenvolvimento | Alto | Catálogo com `status_reforma`; simulador parametrizado, não hard-coded |
| Tese fiscal reprovada na validação jurídica | Alto | Nenhuma promessa antes de `validado`; funil com etapa obrigatória de parceiro |
| Benefício estadual depende de adesão/manutenção da UF | Médio | Checklist por estado com monitoramento de vigência |
| XML/fatura com dados incompletos | Médio | Importação com relatório de inconsistência + entrada manual auditada |
| Ciclo de venda do distribuidor mais longo | Médio | ISP MVP primeiro (F1) financia a esteira; distribuidor entra com caso pronto |
| Dependência de APIs externas (BrasilAPI etc.) | Baixo | Degradação graciosa já padronizada |

---

## 16. Glossário

| Termo | Definição |
|---|---|
| **SBCE** | Sistema Brasileiro de Comércio de Emissões (Lei 15.042/2024) |
| **MRV** | Monitoramento, Relato e Verificação |
| **TTD** | Tratamento Tributário Diferenciado (regimes de ICMS de SC) |
| **DI** | Declaração de Importação |
| **MTR / CDF** | Manifesto de Transporte de Resíduos / Certificado de Destinação Final |
| **PPB** | Processo Produtivo Básico (Lei de Informática) |
| **CBS / IBS** | Tributos da reforma (Contribuição/Imposto sobre Bens e Serviços) |
| **Comodato** | Cessão de equipamento (ONU/roteador) ao assinante sem transferência de propriedade |
| **Refurb** | Recondicionamento de equipamento retornado para reuso |

---

## 17. Pendências da v0.1

- [ ] Incorporar pesquisa complementar externa (material do cliente) ao catálogo de incentivos;
- [ ] Validação jurídica das teses fiscais com parceiros licenciados (marcar `status_validacao`);
- [ ] Confirmar números de convênios CONFAZ e adesões estaduais vigentes por UF;
- [ ] Definir fatores de emissão oficiais por categoria (fonte: inventários setoriais / GHG Protocol BR);
- [ ] Precificar tiers de SaaS com os pilotos;
- [ ] Nomear os produtos comerciais (sugestões: *CarbonFree ISP* e *CarbonFree Dist*).

---

*Documento de trabalho da DNS-TI Consultoria. Não constitui parecer jurídico ou contábil.*
