-- =====================================================================
-- 07: Storage dos documentos-fonte originais
-- Bucket PRIVADO. O acesso é por URL assinada de curta duração; o
-- caminho é sempre <empresa_id>/<tipo>/<hash>-<nome>, e a policy usa o
-- primeiro segmento do caminho como chave de tenant.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos-fonte', 'documentos-fonte', false, 26214400)  -- 25 MB
on conflict (id) do nothing;

-- Um membro da empresa lê os arquivos daquela empresa
create policy "docfonte_storage_sel"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documentos-fonte'
    and (select private.pode_ver((storage.foldername(name))[1]::uuid))
  );

-- Quem edita, envia
create policy "docfonte_storage_ins"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documentos-fonte'
    and (select private.pode_editar((storage.foldername(name))[1]::uuid))
  );

-- Sem UPDATE e sem DELETE: o arquivo é prova (RNF-002).
-- A remoção, se algum dia necessária, é operação administrativa via
-- service_role e fica registrada fora da aplicação.
