# MBV ESG OS ISP

> Nome comercial definido em set/2026 (era o pendente §17 da spec).
> A especificação original em `docs/ESPECIFICACAO.md` mantém o nome de
> trabalho "ERP CarbonFree Telecom" como registro histórico.

Plataforma de contabilidade de carbono e dossiê probatório fiscal para o
ecossistema de telecom — **Módulo 1 (ISP)** e **Módulo 2 (Distribuidor)**.

A especificação funcional completa está em [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md).
Este README cobre **como rodar e como o código implementa a spec**.

> **Não constitui parecer jurídico ou contábil.** A plataforma entrega evidência
> técnica, memória de cálculo e dossiê probatório. Pareceres são de advogado
> tributarista; escrituração e assinatura fiscal, de contador registrado (§12).

---

## 1. Arquitetura desta fase

A spec (§4) prevê **FastAPI + Vercel**. A hospedagem escolhida foi **GitHub Pages**,
que serve apenas arquivos estáticos e não roda Python. A adaptação:

| Camada | Spec (§4) | Implementado agora | Migração futura |
|---|---|---|---|
| Frontend | SPA single-file | `index.html` · `isp.html` · `dist.html` — HTML/CSS/JS puro, zero build | inalterado |
| Backend | routers FastAPI | **Supabase é o backend**: PostgREST expõe as tabelas, RLS faz a autorização | os routers §10 entram sem mexer no front |
| Banco | Supabase (Postgres) | Supabase, RLS por empresa | inalterado |
| Deploy | Vercel | GitHub Pages (`.github/workflows/pages.yml`) | Vercel: mesmo repo, sem mudança de código |
| Parse de XML | backend | **navegador** (`DOMParser`) — o XML não sai da máquina do cliente | pode virar Edge Function para lotes grandes |
| Hash probatório | backend | **navegador** (`crypto.subtle`, SHA-256) | inalterado |
| Dossiê PDF | backend | JSON assinável + versão imprimível | Edge Function na F4 |

**Equivalência com as APIs do §10** — o front chama PostgREST no lugar dos routers:

| Router da spec | Equivalente atual |
|---|---|
| `POST /api/v1/isp/pops` | `sb.from('unidades_consumidoras').insert(...)` |
| `POST /api/v1/isp/faturas-energia` | `docfonte.registrarDocumento()` + `carbono.lancar()` |
| `POST /api/v1/dist/cte/lote` | `xml.lerLote()` + `carbono.lancar()` por documento |
| `GET /api/v1/dist/reforma/curva` | `sb.from('reforma_transicao')` |
| `POST /api/v1/fiscal/funil/{id}` | `fiscal.funilDaEmpresa()` |
| `POST /api/v1/fiscal/simulador-regime` | `fiscal.simularRegimes()` |
| `GET /api/v1/mrv` | `carbono.fecharCompetencia()` / `fechamentos()` |

---

## 2. Plugins e extensões recomendados

### 2.1 Plugins do Claude Code (para desenvolver)

| Plugin | Para quê | Situação |
|---|---|---|
| **`supabase`** | schema, RLS, migrações, debugging de Postgres. Traz a skill `supabase-postgres-best-practices`, que foi usada para escrever as policies deste repo | **instalado — essencial** |
| **`vercel`** | só faz sentido quando/se migrar o deploy do Pages para a Vercel (Edge Functions, dossiê PDF, cron) | instalado, ocioso por ora |
| `frontend-design` | se for evoluir a identidade visual além do design system atual | opcional |

O **MCP do Supabase** (`mcp.supabase.com`) vale a pena conectar: permite rodar
SQL, ler logs e consultar advisors de segurança direto da sessão.

### 2.2 Extensões Postgres a habilitar no Supabase

| Extensão | Para quê | Quando |
|---|---|---|
| `pgcrypto` | `gen_random_uuid()` | **já usada** — habilitada na migração 01 |
| `pg_cron` | alertas de prazo: condicionantes do TTD, habilitação no Fundo de Compensação (§7.3) | **habilitado** — job `mbv-alertas-diarios`, 06:00 BRT (migração 10) |
| `pg_net` | disparar webhook/e-mail quando um prazo vence | F2 |
| `pg_trgm` | busca por serial/modelo no inventário de comodato quando passar de ~50k ativos | F3 |

### 2.3 Bibliotecas do front

Uma só: **`@supabase/supabase-js@2.112.4`**, via CDN e com versão fixada.
Nada de framework, bundler ou passo de build — a spec pede SPA single-file, e
GitHub Pages serve o repositório como está. Para o PDF nativo do dossiê (F4),
a escolha natural é gerar no servidor (Edge Function), não no navegador.

---

## 3. Colocar no ar

### 3.1 Criar o projeto Supabase

1. Crie o projeto em [supabase.com](https://supabase.com).
2. Aplique as migrações **na ordem**, pelo SQL Editor ou pela CLI:

   ```bash
   supabase link --project-ref <ref>
   supabase db push          # aplica supabase/migrations/*
   ```

   Ou, manualmente, cole no SQL Editor na ordem numérica:

   ```
   supabase/migrations/20260901000100_fundacao.sql
   supabase/migrations/20260901000200_cadastro.sql
   supabase/migrations/20260901000300_carbono.sql
   supabase/migrations/20260901000400_telecom.sql
   supabase/migrations/20260901000500_fiscal.sql
   supabase/migrations/20260901000600_rls.sql
   supabase/migrations/20260901000700_storage.sql
   ```

3. Popule os catálogos:

   ```
   supabase/seed/01_fatores_emissao.sql
   supabase/seed/02_reforma_transicao.sql
   supabase/seed/03_incentivos_catalogo.sql
   ```

4. **Exposed schemas** (Settings → API): deixe apenas `public`.
   O schema `private` guarda os helpers `SECURITY DEFINER` das policies e
   **não pode** ser exposto.

5. Authentication → Providers: habilite **Email**. Para os primeiros testes,
   desligar "Confirm email" acelera.

### 3.2 Configurar o cliente

Edite `assets/js/config.js`:

```js
supabaseUrl: 'https://<ref>.supabase.co',
supabaseKey: '<chave publishable / anon>',
```

A chave *publishable* **é pública por natureza** e pode ser commitada: o que
protege os dados é a RLS. **Nunca** coloque a `service_role` no repositório.

Para testar sem commitar, a tela de configuração do `index.html` grava os
valores em `localStorage`.

### 3.3 Publicar no GitHub Pages

Settings → Pages → Source: **GitHub Actions**. O push na `main` dispara
`.github/workflows/pages.yml`.

---

## 4. Estrutura

```
index.html              Login, cadastro multiempresa, vínculos §8, auditoria, catálogo
isp.html                Módulo 1 — 13 telas (§6.5 + P&D + MRV + destinadores + produtos + dados)
dist.html               Módulo 2 — 8 telas (§7.5 + incentivos)

assets/css/app.css      Design system único
assets/js/
  config.js             URL e chave pública (com override por localStorage)
  db.js                 Cliente Supabase, sessão, empresa ativa, BrasilAPI
  ui.js                 Formatação pt-BR, navegação SPA, selos, toasts
  docfonte.js           SHA-256, upload, registro imutável de documento-fonte
  xml.js                Parsers NF-e e CT-e (DOMParser, com inconsistências)
  carbono.js            Motor de partidas dobradas + PERFIS_SETORIAIS
  fiscal.js             Funil de qualificação, simulador de regime, curva da reforma
  reversa.js            NF-e → inventário, triagem, destinadores, formação de lote
  importador.js         Núcleo puro: parsers CSV/XLSX/XML, de-para, conversão
  importador-io.js      Gravação das importações e gestão de conectores
  app-index.js          Lógica do painel
  app-isp.js            Lógica do Módulo 1
  app-dist.js           Lógica do Módulo 2

supabase/migrations/    20 migrações — schema §9 + RLS + Storage + alertas + reversa + catálogo + conectores
supabase/functions/     Edge Function `ingest` — endpoint do conector de ERP/CRM
supabase/seed/          Catálogo de incentivos, fatores, curva da reforma
supabase/tests/         Stub do ambiente Supabase + 10 testes de RLS
tests/                  Parsers (28 asserções) + importador (33 asserções) + fixtures
docs/ESPECIFICACAO.md   A spec original
```

---

## 5. As regras que o banco impõe

O produto vive de evidência, então as regras críticas ficam **no banco**, não na
tela — a interface não é a última linha de defesa.

| Regra | Onde | Teste |
|---|---|---|
| Isolamento por empresa | RLS em toda tabela do `public` | `01_rls.sql` T1 |
| Distribuidor só vê ISP com vínculo consentido (RNF-001) | `private.pode_ver()` | T2, T5 |
| Vínculo nunca nasce consentido | policy `vinculos_ins` | T3 |
| Só o ISP concede/revoga consentimento | gatilho `fn_consentimento_isp` | T4 |
| Consentimento dá leitura, não escrita | ausência de policy de escrita cruzada | T6 |
| Documento-fonte é imutável (RNF-002) | sem policy de UPDATE + gatilho que barra até `service_role` | T7a, T7b |
| Nenhum incentivo vira `ativo` sem parceiro licenciado (§12.4) | gatilho `fn_valida_funil` | T8 |
| Trilha de auditoria completa (RNF-005) | gatilho `fn_auditoria` (append-only) | T9 |
| Lote só é `destinado` com CDF anexado | `check` constraint `lote_destinado_exige_cdf` | — |
| Lote não se forma com licença ambiental vencida | `formar_lote_reversa()` | T13 |
| Lote não se forma vazio | `formar_lote_reversa()` | T15 |
| Triagem é laudo — não se reescreve | sem `GRANT UPDATE` em `triagens` | T16 |
| Destinadores e triagens isolados por empresa | RLS `pode_ver`/`pode_editar` | T18 |
| Peso do lote vem do catálogo, com composição por procedência | `formar_lote_reversa()` | T21 |
| Conector só escreve dentro do seu escopo | Edge Function `ingest` | E2E |
| Token de conector nunca é guardado em claro | `token_hash` (SHA-256) | E2E |
| Empresa pode ser removida por inteiro (RNF-007/LGPD) | ações de exclusão nas FKs + cascata no gatilho | T19 |
| Exclusão avulsa de prova segue bloqueada | `fn_bloqueia_alteracao` | T20 |
| Lançamento sem documento-fonte é recusado (§4.1) | `NOT NULL` na FK + guarda no motor | — |

Rodar os testes localmente:

```bash
# Banco (precisa de Docker)
docker run -d --name cfpg -e POSTGRES_PASSWORD=pg postgres:17-alpine
for f in supabase/tests/00_stub_supabase.sql \
         supabase/migrations/2026090100010*.sql supabase/migrations/2026090100[2-6]*.sql \
         supabase/seed/*.sql; do
  docker exec -i cfpg psql -v ON_ERROR_STOP=1 -U postgres < "$f" >/dev/null
done
docker exec -i cfpg psql -U postgres < supabase/tests/01_rls.sql

# Parsers de XML
npm i --no-save @xmldom/xmldom && node tests/xml.test.mjs
```

Ambos rodam em CI (`.github/workflows/testes.yml`).

---

## 6. O que está pendente — e por quê

Isto é a §17 da spec, com o estado real do código.

### 6.1 Números provisórios (não usar comercialmente antes de validar)

- **Fatores de emissão** (`supabase/seed/01_fatores_emissao.sql`): todos entram
  como `validacao = 'nao_validado'` com `fonte` dizendo "PROVISÓRIO". O motor
  propaga esse status para a memória de cálculo de cada lançamento e o Selo ISP
  Verde sai marcado como **preliminar** enquanto houver fator não validado.
  Substituir pelo fator do SIN (MCTI) e por inventários setoriais / GHG Protocol BR.
- **Parâmetros do simulador** (`PARAMETROS_FISCAIS` em `assets/js/fiscal.js`):
  faixas do Simples, presunções, alíquotas e a alíquota de referência CBS/IBS.
  Conferir com o parceiro contábil.
- **Curva da reforma** (`supabase/seed/02_reforma_transicao.sql`): percentuais de
  2026 a 2033 conferem com o desenho publicado da transição, mas seguem
  `nao_validado` até checagem do texto vigente.
- **Catálogo de incentivos**: os 11 itens do §3 entram `nao_validado`. Nenhuma
  economia é prometida antes da etapa `validacao_parceiro`.

### 6.2 Automação do ciclo de reversa (F3 — entregue)

O ciclo do §8 roda sem digitação manual:

- **NF-e de compra → inventário**: itens com NCM 8517/8471/8544/8525 viram ativos.
  Séries são extraídas do campo de informações adicionais quando existem; o que
  falta entra como **serial provisório** (derivado da chave + item, estável, de
  forma que reimportar a mesma nota não duplica) para o técnico corrigir em campo.
- **Triagem do retorno** em wizard de 3 passos: diagnóstico → destino → destinador.
  A sugestão de destino compara custo de reparo × valor de reposição, mas quem
  decide e assina o laudo é o técnico. Reposição gera lançamento ativo de carbono;
  descarte espera o CDF do lote.
- **Destinadores** com licença ambiental e validade. Destinar para licença vencida
  é recusado pelo banco, não só pela tela, e o alerta dispara 60 dias antes.
- **Formação de lote** a partir dos descartes, com rateio §8 quando há vínculo consentido.
- **Cinco alertas novos**: retorno sem triagem, reparo fora do prazo, licença
  vencendo, massa em descarte sem lote, lote parado.

### 6.3 Peso rastreável, importação e conectores (entregue)

O peso do lote deixou de ser estimativa cega:

- **Catálogo de produtos** com peso, carbono incorporado e a *procedência* de cada
  número (`pesagem_propria` > `epd_fabricante` > `catalogo_fabricante` > `erp` >
  `planilha` > `estimado`). Só as duas primeiras sustentam número em dossiê.
- **`formar_lote_reversa()`** soma os pesos do catálogo e estima só o que falta,
  gravando a composição em `peso_composicao` — o dossiê consegue dizer "82% da
  massa tem pesagem própria" em vez de apresentar um número redondo sem lastro.
- **Resolução do produto** por GTIN → SKU → NCM+modelo → peso de referência por NCM,
  registrando por qual chave casou.

**Importação de planilhas** (CSV, XLSX, XML) com assistente de de-para:

- CSV parseado internamente (RFC 4180: aspas, aspas escapadas, quebra dentro do
  campo, separador detectado automaticamente); XLSX carrega o SheetJS sob demanda,
  então quem só usa CSV não paga por essa dependência.
- XML tabular genérico: encontra o elemento mais repetido e o trata como linha —
  cobre exportação de ERP sem mapeamento de schema.
- Números em formato BR e US, datas em dd/mm/aaaa e ISO.
- O arquivo original vira documento-fonte com hash: a planilha ganha a mesma
  rastreabilidade de uma NF-e.
- Erro é reportado linha a linha e nunca aborta o lote (§10).

**Conector de ERP/CRM** — Edge Function `ingest`:

- Token gerado no navegador; o servidor guarda apenas o SHA-256. Um vazamento do
  banco não vira acesso de escrita à conta do cliente.
- Escopo por conector: um conector de catálogo não escreve inventário.
- Idempotente por chave natural — reenviar o mesmo lote não duplica.
- Toda chamada vira registro em `importacoes`, com relatório linha a linha.

```
POST https://kyrivjhglgtxwecovtcd.supabase.co/functions/v1/ingest
x-conector-token: mbv_...

{ "alvo": "produtos",
  "registros": [ { "sku": "ONU-100", "modelo": "ONU GPON 1GE",
                   "ncm": "85176259", "peso_kg": 0.42 } ] }
```

Alvos: `produtos`, `pesos_referencia`, `ativos`, `unidades_consumidoras`,
`destinadores`, `portfolio_ncm`.

### 6.4 Funcionalidades que ficaram para as próximas fases

- **Dossiê em PDF nativo** (F4): hoje sai JSON assinável + versão imprimível.
- **OCR de fatura de energia**: a importação é **assistida** — a fatura é
  preservada com hash e o kWh é confirmado pelo usuário. OCR sem conferência não
  sustenta dossiê, então a extração automática entra depois, como sugestão.
- **Distância no CT-e**: o leiaute do CT-e **não traz km percorrido**. A tela pede
  a distância do lote e ela entra na memória de cálculo como *premissa declarada*,
  explicitada no dossiê. Estimativa por código de município é trabalho de F3.
- **Pleitos de ex-tarifário**: o catálogo vem com um **conjunto inicial
  curado** de NCMs de telecom (seed 04, tudo `nao_validado` — o contexto é a
  consolidação dos BIT vigentes na Res. Gecex 781/2025, com II a 0%). A lista
  completa (1.100+ itens) é a planilha oficial do MDIC (gov.br/mdic → SDIC →
  Ex-Tarifário → Estatísticas → vigentes), que o portal só entrega via
  navegador; baixe-a, exporte como CSV e rode
  `python3 tools/carregar_ex_tarifario.py vigentes.csv` — a carga é
  idempotente e filtra os prefixos de NCM do setor.
- **Peso ainda estimado onde o catálogo não cobre**: a estimativa de 0,35 kg/unidade
  só entra para o que não tem produto nem peso de NCM cadastrado, e o lote sai
  marcado como preliminar nesse caso. Cadastrar o catálogo elimina isso.
- **`lucro_no_exercicio`**: não é inferível dos documentos importados. O funil
  trata como *pendente de confirmação*, não como reprovação.
- **Importação de 1.000 CT-e em ≤ 60 s (RNF-004)**: o loop atual é sequencial e
  reporta o tempo na tela. Se o alvo não for atingido no volume real, a saída é
  paralelizar em lotes ou mover a importação para Edge Function.

### 6.5 Antes de qualquer piloto

- [ ] Validação jurídica das teses fiscais (marcar `status_validacao`)
- [ ] Confirmar convênios CONFAZ e adesões estaduais por UF
- [ ] Fatores de emissão oficiais
- [x] `pg_cron` habilitado — alertas diários de condicionantes e exposição à reforma
- [x] Planilha oficial de ex-tarifários carregada (Res. 912, corte de 14/08/2026 — 251 pleitos de telecom; recarregar a cada atualização do MDIC com tools/carregar_ex_tarifario.py)
- [ ] Rodar `supabase db advisors` no projeto real e tratar os apontamentos
