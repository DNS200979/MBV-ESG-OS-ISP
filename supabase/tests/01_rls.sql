-- =====================================================================
-- Teste de isolamento RLS (RNF-001). Roda contra o stub local.
--   Cenário: ISP-A, ISP-B e Distribuidor-D.
--   D só pode enxergar A depois que A consentir — e nunca B.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- --- Atores ----------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','dono.ispa@teste.br'),
  ('22222222-2222-2222-2222-222222222222','dono.ispb@teste.br'),
  ('33333333-3333-3333-3333-333333333333','dono.dist@teste.br');

create or replace function tst_como(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function tst_admin() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- --- Cadastro --------------------------------------------------------
select tst_como('11111111-1111-1111-1111-111111111111');
insert into empresas (cnpj, razao_social, uf, regime, tipo_operacao, perfil_setorial, criado_por)
values ('11222333000181','ISP Alfa Ltda','SC','real','isp','isp','11111111-1111-1111-1111-111111111111');

select tst_como('22222222-2222-2222-2222-222222222222');
insert into empresas (cnpj, razao_social, uf, regime, tipo_operacao, perfil_setorial, criado_por)
values ('44555666000199','ISP Beta Ltda','PR','presumido','isp','isp','22222222-2222-2222-2222-222222222222');

select tst_como('33333333-3333-3333-3333-333333333333');
insert into empresas (cnpj, razao_social, uf, regime, tipo_operacao, perfil_setorial, criado_por)
values ('77888999000155','Dist Gama SA','SC','real','distribuidor','distribuidor_telecom','33333333-3333-3333-3333-333333333333');

-- T1: cada dono enxerga só a sua empresa
select tst_como('11111111-1111-1111-1111-111111111111');
do $$ begin
  assert (select count(*) from empresas) = 1, 'T1 FALHOU: ISP-A deveria ver 1 empresa';
  raise notice 'T1 ok — isolamento base por empresa';
end $$;

-- T2: distribuidor NÃO vê o ISP sem vínculo consentido
select tst_como('33333333-3333-3333-3333-333333333333');
do $$ begin
  assert (select count(*) from empresas) = 1, 'T2 FALHOU: distribuidor viu ISP sem consentimento';
  raise notice 'T2 ok — sem consentimento, sem visibilidade (RNF-001)';
end $$;

-- T3: vínculo não pode nascer consentido
select tst_admin();
select set_config('tst.dist', (select id::text from empresas where cnpj = '77888999000155'), true),
       set_config('tst.isp',  (select id::text from empresas where cnpj = '11222333000181'), true);

select tst_como('33333333-3333-3333-3333-333333333333');
do $$
begin
  begin
    insert into vinculos_comerciais (distribuidor_id, isp_id, consentido)
    values (current_setting('tst.dist')::uuid, current_setting('tst.isp')::uuid, true);
    raise exception 'T3 FALHOU: vínculo nasceu consentido';
  exception
    when insufficient_privilege then raise notice 'T3 ok — vínculo não nasce consentido';
  end;
end $$;

insert into vinculos_comerciais (distribuidor_id, isp_id)
values (current_setting('tst.dist')::uuid, current_setting('tst.isp')::uuid);

-- T4: distribuidor não consegue se autoconceder o consentimento
do $$
begin
  begin
    update vinculos_comerciais set consentido = true
    where isp_id = current_setting('tst.isp')::uuid;
    raise exception 'T4 FALHOU: distribuidor se autoconcedeu acesso';
  exception
    when raise_exception then
      if position('Somente o ISP' in sqlerrm) = 0 then raise; end if;
      raise notice 'T4 ok — só o ISP consente';
  end;
end $$;

-- T5: o ISP consente e aí sim o distribuidor enxerga
select tst_como('11111111-1111-1111-1111-111111111111');
update vinculos_comerciais set consentido = true
where isp_id = current_setting('tst.isp')::uuid;

select tst_como('33333333-3333-3333-3333-333333333333');
do $$ begin
  assert (select count(*) from empresas) = 2, 'T5 FALHOU: distribuidor não enxergou o ISP consentido';
  assert (select count(*) from empresas where cnpj = '44555666000199') = 0,
         'T5 FALHOU: distribuidor vazou o ISP Beta (sem vínculo)';
  raise notice 'T5 ok — visibilidade consentida, e só dela';
end $$;

-- T6: leitura consentida é read-only para o distribuidor
do $$
declare n int;
begin
  update empresas set razao_social = 'HACK' where cnpj = '11222333000181';
  get diagnostics n = row_count;
  assert n = 0, 'T6 FALHOU: distribuidor alterou dados do ISP';
  raise notice 'T6 ok — vínculo consentido concede leitura, não escrita';
end $$;

-- T7: documento-fonte é imutável (RNF-002)
select tst_como('11111111-1111-1111-1111-111111111111');
insert into documentos_fonte (empresa_id, tipo, hash_sha256, criado_por)
values (current_setting('tst.isp')::uuid, 'nfe',
        repeat('a',64), '11111111-1111-1111-1111-111111111111');

-- 7a: via Data API (authenticated) não há policy de UPDATE — 0 linhas, sem efeito
do $$
declare n int;
begin
  update documentos_fonte set tipo = 'cte' where hash_sha256 = repeat('a',64);
  get diagnostics n = row_count;
  assert n = 0, 'T7a FALHOU: RLS permitiu UPDATE em documento-fonte';
  raise notice 'T7a ok — sem policy de UPDATE para authenticated (RNF-002)';
end $$;

-- 7b: mesmo com BYPASSRLS (service_role / rotina interna) o gatilho barra
select tst_admin();
do $$
begin
  begin
    update documentos_fonte set tipo = 'cte' where hash_sha256 = repeat('a',64);
    raise exception 'T7b FALHOU: documento-fonte foi editado com privilégio elevado';
  exception
    when raise_exception then
      if position('imutável' in sqlerrm) = 0 then raise; end if;
      raise notice 'T7b ok — gatilho de imutabilidade barra até service_role (RNF-002)';
  end;
end $$;

select tst_como('11111111-1111-1111-1111-111111111111');

-- T8: incentivo não vira "ativo" sem validação de parceiro (§12.4)
do $$
declare v_inc uuid;
begin
  select id into v_inc from incentivos_catalogo where codigo = 'LEI_DO_BEM';
  begin
    insert into incentivos_empresa (empresa_id, incentivo_id, etapa_funil)
    values (current_setting('tst.isp')::uuid, v_inc, 'ativo');
    raise exception 'T8 FALHOU: incentivo virou ativo sem parceiro';
  exception
    when raise_exception then
      if position('validacao_parceiro' in sqlerrm) = 0 then raise; end if;
      raise notice 'T8 ok — etapa "ativo" exige parceiro licenciado (§12.4)';
  end;
end $$;

-- T10: INSERT ... RETURNING funciona na criação de empresa (regressão:
-- o PostgREST usa RETURNING em `return=representation`, e a policy de
-- SELECT precisa aceitar a linha antes de o gatilho de membro disparar)
select tst_como('22222222-2222-2222-2222-222222222222');
do $$
declare v_id uuid;
begin
  insert into empresas (cnpj, razao_social, uf, regime, tipo_operacao, perfil_setorial, criado_por)
  values ('55666777000122','ISP Gama Returning','SC','real','isp','isp',
          '22222222-2222-2222-2222-222222222222')
  returning id into v_id;
  assert v_id is not null, 'T10 FALHOU: RETURNING não devolveu a linha';
  raise notice 'T10 ok — INSERT ... RETURNING passa na policy de SELECT';
end $$;

-- T9: trilha de auditoria registrou as escritas (RNF-005)
select tst_admin();
do $$
declare n int;
begin
  select count(*) into n from auditoria where tabela = 'vinculos_comerciais';
  assert n >= 2, format('T9 FALHOU: auditoria registrou %s eventos de vínculo', n);
  raise notice 'T9 ok — trilha de auditoria gravando (RNF-005)';
end $$;

rollback;
