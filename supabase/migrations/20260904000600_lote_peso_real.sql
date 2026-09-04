-- =====================================================================
-- 16: peso do lote a partir do catálogo, com composição declarada
--
-- Antes: peso = quantidade × 0,35 kg (estimativa cega).
-- Agora: soma dos pesos conhecidos + estimativa só para o que falta, e
-- o lote guarda quantas unidades entraram por cada procedência. É isso
-- que permite ao dossiê dizer "82% da massa tem pesagem própria".
-- =====================================================================

alter table lotes_reversa
  add column if not exists peso_composicao jsonb not null default '{}'::jsonb,
  add column if not exists peso_estimado   boolean not null default true;

comment on column lotes_reversa.peso_composicao is
  'Quantas unidades entraram por procedência de peso e quanta massa cada '
  'uma representa. Alimenta a ressalva do dossiê e o selo do lote.';

create or replace function public.formar_lote_reversa(
  p_empresa_id      uuid,
  p_destinador_id   uuid default null,
  p_isp_parceiro_id uuid default null,
  p_peso_medio_kg   numeric default 0.35,
  p_identificacao   text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lote uuid;
  v_qtd  integer;
  v_peso numeric;
  v_comp jsonb;
  v_sem_peso integer;
  v_dest destinadores%rowtype;
begin
  -- Licença do destinador é pré-condição, não detalhe (§4.1)
  if p_destinador_id is not null then
    select * into v_dest from destinadores where id = p_destinador_id;
    if not found then
      raise exception 'Destinador não encontrado ou fora do seu acesso.';
    end if;
    if v_dest.licenca_validade is not null and v_dest.licenca_validade < current_date then
      raise exception
        'Licença ambiental do destinador % venceu em %. Destinação sem licença vigente não sustenta dossiê.',
        v_dest.razao_social, v_dest.licenca_validade;
    end if;
  end if;

  -- Peso: o que o catálogo souber; estimativa só para o resto.
  with alvo as (
    select a.id,
           coalesce(a.peso_kg, r.peso_kg)                                   as peso,
           coalesce(a.peso_fonte::text, r.peso_fonte::text, 'estimado')     as fonte
      from ativos_equipamento a
      left join lateral resolver_produto(p_empresa_id, null, null, a.ncm, a.modelo) r on true
     where a.isp_id = p_empresa_id
       and a.estado = 'descarte'
       and a.lote_reversa_id is null
  ),
  calc as (
    select coalesce(peso, p_peso_medio_kg)                              as peso_final,
           case when peso is null then 'estimado' else fonte end        as fonte_final
      from alvo
  ),
  agrupado as (
    select fonte_final,
           count(*)                                   as unidades,
           round(sum(peso_final)::numeric, 3)         as massa_kg
      from calc
     group by fonte_final
  )
  select (select count(*)                              from calc),
         (select round(sum(peso_final)::numeric, 3)    from calc),
         (select count(*) from calc where fonte_final = 'estimado'),
         (select jsonb_object_agg(fonte_final,
                   jsonb_build_object('unidades', unidades, 'massa_kg', massa_kg))
            from agrupado)
    into v_qtd, v_peso, v_sem_peso, v_comp;

  if v_qtd = 0 or v_qtd is null then
    raise exception 'Nenhum equipamento em descarte aguardando lote.';
  end if;

  insert into lotes_reversa
    (empresa_id, isp_parceiro_id, identificacao, peso_kg, qtd_equipamentos,
     destinador_id, destinador_cnpj, destinador_nome, status, coletado_em,
     rateio_isp_pct, peso_composicao, peso_estimado)
  values
    (p_empresa_id, p_isp_parceiro_id,
     coalesce(p_identificacao, 'LOTE-' || to_char(now(), 'YYYYMMDD-HH24MI')),
     v_peso, v_qtd,
     p_destinador_id, v_dest.cnpj, v_dest.razao_social,
     'coleta', current_date,
     case when p_isp_parceiro_id is null then 0 else 50 end,
     coalesce(v_comp, '{}'::jsonb), v_sem_peso > 0)
  returning id into v_lote;

  update ativos_equipamento
     set lote_reversa_id = v_lote
   where isp_id = p_empresa_id
     and estado = 'descarte'
     and lote_reversa_id is null;

  return v_lote;
end;
$$;
