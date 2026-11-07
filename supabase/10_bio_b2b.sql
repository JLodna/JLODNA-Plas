-- JLODNA Plas — module BIO (profils numériques) + B2B (commerce professionnel) + droits des utilisateurs.
-- ADDITIF et idempotent : aucune table existante n'est modifiée ni supprimée.
-- À exécuter APRÈS schema → functions → triggers → policies → seed. Peut être relancé sans danger.

-- ========== 0) Permissions du personnel (rôles existants) ==========
insert into public.admin_permissions(role, permission) values
 ('ADMIN','b2b.manage'),('MANAGER','b2b.manage'),('SUPPORT','b2b.manage'),
 ('ADMIN','bio.moderate'),('MANAGER','bio.moderate'),('SUPPORT','bio.moderate')
on conflict do nothing;

-- ========== 1) Super administrateur ==========
-- Le premier compte CONFIRMÉ avec cet email devient SUPER_ADMIN (trigger grant_bootstrap_admin).
-- Seul un SUPER_ADMIN peut modifier cette clé (voir policies.sql).
insert into public.settings(key, value) values ('bootstrap_admin_email', '"jlodnaplas@gmail.com"')
on conflict (key) do update set value = excluded.value;
-- Si ce compte existe déjà et est confirmé, il reçoit le rôle maintenant (les autres rôles existants ne sont pas supprimés).
insert into public.admin_roles(user_id, role)
select id, 'SUPER_ADMIN' from auth.users where lower(email) = 'jlodnaplas@gmail.com' and email_confirmed_at is not null
on conflict (user_id) do update set role = 'SUPER_ADMIN';

-- ========== 2) BIO — profils numériques ==========
create table if not exists public.bio_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'
    and slug not in ('admin','edit','u','api','new','official','jlodna','jlodni','b2b','bio','login','register','account','shop','cart')),
  display_name text not null check (char_length(display_name) between 2 and 80),
  headline text check (headline is null or char_length(headline) <= 120),
  about text check (about is null or char_length(about) <= 1000),
  avatar_path text,
  video_path text,
  links jsonb not null default '[]'::jsonb,
  is_public boolean not null default false,   -- privé par défaut : l'utilisateur décide de publier
  is_blocked boolean not null default false,  -- modération
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.bio_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare l jsonb; v_blk boolean := new.is_blocked;
begin
  if tg_op = 'UPDATE' and auth.uid() is distinct from old.user_id then
    -- Modération : un modérateur ne peut changer QUE le blocage (jamais le contenu de l'utilisateur).
    new := old;
    if public.has_perm('bio.moderate') then
      new.is_blocked := v_blk;
      if v_blk then new.is_public := false; end if;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then new.is_blocked := false; else new.is_blocked := old.is_blocked; new.user_id := old.user_id; end if;
  if new.is_blocked then new.is_public := false; end if;
  if jsonb_typeof(new.links) is distinct from 'array' or jsonb_array_length(new.links) > 12 then raise exception 'BIO_LINKS_INVALID'; end if;
  for l in select value from jsonb_array_elements(new.links) loop
    if jsonb_typeof(l) <> 'object' or coalesce(l->>'label','') = '' or char_length(l->>'label') > 40
       or coalesce(l->>'url','') !~ '^https://[^\s<>"'']+$' or char_length(l->>'url') not between 12 and 500 then
      raise exception 'BIO_LINKS_INVALID';
    end if;
  end loop;
  -- Un fichier média doit se trouver dans le dossier de son propriétaire (jamais celui d'un autre).
  if new.avatar_path is not null and new.avatar_path !~ ('^' || new.user_id::text || '/[A-Za-z0-9._-]+$') then raise exception 'BIO_MEDIA_INVALID'; end if;
  if new.video_path  is not null and new.video_path  !~ ('^' || new.user_id::text || '/[A-Za-z0-9._-]+$') then raise exception 'BIO_MEDIA_INVALID'; end if;
  return new;
end $$;
drop trigger if exists trg_bio_guard on public.bio_profiles;
create trigger trg_bio_guard before insert or update on public.bio_profiles for each row execute function public.bio_guard();
drop trigger if exists trg_bio_touch on public.bio_profiles;
create trigger trg_bio_touch before update on public.bio_profiles for each row execute function public.touch_updated_at();

alter table public.bio_profiles enable row level security;
alter table public.bio_profiles force row level security;
drop policy if exists bio_select on public.bio_profiles;
drop policy if exists bio_insert on public.bio_profiles;
drop policy if exists bio_update on public.bio_profiles;
drop policy if exists bio_delete on public.bio_profiles;
-- Aucune lecture publique de la table : le public passe UNIQUEMENT par get_public_bio() (aucun identifiant interne exposé, aucun annuaire).
create policy bio_select on public.bio_profiles for select to authenticated using (user_id = auth.uid() or public.has_perm('bio.moderate'));
create policy bio_insert on public.bio_profiles for insert to authenticated with check (user_id = auth.uid());
create policy bio_update on public.bio_profiles for update to authenticated using (user_id = auth.uid() or public.has_perm('bio.moderate')) with check (user_id = auth.uid() or public.has_perm('bio.moderate'));
create policy bio_delete on public.bio_profiles for delete to authenticated using (user_id = auth.uid() or public.has_perm('bio.moderate'));

revoke all on public.bio_profiles from anon, authenticated;
grant select, delete on public.bio_profiles to authenticated;
grant insert (user_id, slug, display_name, headline, about, avatar_path, video_path, links, is_public) on public.bio_profiles to authenticated;
grant update (slug, display_name, headline, about, avatar_path, video_path, links, is_public, is_blocked) on public.bio_profiles to authenticated;

create or replace function public.get_public_bio(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', slug, 'display_name', display_name, 'headline', headline, 'about', about,
                            'avatar_path', avatar_path, 'video_path', video_path, 'links', links)
  from public.bio_profiles where slug = lower(p_slug) and is_public and not is_blocked
$$;
revoke all on function public.get_public_bio(text) from public;
grant execute on function public.get_public_bio(text) to anon, authenticated;

-- ========== 3) B2B — demandes professionnelles ==========
create table if not exists public.b2b_requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('B2B-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (char_length(full_name) between 2 and 120),
  company text check (company is null or char_length(company) <= 160),
  phone text not null check (char_length(phone) between 6 and 30),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  country text not null check (char_length(country) between 2 and 80),
  request_type text not null check (request_type in ('wholesale','special_order','quote','supply','other')),
  product text not null check (char_length(product) between 2 and 300),
  quantity int not null check (quantity > 0 and quantity <= 10000000),
  budget text check (budget is null or char_length(budget) <= 60),
  description text not null check (char_length(description) between 5 and 4000),
  attachment_path text,
  status text not null default 'new' check (status in ('new','analysis','quote_sent','awaiting_confirmation','confirmed','completed','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists b2b_requests_user_idx on public.b2b_requests(user_id, created_at desc);
create index if not exists b2b_requests_status_idx on public.b2b_requests(status, created_at desc);
drop trigger if exists trg_b2b_touch on public.b2b_requests;
create trigger trg_b2b_touch before update on public.b2b_requests for each row execute function public.touch_updated_at();

create table if not exists public.b2b_messages (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.b2b_requests(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  is_staff boolean not null default false,
  kind text not null default 'message' check (kind in ('message','status')),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists b2b_messages_req_idx on public.b2b_messages(request_id, created_at);

alter table public.b2b_requests enable row level security; alter table public.b2b_requests force row level security;
alter table public.b2b_messages enable row level security; alter table public.b2b_messages force row level security;
drop policy if exists b2b_requests_select on public.b2b_requests;
drop policy if exists b2b_messages_select on public.b2b_messages;
-- Écritures UNIQUEMENT par les fonctions ci-dessous (validation, anti-abus, historique) ; lecture : le propriétaire ou le personnel B2B.
create policy b2b_requests_select on public.b2b_requests for select to authenticated using (user_id = auth.uid() or public.has_perm('b2b.manage'));
create policy b2b_messages_select on public.b2b_messages for select to authenticated
  using (public.has_perm('b2b.manage') or exists (select 1 from public.b2b_requests r where r.id = request_id and r.user_id = auth.uid()));
revoke all on public.b2b_requests, public.b2b_messages from anon, authenticated;
grant select on public.b2b_requests, public.b2b_messages to authenticated;

create or replace function public.submit_b2b_request(
  p_full_name text, p_company text, p_phone text, p_email text, p_country text, p_type text,
  p_product text, p_quantity int, p_budget text, p_description text, p_attachment text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ref text;
begin
  -- Connexion OBLIGATOIRE : chaque demande est rattachée à un compte (suivi, échanges, anti-abus, droit d'accès/suppression).
  if v_uid is null then raise exception 'LOGIN_REQUIRED'; end if;
  if p_attachment is not null and p_attachment !~ ('^' || v_uid::text || '/[A-Za-z0-9._-]+$') then raise exception 'INVALID_ATTACHMENT'; end if;
  -- Anti-abus : 5 demandes / heure par compte ou par email.
  if (select count(*) from public.b2b_requests where created_at > now() - interval '1 hour'
        and (user_id = v_uid or lower(email) = lower(trim(p_email)))) >= 5 then raise exception 'RATE_LIMITED'; end if;
  insert into public.b2b_requests(user_id, full_name, company, phone, email, country, request_type, product, quantity, budget, description, attachment_path)
  values (v_uid, trim(p_full_name), nullif(trim(coalesce(p_company,'')), ''), trim(p_phone), trim(p_email), trim(p_country), p_type, trim(p_product), p_quantity,
          nullif(trim(coalesce(p_budget,'')), ''), trim(p_description), p_attachment)
  returning ref into v_ref;
  perform public.notify_admins('b2b_request', 'Nouvelle demande B2B', v_ref || ' — ' || left(trim(p_product), 80), '/admin/#b2b');
  return v_ref;
end $$;
revoke all on function public.submit_b2b_request(text,text,text,text,text,text,text,int,text,text,text) from public, anon;
grant execute on function public.submit_b2b_request(text,text,text,text,text,text,text,int,text,text,text) to authenticated;

create or replace function public.post_b2b_message(p_request_id uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_req public.b2b_requests; v_staff boolean := public.has_perm('b2b.manage'); v_id bigint;
begin
  if v_uid is null then raise exception 'FORBIDDEN'; end if;
  select * into v_req from public.b2b_requests where id = p_request_id;
  if not found or (not v_staff and v_req.user_id is distinct from v_uid) then raise exception 'FORBIDDEN'; end if;
  if not v_staff and (select count(*) from public.b2b_messages where request_id = p_request_id and author_id = v_uid and created_at > now() - interval '1 hour') >= 20 then raise exception 'RATE_LIMITED'; end if;
  insert into public.b2b_messages(request_id, author_id, is_staff, kind, body) values (p_request_id, v_uid, v_staff, 'message', trim(p_body)) returning id into v_id;
  update public.b2b_requests set updated_at = now() where id = p_request_id;
  if v_staff and v_req.user_id is not null then
    insert into public.notifications(user_id, audience, type, title, body, link)
    values (v_req.user_id, 'customer', 'b2b_reply', 'Réponse à votre demande ' || v_req.ref, null, '/b2b#mes-demandes');
  elsif not v_staff then
    perform public.notify_admins('b2b_message', 'Nouveau message B2B', v_req.ref, '/admin/#b2b');
  end if;
  return v_id;
end $$;
revoke all on function public.post_b2b_message(uuid, text) from public, anon;
grant execute on function public.post_b2b_message(uuid, text) to authenticated;

create or replace function public.admin_set_b2b_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare v_req public.b2b_requests;
begin
  if not public.has_perm('b2b.manage') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('new','analysis','quote_sent','awaiting_confirmation','confirmed','completed','rejected') then raise exception 'INVALID_STATUS'; end if;
  select * into v_req from public.b2b_requests where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_req.status = p_status then return; end if;
  update public.b2b_requests set status = p_status where id = p_id;
  insert into public.b2b_messages(request_id, author_id, is_staff, kind, body) values (p_id, auth.uid(), true, 'status', p_status);
  insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), 'set_b2b_status', 'b2b_requests', p_id::text,
          jsonb_build_object('name', v_req.ref, 'before_status', v_req.status, 'after_status', p_status));
  if v_req.user_id is not null then
    insert into public.notifications(user_id, audience, type, title, body, link)
    values (v_req.user_id, 'customer', 'b2b_status', 'Mise à jour de votre demande ' || v_req.ref, null, '/b2b#mes-demandes');
  end if;
end $$;
revoke all on function public.admin_set_b2b_status(uuid, text) from public, anon;
grant execute on function public.admin_set_b2b_status(uuid, text) to authenticated;

-- ========== 4) Droits des utilisateurs sur leurs données ==========
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', email) from auth.users where id = u),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = u),
    'addresses', coalesce((select jsonb_agg(to_jsonb(a)) from public.addresses a where a.user_id = u), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(i)) from public.order_items i where i.order_id = o.id), '[]'::jsonb)))
                        from public.orders o where o.user_id = u), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r)) from public.reviews r where r.user_id = u), '[]'::jsonb),
    'b2b_requests', coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object('messages', coalesce((select jsonb_agg(to_jsonb(m) - 'author_id' order by m.created_at) from public.b2b_messages m where m.request_id = b.id), '[]'::jsonb)))
                              from public.b2b_requests b where b.user_id = u), '[]'::jsonb),
    'bio', (select to_jsonb(x) from public.bio_profiles x where x.user_id = u)
  );
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

create or replace function public.request_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  select email into v_email from auth.users where id = auth.uid();
  perform public.notify_admins('deletion_request', 'Demande de suppression de compte', coalesce(v_email, ''), '/admin/#customers');
end $$;
revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

-- ========== 5) Storage ==========
-- bio-media : PUBLIC en lecture par URL (nécessaire pour afficher les profils publiés) ; noms de fichiers aléatoires ; aucune liste publique.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bio-media', 'bio-media', true, 26214400, array['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
on conflict (id) do update set public = true, file_size_limit = 26214400, allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/webm'];
-- b2b-files : PRIVÉ ; pièces jointes visibles uniquement par leur auteur et le personnel B2B (liens signés temporaires).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('b2b-files', 'b2b-files', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists "bio_media_select" on storage.objects;
drop policy if exists "bio_media_insert" on storage.objects;
drop policy if exists "bio_media_update" on storage.objects;
drop policy if exists "bio_media_delete" on storage.objects;
drop policy if exists "b2b_files_select" on storage.objects;
drop policy if exists "b2b_files_insert" on storage.objects;
drop policy if exists "b2b_files_delete" on storage.objects;
create policy "bio_media_select" on storage.objects for select to authenticated using (bucket_id = 'bio-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('bio.moderate')));
create policy "bio_media_insert" on storage.objects for insert to authenticated with check (bucket_id = 'bio-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "bio_media_update" on storage.objects for update to authenticated using (bucket_id = 'bio-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "bio_media_delete" on storage.objects for delete to authenticated using (bucket_id = 'bio-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('bio.moderate')));
create policy "b2b_files_select" on storage.objects for select to authenticated using (bucket_id = 'b2b-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.has_perm('b2b.manage')));
create policy "b2b_files_insert" on storage.objects for insert to authenticated with check (bucket_id = 'b2b-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "b2b_files_delete" on storage.objects for delete to authenticated using (bucket_id = 'b2b-files' and (storage.foldername(name))[1] = auth.uid()::text);
