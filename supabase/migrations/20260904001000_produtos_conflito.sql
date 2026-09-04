-- =====================================================================
-- 20: índices únicos de produtos compatíveis com ON CONFLICT
--
-- Os índices nasceram parciais (`where sku is not null`) para permitir
-- vários produtos sem SKU. Só que ON CONFLICT não casa com índice
-- parcial a menos que o comando repita o predicado — e nem o PostgREST
-- nem a Edge Function fazem isso. O upsert do conector quebrava com
-- "no unique or exclusion constraint matching the ON CONFLICT".
--
-- Índice único simples resolve sem perder nada: no Postgres, NULLs são
-- distintos entre si por padrão, então continuam cabendo N produtos com
-- SKU nulo — e o upsert por SKU nulo sempre insere, que é o correto.
-- =====================================================================

drop index if exists produtos_sku_idx;
drop index if exists produtos_gtin_idx;

create unique index if not exists produtos_sku_idx  on produtos (empresa_id, sku);
create unique index if not exists produtos_gtin_idx on produtos (empresa_id, gtin);
