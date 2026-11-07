-- JLODNA Plas — sécurité renforcée + application mobile : limitation de requêtes, signalements, notifications push,
-- suppression de compte complète, 2FA obligatoire pour l'administration (option). ADDITIF et idempotent.
-- À exécuter APRÈS les modules 10, 20, 30 et 40.

insert into public.admin_permissions(role, permission) values ('ADMIN','reports.manage'),('MANAGER','reports.manage'),('SUPPORT','reports.manage') on conflict do nothing;

-- ========== 1) Limitation de requêtes (côté base : fonctionne même avec plusieurs instances serveur) ==========
create table if not exists public.rate_limits (key text primary key, window_start timestamptz not null, hits int not null);
alter table public.rate_limits enable row level security; alter table public.rate_limits force row level security;
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare r public.rate_limits;
begin
  if p_key is null or char_length(p_key) > 200 or p_limit < 1 or p_window_seconds < 1 then raise exception 'INVALID'; end if;
  insert into public.rate_limits(key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then 1 else public.rate_limits.hits + 1 end,
    window_start = case when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then now() else public.rate_limits.window_start end
  returning * into r;
  if random() < 0.01 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
  return r.hits <= p_limit;
end $$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- Messages de contact : plus d'insertion directe (anciennes installations)
drop policy if exists messages_insert on public.messages;
revoke insert on public.messages from anon, authenticated;

-- ========== 2) Signalements (exigés par Google Play pour les contenus d'utilisateurs) ==========
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('bio','product')),
  target_id text not null check (char_length(target_id) <= 100),
  target_label text,
  reason text not null check (reason in ('inappropriate','illegal','spam','fake','other')),
  details text check (details is null or char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','reviewed','dismissed','actioned')),
  reviewed_by uuid, created_at timestamptz not null default now()
);
create unique index if not exists reports_one_open_per_user on public.reports(reporter_id, target_type, target_id) where status = 'open';
alter table public.reports enable row level security; alter table public.reports force row level security;
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated using (public.has_perm('reports.manage'));
revoke all on public.reports from anon, authenticated; grant select on public.reports to authenticated;

create or replace function public.submit_report(p_type text, p_target text, p_reason text, p_details text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_label text; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED'; end if;
  if p_type = 'bio' then
    select display_name into v_label from public.bio_profiles where slug = lower(p_target) and is_public and not is_blocked;
  elsif p_type = 'product' then
    select name into v_label from public.products where id::text = p_target and status = 'published';
  else raise exception 'INVALID_TARGET'; end if;
  if v_label is null then raise exception 'NOT_FOUND'; end if;
  if (select count(*) from public.reports where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 10 then raise exception 'RATE_LIMITED'; end if;
  if exists (select 1 from public.reports where reporter_id = v_uid and target_type = p_type and target_id = lower(p_target) and status = 'open') then return; end if;
  insert into public.reports(reporter_id, target_type, target_id, target_label, reason, details)
  values (v_uid, p_type, case when p_type = 'bio' then lower(p_target) else p_target end, left(v_label, 120), p_reason, nullif(left(trim(coalesce(p_details, '')), 1000), ''));
  perform public.notify_admins('report', 'Nouveau signalement', left(v_label, 80), '/admin/#reports');
end $$;
revoke all on function public.submit_report(text, text, text, text) from public, anon;
grant execute on function public.submit_report(text, text, text, text) to authenticated;

create or replace function public.admin_set_report_status(p_id uuid, p_status text, p_apply boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reports;
begin
  if not public.has_perm('reports.manage') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('open','reviewed','dismissed','actioned') then raise exception 'INVALID_STATUS'; end if;
  select * into r from public.reports where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_apply and p_status = 'actioned' then   -- mesure appliquée : bloque le BIO ou retire le produit de la vente (permissions du module requises)
    if r.target_type = 'bio' then
      if not public.has_perm('bio.moderate') then raise exception 'FORBIDDEN'; end if;
      update public.bio_profiles set is_blocked = true, is_public = false where slug = r.target_id;
    else
      if not public.has_perm('products.write') then raise exception 'FORBIDDEN'; end if;
      update public.products set status = 'disabled' where id::text = r.target_id and status = 'published';
    end if;
  end if;
  update public.reports set status = p_status, reviewed_by = auth.uid() where id = p_id;
  insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), 'set_report_status', 'reports', p_id::text,
          jsonb_build_object('name', r.target_type || ':' || r.target_id, 'after_status', p_status, 'applied', p_apply));
end $$;
revoke all on function public.admin_set_report_status(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_report_status(uuid, text, boolean) to authenticated;

-- ========== 3) Notifications push : jetons d'appareils ==========
create table if not exists public.device_tokens (
  token text primary key check (char_length(token) between 20 and 4096),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'android' check (platform in ('android','ios')),
  created_at timestamptz not null default now(), last_seen timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on public.device_tokens(user_id);
alter table public.device_tokens enable row level security; alter table public.device_tokens force row level security;
revoke all on public.device_tokens from anon, authenticated;

create or replace function public.register_device_token(p_token text, p_platform text default 'android') returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED'; end if;
  if p_platform not in ('android','ios') then raise exception 'INVALID_PLATFORM'; end if;
  -- Le jeton appartient à l'appareil : s'il change de compte (téléphone partagé), il suit le compte connecté.
  insert into public.device_tokens(token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = auth.uid(), platform = excluded.platform, last_seen = now();
  delete from public.device_tokens where user_id = auth.uid() and token not in
    (select token from public.device_tokens where user_id = auth.uid() order by last_seen desc limit 10);
end $$;
revoke all on function public.register_device_token(text, text) from public, anon;
grant execute on function public.register_device_token(text, text) to authenticated;

create or replace function public.unregister_device_token(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.device_tokens where token = p_token and user_id = auth.uid()
$$;
revoke all on function public.unregister_device_token(text) from public, anon;
grant execute on function public.unregister_device_token(text) to authenticated;

-- ========== 4) Suppression de compte COMPLÈTE (service_role) ==========
-- Les commandes sont conservées pour la comptabilité mais ANONYMISÉES et détachées du compte.
alter table public.orders alter column user_id drop not null;
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.orders'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass limit 1;
  if c is not null then
    execute format('alter table public.orders drop constraint %I', c);
    alter table public.orders add constraint orders_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;
  end if;
end $$;

create or replace function public.erase_user_data(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text; v_seller uuid;
begin
  if exists (select 1 from public.admin_roles where user_id = p_user) then raise exception 'ADMIN_ACCOUNT'; end if;
  select id into v_seller from public.sellers where user_id = p_user;
  if v_seller is not null and (exists (select 1 from public.seller_payouts where seller_id = v_seller) or exists (select 1 from public.order_items where seller_id = v_seller)) then
    raise exception 'SELLER_RECORDS_EXIST';   -- historique financier à conserver : traitement manuel par le support
  end if;
  select email into v_email from auth.users where id = p_user;
  -- Commandes : on garde totaux, lignes et statuts ; on efface l'identité
  update public.orders set user_id = null, full_name = 'Client supprimé', phone = '', email = '', address = '', city = '', department = '', notes = null where user_id = p_user;
  delete from public.messages where v_email is not null and lower(email) = lower(v_email);
  delete from public.b2b_requests where user_id = p_user;          -- les échanges B2B partent en cascade
  delete from public.bio_profiles where user_id = p_user;
  if v_seller is not null then
    delete from public.products where seller_id = v_seller;        -- sans ventes : aucun historique à conserver
    delete from public.sellers where id = v_seller;
  end if;
  update public.audit_logs set user_email = 'compte supprimé' where user_id = p_user;
  delete from public.device_tokens where user_id = p_user;
  return jsonb_build_object('seller_id', v_seller);
end $$;
revoke all on function public.erase_user_data(uuid) from public, anon, authenticated;
grant execute on function public.erase_user_data(uuid) to service_role;

-- ========== 5) 2FA obligatoire pour l'administration (OPTION, désactivée par défaut) ==========
-- ⚠ N'activez qu'APRÈS avoir enrôlé la 2FA sur chaque compte administrateur (sinon verrouillage : voir INTEGRATION.md pour le déblocage par SQL).
insert into public.settings(key, value) values ('security', '{"require_admin_mfa": false}'::jsonb) on conflict (key) do nothing;

create or replace function public.admin_aal_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((select (value->>'require_admin_mfa')::boolean from public.settings where key = 'security'), false)
         or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
$$;
revoke all on function public.admin_aal_ok() from public, anon;
grant execute on function public.admin_aal_ok() to authenticated, anon;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles where user_id = auth.uid()) and public.admin_aal_ok()
$$;
create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_roles r
    where r.user_id = auth.uid()
      and (r.role = 'SUPER_ADMIN' or exists (select 1 from public.admin_permissions ap where ap.role = r.role and ap.permission = p))
  ) and public.admin_aal_ok()
$$;
