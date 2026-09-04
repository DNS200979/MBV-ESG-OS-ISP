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

-- T11: geração de alertas (pg_cron chama private.fn_gerar_alertas)
select tst_admin();
insert into condicionantes_ttd (empresa_id, enquadramento, descricao, periodicidade, proximo_prazo)
values (current_setting('tst.isp')::uuid, 'TTD 409', 'Recolhimento ao fundo estadual',
        'mensal', current_date - 1);

do $$
declare v_status text; v_alertas int;
begin
  perform private.fn_gerar_alertas();

  select status into v_status from condicionantes_ttd
   where empresa_id = current_setting('tst.isp')::uuid;
  assert v_status = 'atrasada', format('T11 FALHOU: status = %s', v_status);

  select count(*) into v_alertas from alertas
   where empresa_id = current_setting('tst.isp')::uuid and severidade = 'critico';
  assert v_alertas = 1, format('T11 FALHOU: %s alertas críticos', v_alertas);

  -- idempotência: rodar de novo não duplica
  perform private.fn_gerar_alertas();
  select count(*) into v_alertas from alertas
   where empresa_id = current_setting('tst.isp')::uuid;
  assert v_alertas = 1, 'T11 FALHOU: alerta duplicado na segunda execução';
  raise notice 'T11 ok — condicionante vencida vira atrasada e gera alerta único';
end $$;

-- T12: alerta respeita RLS (ISP-B não vê alerta do ISP-A)
select tst_como('22222222-2222-2222-2222-222222222222');
do $$ begin
  assert (select count(*) from alertas) = 0, 'T12 FALHOU: alerta vazou entre empresas';
  raise notice 'T12 ok — alertas isolados por empresa';
end $$;

-- =====================================================================
-- Ciclo de logística reversa (migrações 11 e 12)
-- =====================================================================
select tst_como('11111111-1111-1111-1111-111111111111');

-- T13: destinador com licença vencida bloqueia a formação de lote
do $$
declare v_dest uuid; v_ativo uuid;
begin
  insert into destinadores (empresa_id, cnpj, razao_social, tipo, licenca_ambiental, licenca_validade)
  values (current_setting('tst.isp')::uuid, '12345678000199', 'Recicla Vencida ME',
          'reciclador', 'LO-001/2020', current_date - 30)
  returning id into v_dest;

  insert into ativos_equipamento (serial, modelo, isp_id, estado)
  values ('SN-TESTE-0001', 'ONU GPON', current_setting('tst.isp')::uuid, 'descarte')
  returning id into v_ativo;

  begin
    perform formar_lote_reversa(current_setting('tst.isp')::uuid, v_dest);
    raise exception 'T13 FALHOU: lote formado com licença vencida';
  exception
    when raise_exception then
      if position('Licença ambiental' in sqlerrm) = 0 then raise; end if;
      raise notice 'T13 ok — licença vencida impede formar lote';
  end;

  perform set_config('tst.dest', v_dest::text, true);
end $$;

-- T14: com licença vigente, o lote se forma e captura os ativos em descarte
do $$
declare v_dest uuid; v_lote uuid; v_qtd int; v_peso numeric;
begin
  insert into destinadores (empresa_id, cnpj, razao_social, tipo, licenca_ambiental, licenca_validade)
  values (current_setting('tst.isp')::uuid, '98765432000111', 'Recicla Vigente SA',
          'reciclador', 'LO-777/2026', current_date + 365)
  returning id into v_dest;

  insert into ativos_equipamento (serial, modelo, isp_id, estado)
  values ('SN-TESTE-0002', 'ONU GPON', current_setting('tst.isp')::uuid, 'descarte');

  v_lote := formar_lote_reversa(current_setting('tst.isp')::uuid, v_dest, null, 0.35);

  select qtd_equipamentos, peso_kg into v_qtd, v_peso from lotes_reversa where id = v_lote;
  assert v_qtd = 2, format('T14 FALHOU: lote com %s equipamentos', v_qtd);
  assert v_peso = 0.70, format('T14 FALHOU: peso %s', v_peso);
  assert (select count(*) from ativos_equipamento
           where lote_reversa_id = v_lote) = 2, 'T14 FALHOU: ativos não vinculados ao lote';
  raise notice 'T14 ok — lote formado, peso calculado e ativos vinculados';
end $$;

-- T15: formar lote sem nada em descarte é recusado
do $$
begin
  begin
    perform formar_lote_reversa(current_setting('tst.isp')::uuid);
    raise exception 'T15 FALHOU: formou lote vazio';
  exception
    when raise_exception then
      if position('Nenhum equipamento' in sqlerrm) = 0 then raise; end if;
      raise notice 'T15 ok — lote vazio recusado';
  end;
end $$;

-- T16: triagem é imutável (laudo não se reescreve)
do $$
declare v_ativo uuid;
begin
  insert into ativos_equipamento (serial, modelo, isp_id, estado)
  values ('SN-TESTE-0003', 'Roteador AC', current_setting('tst.isp')::uuid, 'retorno')
  returning id into v_ativo;

  insert into triagens (ativo_id, empresa_id, destino, motivo, laudo)
  values (v_ativo, current_setting('tst.isp')::uuid, 'reparo', 'defeito_reparavel', 'Fonte queimada');

  -- Sem GRANT UPDATE, o banco recusa com erro explícito — melhor que
  -- devolver "0 linhas" e deixar o usuário achar que salvou.
  begin
    update triagens set laudo = 'ALTERADO' where ativo_id = v_ativo;
    raise exception 'T16 FALHOU: triagem foi editada';
  exception
    when insufficient_privilege then
      raise notice 'T16 ok — triagem imutável (UPDATE recusado pelo banco)';
  end;
end $$;

-- T17: alertas da reversa detectam retorno parado e licença vencida
-- (o gatilho tg_ativos_touch reescreve atualizado_em em todo UPDATE — que é o
--  comportamento certo, pois o alerta mede tempo desde a última mudança de
--  estado. Por isso o cenário nasce com a data antiga já no INSERT.)
select tst_admin();
insert into ativos_equipamento (serial, modelo, isp_id, estado, atualizado_em)
values ('SN-TESTE-0004', 'ONU parada', current_setting('tst.isp')::uuid, 'retorno',
        now() - interval '40 days');

do $$
declare v_retorno int; v_licenca int;
begin
  perform private.fn_gerar_alertas_reversa();

  select count(*) into v_retorno from alertas
   where tipo = 'retorno_sem_triagem' and empresa_id = current_setting('tst.isp')::uuid;
  select count(*) into v_licenca from alertas
   where tipo = 'licenca_vencendo' and severidade = 'critico'
     and empresa_id = current_setting('tst.isp')::uuid;

  assert v_retorno = 1, format('T17 FALHOU: %s alertas de retorno parado', v_retorno);
  assert v_licenca = 1, format('T17 FALHOU: %s alertas de licença vencida', v_licenca);

  perform private.fn_gerar_alertas_reversa();
  select count(*) into v_retorno from alertas
   where tipo = 'retorno_sem_triagem' and empresa_id = current_setting('tst.isp')::uuid;
  assert v_retorno = 1, 'T17 FALHOU: alerta de reversa duplicado';
  raise notice 'T17 ok — alertas de reversa disparam e não duplicam';
end $$;

-- T18: destinador de outra empresa não vaza
select tst_como('22222222-2222-2222-2222-222222222222');
do $$ begin
  assert (select count(*) from destinadores) = 0, 'T18 FALHOU: destinador vazou entre empresas';
  assert (select count(*) from triagens) = 0, 'T18 FALHOU: triagem vazou entre empresas';
  raise notice 'T18 ok — destinadores e triagens isolados por empresa';
end $$;

-- T19: remoção completa de empresa (RNF-007 portabilidade / LGPD).
-- Regressão de dois bugs reais: o gatilho de imutabilidade bloqueava o
-- DELETE em cascata, e 13 FKs estavam em NO ACTION.
select tst_admin();
do $$
declare v_isp uuid; v_docs int; v_ativos int;
begin
  v_isp := current_setting('tst.isp')::uuid;

  select count(*) into v_docs   from documentos_fonte    where empresa_id = v_isp;
  select count(*) into v_ativos from ativos_equipamento  where isp_id     = v_isp;
  assert v_docs > 0 and v_ativos > 0, 'T19: cenário sem dados para exercitar a cascata';

  delete from empresas where id = v_isp;

  assert (select count(*) from empresas where id = v_isp) = 0,
         'T19 FALHOU: empresa não foi removida';
  assert (select count(*) from documentos_fonte where empresa_id = v_isp) = 0,
         'T19 FALHOU: documentos-fonte sobreviveram à remoção da empresa';
  assert (select count(*) from ativos_equipamento where isp_id = v_isp) = 0,
         'T19 FALHOU: isp_id não foi anulado nos ativos';
  raise notice 'T19 ok — empresa removida em cascata (portabilidade/LGPD)';
end $$;

-- T20: fora da cascata, o documento-fonte segue indestrutível
select tst_admin();
do $$
declare v_emp uuid; v_doc uuid;
begin
  insert into empresas (cnpj, razao_social, uf, regime, tipo_operacao, perfil_setorial)
  values ('99888777000166','ISP Delta','SC','real','isp','isp') returning id into v_emp;
  insert into documentos_fonte (empresa_id, tipo, hash_sha256)
  values (v_emp, 'cte', repeat('b',64)) returning id into v_doc;

  begin
    delete from documentos_fonte where id = v_doc;
    raise exception 'T20 FALHOU: documento-fonte avulso foi excluído';
  exception
    when raise_exception then
      if position('não pode ser excluído' in sqlerrm) = 0 then raise; end if;
      raise notice 'T20 ok — exclusão avulsa de prova segue bloqueada (RNF-002)';
  end;
end $$;

-- T21: peso do lote vem do catálogo, com composição por procedência
select tst_como('11111111-1111-1111-1111-111111111111');
do $$
declare v_emp uuid; v_lote uuid; v_peso numeric; v_comp jsonb; v_prelim boolean;
begin
  insert into empresas (cnpj, razao_social, uf, regime, tipo_operacao, perfil_setorial, criado_por)
  values ('77000770000177','ISP Catálogo','SC','real','isp','isp',
          '11111111-1111-1111-1111-111111111111')
  returning id into v_emp;

  insert into produtos (empresa_id, modelo, ncm, peso_kg, peso_fonte)
  values (v_emp, 'ONU GPON X1', '85176259', 0.42, 'pesagem_propria');
  insert into pesos_referencia (empresa_id, ncm, peso_kg, fonte)
  values (v_emp, '85176249', 3.8, 'catalogo_fabricante');

  insert into ativos_equipamento (serial, modelo, ncm, isp_id, estado) values
    ('CAT-1','ONU GPON X1','85176259', v_emp,'descarte'),
    ('CAT-2','ONU GPON X1','85176259', v_emp,'descarte'),
    ('CAT-3','OLT 8P','85176249',      v_emp,'descarte'),
    ('CAT-4','Sem catálogo','99999999',v_emp,'descarte');

  v_lote := formar_lote_reversa(v_emp, null, null, 0.35);
  select peso_kg, peso_composicao, peso_estimado
    into v_peso, v_comp, v_prelim
    from lotes_reversa where id = v_lote;

  -- 0,42×2 (pesagem própria) + 3,8 (catálogo) + 0,35 (estimado) = 4,99
  assert v_peso = 4.99, format('T21 FALHOU: peso %s (esperado 4.99)', v_peso);
  assert (v_comp->'pesagem_propria'->>'unidades')::int = 2,
         'T21 FALHOU: composição não separou a pesagem própria';
  assert (v_comp->'estimado'->>'unidades')::int = 1,
         'T21 FALHOU: composição não isolou o item estimado';
  assert v_prelim, 'T21 FALHOU: lote com item estimado deveria sair preliminar';
  raise notice 'T21 ok — peso somado do catálogo; estimativa isolada e lote marcado preliminar';
end $$;

rollback;
