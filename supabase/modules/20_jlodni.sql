-- JLodni — migration PROPOSÉE (additive uniquement : aucune table existante n'est modifiée).
-- À relire puis exécuter une seule fois dans l'éditeur SQL Supabase (après schema/functions/triggers/policies).

-- 1) Limitation de débit (clés = hash d'IP, aucune IP en clair)
create table if not exists public.assistant_rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.assistant_rate_limits enable row level security; -- aucune policy : service role uniquement

create or replace function public.assistant_rate_check(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  h int;
begin
  insert into public.assistant_rate_limits(key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = public.assistant_rate_limits.hits + 1
  returning hits into h;
  if random() < 0.01 then
    delete from public.assistant_rate_limits where window_start < now() - interval '2 days';
  end if;
  return h <= p_max;
end $$;
revoke all on function public.assistant_rate_check(text, int, int) from public, anon, authenticated;
grant execute on function public.assistant_rate_check(text, int, int) to service_role;

-- 2) Statistiques agrégées réelles (outils utilisés + résultat ; jamais le contenu des messages)
create table if not exists public.assistant_stats (
  id bigint generated always as identity primary key,
  tools text[] not null default '{}',
  ok boolean not null,
  error_code text,
  authenticated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists assistant_stats_created_idx on public.assistant_stats(created_at desc);
alter table public.assistant_stats enable row level security;

-- 3) Sujets génériques non résolus (sans données personnelles)
create table if not exists public.assistant_unanswered (
  id bigint generated always as identity primary key,
  topic text not null check (char_length(topic) <= 100),
  created_at timestamptz not null default now()
);
alter table public.assistant_unanswered enable row level security;

-- 4) Lecture réservée aux admins (rôles existants de admin_roles)
drop policy if exists assistant_stats_admin_read on public.assistant_stats;
create policy assistant_stats_admin_read on public.assistant_stats for select to authenticated
  using (exists (select 1 from public.admin_roles r where r.user_id = auth.uid() and r.role in ('SUPER_ADMIN','ADMIN','MANAGER')));

drop policy if exists assistant_unanswered_admin_read on public.assistant_unanswered;
create policy assistant_unanswered_admin_read on public.assistant_unanswered for select to authenticated
  using (exists (select 1 from public.admin_roles r where r.user_id = auth.uid() and r.role in ('SUPER_ADMIN','ADMIN','MANAGER','SUPPORT')));

-- 5) Réglages (table settings existante) : DÉSACTIVÉ par défaut tant que tu n'as pas testé.
insert into public.settings(key, value) values
  ('assistant', '{"enabled": false, "languages": ["ht","fr"], "faqs": [], "support": {"email": null, "phone": null, "whatsapp": null}}')
on conflict (key) do nothing;
-- Pour activer :  update public.settings set value = jsonb_set(value, '{enabled}', 'true') where key = 'assistant';
-- Pour ajouter un contact support / une FAQ approuvée : modifier cette même ligne (jsonb) depuis le dashboard admin ou le SQL editor.
