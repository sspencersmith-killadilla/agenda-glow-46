create policy "agenda-pdfs anyone insert"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'agenda-pdfs');