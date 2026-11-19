-- ColleagueSplit — 0004: storage buckets and policies
--
-- receipts: PRIVATE. Objects live at `<group_id>/<uuid>` and are readable/writable only by
--           members of that group. The app serves them through short-lived signed URLs.
-- avatars:  public-read (so <img> works), writes restricted to the owner's own folder
--           `<user_id>/<file>`. File names are random, so URLs are unguessable.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts', 'receipts', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('avatars',  'avatars',  true,  1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Safe uuid cast: returns null instead of raising when the folder name isn't a uuid.
create or replace function public.try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create policy "receipts: members read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_group_member(public.try_uuid((storage.foldername(name))[1])));

create policy "receipts: members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_group_member(public.try_uuid((storage.foldername(name))[1])));

create policy "receipts: uploader deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and owner = auth.uid());

create policy "avatars: public read" on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
