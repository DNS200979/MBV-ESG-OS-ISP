-- =====================================================================
-- 09: idempotência do catálogo de ex-tarifários
-- Permite recargas da planilha oficial do MDIC sem duplicar pleitos.
-- =====================================================================
create unique index if not exists extarif_unico_idx
  on ex_tarifario_pleitos (ncm, descricao);
