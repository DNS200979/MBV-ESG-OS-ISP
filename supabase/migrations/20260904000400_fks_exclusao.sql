-- =====================================================================
-- 14: ação de exclusão nas FKs — remoção de empresa (RNF-007, LGPD)
--
-- 13 chaves estrangeiras estavam em NO ACTION, o que travava a remoção
-- de uma empresa mesmo com todas as policies corretas. A ação foi
-- escolhida pela semântica de cada vínculo, não em bloco:
--
--   SET NULL  → o registro sobrevive porque a contraparte ainda existe
--               (um ativo em comodato pertence a dois lados) ou porque
--               o dado é opcional (evidência, destinador).
--   CASCADE   → o registro perde a razão de existir sem o pai. Vale para
--               lançamento de carbono (§4.1: não há lançamento sem
--               documento-fonte) e para lote de reversa, cujo lastro
--               MTR/CDF é o que o torna prova.
-- =====================================================================

-- ---- referências a empresas: a contraparte pode sobreviver -----------
alter table ativos_equipamento
  drop constraint if exists ativos_equipamento_isp_id_fkey,
  add  constraint ativos_equipamento_isp_id_fkey
       foreign key (isp_id) references empresas(id) on delete set null;

alter table ativos_equipamento
  drop constraint if exists ativos_equipamento_distribuidor_id_fkey,
  add  constraint ativos_equipamento_distribuidor_id_fkey
       foreign key (distribuidor_id) references empresas(id) on delete set null;

alter table lotes_reversa
  drop constraint if exists lotes_reversa_isp_parceiro_id_fkey,
  add  constraint lotes_reversa_isp_parceiro_id_fkey
       foreign key (isp_parceiro_id) references empresas(id) on delete set null;

-- ---- referências a documentos_fonte ---------------------------------
alter table ativos_equipamento
  drop constraint if exists ativos_equipamento_documento_entrada_id_fkey,
  add  constraint ativos_equipamento_documento_entrada_id_fkey
       foreign key (documento_entrada_id) references documentos_fonte(id) on delete set null;

alter table ativos_historico
  drop constraint if exists ativos_historico_documento_id_fkey,
  add  constraint ativos_historico_documento_id_fkey
       foreign key (documento_id) references documentos_fonte(id) on delete set null;

alter table condicionantes_ttd
  drop constraint if exists condicionantes_ttd_evidencia_id_fkey,
  add  constraint condicionantes_ttd_evidencia_id_fkey
       foreign key (evidencia_id) references documentos_fonte(id) on delete set null;

alter table declaracoes_importacao
  drop constraint if exists declaracoes_importacao_documento_fonte_id_fkey,
  add  constraint declaracoes_importacao_documento_fonte_id_fkey
       foreign key (documento_fonte_id) references documentos_fonte(id) on delete set null;

alter table documentos_fonte
  drop constraint if exists documentos_fonte_substitui_id_fkey,
  add  constraint documentos_fonte_substitui_id_fkey
       foreign key (substitui_id) references documentos_fonte(id) on delete set null;

-- §4.1: lançamento sem documento-fonte não existe — some junto.
alter table lancamentos_carbono
  drop constraint if exists lancamentos_carbono_documento_fonte_id_fkey,
  add  constraint lancamentos_carbono_documento_fonte_id_fkey
       foreign key (documento_fonte_id) references documentos_fonte(id) on delete cascade;

-- O lote é prova por causa do MTR/CDF; sem eles a linha viraria um
-- registro sem lastro — e SET NULL violaria lote_destinado_exige_cdf.
alter table lotes_reversa
  drop constraint if exists lotes_reversa_mtr_id_fkey,
  add  constraint lotes_reversa_mtr_id_fkey
       foreign key (mtr_id) references documentos_fonte(id) on delete cascade;

alter table lotes_reversa
  drop constraint if exists lotes_reversa_cdf_id_fkey,
  add  constraint lotes_reversa_cdf_id_fkey
       foreign key (cdf_id) references documentos_fonte(id) on delete cascade;

-- ---- referências a destinadores: vínculo opcional --------------------
alter table lotes_reversa
  drop constraint if exists lotes_reversa_destinador_id_fkey,
  add  constraint lotes_reversa_destinador_id_fkey
       foreign key (destinador_id) references destinadores(id) on delete set null;

alter table triagens
  drop constraint if exists triagens_destinador_id_fkey,
  add  constraint triagens_destinador_id_fkey
       foreign key (destinador_id) references destinadores(id) on delete set null;

-- ---------------------------------------------------------------------
-- Membro inicial: sem usuário no contexto não há vínculo a criar.
-- Sem esta guarda, qualquer criação de empresa por service_role (carga
-- em massa, script administrativo, restore) quebra com violação de
-- NOT NULL em empresa_membros.user_id.
-- ---------------------------------------------------------------------
create or replace function private.fn_membro_inicial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;   -- contexto administrativo: a empresa nasce sem membros
  end if;

  insert into public.empresa_membros (empresa_id, user_id, papel)
  values (new.id, auth.uid(), 'proprietario')
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function private.fn_membro_inicial() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Ativo sem nenhum dos dois lados é registro morto: nenhuma policy o
-- alcança (ambas exigem isp_id ou distribuidor_id acessível), então ele
-- só acumularia lixo invisível. Quando o último lado cai, o ativo sai.
-- ---------------------------------------------------------------------
create or replace function private.fn_ativo_orfao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.isp_id is null and new.distribuidor_id is null then
    delete from public.ativos_equipamento where id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function private.fn_ativo_orfao() from public, anon, authenticated;

drop trigger if exists tg_ativo_orfao on ativos_equipamento;
create trigger tg_ativo_orfao
  after update of isp_id, distribuidor_id on ativos_equipamento
  for each row
  when (new.isp_id is null and new.distribuidor_id is null)
  execute function private.fn_ativo_orfao();
