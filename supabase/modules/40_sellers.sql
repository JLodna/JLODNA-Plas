-- JLODNA Plas — COMPTES VENDEURS (marketplace). ADDITIF et idempotent. À exécuter APRÈS les modules 10, 20 et 30.
-- Modèle : un client postule ; le personnel (sellers.manage) approuve ; le vendeur prépare ses produits en BROUILLON ;
-- seul le personnel publie (modération avant mise en vente). La plateforme gère le paiement et la livraison :
-- le vendeur ne voit JAMAIS l'identité ni l'adresse des acheteurs. Commission et reversements suivis en base.

insert into public.admin_permissions(role, permission) values ('ADMIN','sellers.manage'),('MANAGER','sellers.manage') on conflict do nothing;

create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  shop_name text not null check (char_length(shop_name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  description text check (description is null or char_length(description) <= 1000),
  phone text not null check (char_length(phone) between 6 and 30),
  city text check (city is null or char_length(city) <= 100),
  status text not null default 'pending' check (status in ('pending','approved','suspended','rejected')),
  commission_percent numeric(5,2) not null default 10 check (commission_percent between 0 and 100),
  reviewed_by uuid, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
drop trigger if exists trg_sellers_touch on public.sellers;
create trigger trg_sellers_touch before update on public.sellers for each row execute function public.touch_updated_at();

create table if not exists public.seller_payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  method text check (method is null or char_length(method) <= 60),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid, paid_at timestamptz not null default now()
);
create index if not exists seller_payouts_seller_idx on public.seller_payouts(seller_id, paid_at desc);

-- Colonnes additives sur les tables existantes (nullable : aucune donnée existante n'est touchée)
alter table public.products add column if not exists seller_id uuid references public.sellers(id) on delete set null;
alter table public.products add column if not exists submitted_at timestamptz;
create index if not exists products_seller_idx on public.products(seller_id) where seller_id is not null;
alter table public.order_items add column if not exists seller_id uuid references public.sellers(id) on delete set null;
create index if not exists order_items_seller_idx on public.order_items(seller_id) where seller_id is not null;

create or replace function public.order_item_seller() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.product_id is not null then select seller_id into new.seller_id from public.products where id = new.product_id; end if;
  return new;
end $$;
drop trigger if exists trg_order_item_seller on public.order_items;
create trigger trg_order_item_seller before insert on public.order_items for each row execute function public.order_item_seller();

-- RLS : lecture de SES données (ou personnel) ; AUCUNE écriture directe (fonctions ci-dessous)
alter table public.sellers enable row level security; alter table public.sellers force row level security;
alter table public.seller_payouts enable row level security; alter table public.seller_payouts force row level security;
drop policy if exists sellers_select on public.sellers;
drop policy if exists seller_payouts_select on public.seller_payouts;
create policy sellers_select on public.sellers for select to authenticated using (user_id = auth.uid() or public.has_perm('sellers.manage'));
create policy seller_payouts_select on public.seller_payouts for select to authenticated
  using (public.has_perm('sellers.manage') or exists (select 1 from public.sellers s where s.id = seller_id and s.user_id = auth.uid()));
revoke all on public.sellers, public.seller_payouts from anon, authenticated;
grant select on public.sellers, public.seller_payouts to authenticated;

-- ---------- Outils internes ----------
create or replace function public._my_seller(p_require_approved boolean default true) returns public.sellers
language plpgsql stable security definer set search_path = public as $$
declare s public.sellers;
begin
  select * into s from public.sellers where user_id = auth.uid();
  if not found then raise exception 'NOT_A_SELLER'; end if;
  if p_require_approved and s.status <> 'approved' then raise exception 'SELLER_NOT_APPROVED'; end if;
  return s;
end $$;
revoke all on function public._my_seller(boolean) from public, anon, authenticated;

create or replace function public._seller_summary(p_seller uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select id, commission_percent from public.sellers where id = p_seller),
  done as (select coalesce(sum(oi.unit_price * oi.quantity), 0) g from public.order_items oi join public.orders o on o.id = oi.order_id
           where oi.seller_id = p_seller and o.status = 'delivered' and o.payment_status = 'paid'),
  pend as (select coalesce(sum(oi.unit_price * oi.quantity), 0) p from public.order_items oi join public.orders o on o.id = oi.order_id
           where oi.seller_id = p_seller and o.status <> 'cancelled' and not (o.status = 'delivered' and o.payment_status = 'paid')),
  paid as (select coalesce(sum(amount), 0) a from public.seller_payouts where seller_id = p_seller)
  select jsonb_build_object('commission_percent', s.commission_percent, 'gross', done.g,
    'commission', round(done.g * s.commission_percent / 100, 2), 'net', done.g - round(done.g * s.commission_percent / 100, 2),
    'paid_out', paid.a, 'balance', done.g - round(done.g * s.commission_percent / 100, 2) - paid.a, 'pending_gross', pend.p)
  from s, done, pend, paid
$$;
revoke all on function public._seller_summary(uuid) from public, anon, authenticated;

-- ---------- Candidature et modération (personnel) ----------
create or replace function public.apply_seller(p_shop_name text, p_slug text, p_description text, p_phone text, p_city text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if exists (select 1 from public.sellers where user_id = auth.uid()) then raise exception 'ALREADY_SELLER'; end if;
  insert into public.sellers(user_id, shop_name, slug, description, phone, city)
  values (auth.uid(), trim(p_shop_name), lower(trim(p_slug)), nullif(trim(coalesce(p_description,'')), ''), trim(p_phone), nullif(trim(coalesce(p_city,'')), ''))
  returning id into v_id;
  perform public.notify_admins('seller_application', 'Nouvelle candidature vendeur', trim(p_shop_name), '/admin/#sellers');
  return v_id;
end $$;
revoke all on function public.apply_seller(text,text,text,text,text) from public, anon;
grant execute on function public.apply_seller(text,text,text,text,text) to authenticated;

create or replace function public.admin_set_seller_status(p_id uuid, p_status text, p_commission numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sellers; v_title text;
begin
  if not public.has_perm('sellers.manage') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('pending','approved','suspended','rejected') then raise exception 'INVALID_STATUS'; end if;
  if p_commission is not null and (p_commission < 0 or p_commission > 100) then raise exception 'INVALID_COMMISSION'; end if;
  select * into s from public.sellers where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.sellers set status = p_status, commission_percent = coalesce(p_commission, commission_percent), reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  if p_status in ('suspended','rejected') then
    update public.products set status = 'disabled' where seller_id = p_id and status = 'published'; -- retire immédiatement les produits de la vente
  end if;
  v_title := case p_status when 'approved' then 'Votre boutique vendeur est approuvée' when 'suspended' then 'Votre boutique vendeur est suspendue'
                           when 'rejected' then 'Votre candidature vendeur n''a pas été retenue' else 'Votre candidature vendeur est en cours d''examen' end;
  insert into public.notifications(user_id, audience, type, title, body, link) values (s.user_id, 'customer', 'seller_' || p_status, v_title, s.shop_name, '/seller');
  insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), 'set_seller_status', 'sellers', p_id::text,
          jsonb_build_object('name', s.shop_name, 'before_status', s.status, 'after_status', p_status, 'commission', coalesce(p_commission, s.commission_percent)));
end $$;
revoke all on function public.admin_set_seller_status(uuid, text, numeric) from public, anon;
grant execute on function public.admin_set_seller_status(uuid, text, numeric) to authenticated;

create or replace function public.admin_seller_summary(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('sellers.manage') then raise exception 'FORBIDDEN'; end if;
  return public._seller_summary(p_id);
end $$;
revoke all on function public.admin_seller_summary(uuid) from public, anon;
grant execute on function public.admin_seller_summary(uuid) to authenticated;

create or replace function public.admin_record_payout(p_seller_id uuid, p_amount numeric, p_method text default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_bal numeric; v_id uuid; s public.sellers;
begin
  if not public.has_perm('sellers.manage') then raise exception 'FORBIDDEN'; end if;
  select * into s from public.sellers where id = p_seller_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_bal := (public._seller_summary(p_seller_id)->>'balance')::numeric;
  if p_amount > v_bal then raise exception 'EXCEEDS_BALANCE'; end if;
  insert into public.seller_payouts(seller_id, amount, method, note, created_by) values (p_seller_id, p_amount, left(p_method, 60), left(p_note, 300), auth.uid()) returning id into v_id;
  insert into public.notifications(user_id, audience, type, title, body, link) values (s.user_id, 'customer', 'seller_payout', 'Reversement effectué : ' || p_amount || ' G', left(p_note, 100), '/seller');
  insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), 'seller_payout', 'sellers', p_seller_id::text, jsonb_build_object('name', s.shop_name, 'amount', p_amount));
  return v_id;
end $$;
revoke all on function public.admin_record_payout(uuid, numeric, text, text) from public, anon;
grant execute on function public.admin_record_payout(uuid, numeric, text, text) to authenticated;

-- ---------- Espace vendeur : produits (toujours en BROUILLON, jamais publiés par le vendeur) ----------
create or replace function public.seller_save_product(p_product jsonb, p_variants jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s public.sellers := public._my_seller(); v_id uuid := nullif(p_product->>'id', '')::uuid; r jsonb; vid uuid; v_old public.product_variants;
  v_keep uuid[] := '{}'; v_n int := 0; v_stock int; v_name text; v_slug text;
begin
  if jsonb_typeof(p_variants) is distinct from 'array' or jsonb_array_length(p_variants) = 0 or jsonb_array_length(p_variants) > 50 then raise exception 'NO_VARIANT'; end if;
  if v_id is null then
    v_slug := left(regexp_replace(lower(coalesce(p_product->>'name', '')), '[^a-z0-9]+', '-', 'g'), 60) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    insert into public.products(name, slug, description, price, sale_price, category_id, weight_grams, status, seller_id)
    values (trim(p_product->>'name'), v_slug, nullif(trim(coalesce(p_product->>'description', '')), ''), (p_product->>'price')::numeric,
            nullif(p_product->>'sale_price', '')::numeric, nullif(p_product->>'category_id', '')::uuid, nullif(p_product->>'weight_grams', '')::int, 'draft', s.id)
    returning id into v_id;
  else
    perform 1 from public.products where id = v_id and seller_id = s.id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    -- Toute modification remet le produit en brouillon (retiré de la vente) : le personnel revalide avant republication.
    update public.products set name = trim(p_product->>'name'), description = nullif(trim(coalesce(p_product->>'description', '')), ''), price = (p_product->>'price')::numeric,
           sale_price = nullif(p_product->>'sale_price', '')::numeric, category_id = nullif(p_product->>'category_id', '')::uuid,
           weight_grams = nullif(p_product->>'weight_grams', '')::int, status = 'draft', submitted_at = null where id = v_id;
  end if;
  for r in select value from jsonb_array_elements(p_variants) loop
    v_n := v_n + 1; vid := nullif(r->>'id', '')::uuid;
    v_stock := greatest(0, coalesce(nullif(r->>'stock_quantity', '')::int, 0));
    v_name := left(coalesce(nullif(trim(r->>'name'), ''), 'Standard'), 200);
    if coalesce(r->>'status', 'active') not in ('active', 'disabled') then raise exception 'INVALID_STATUS'; end if;
    if vid is not null then
      select * into v_old from public.product_variants where id = vid and product_id = v_id for update;
      if not found then raise exception 'NOT_FOUND'; end if;
      update public.product_variants set sku = nullif(trim(r->>'sku'), ''), name = v_name, attributes = coalesce(r->'attributes', case when jsonb_array_length(p_variants) = 1 then '{}'::jsonb else jsonb_build_object('Option', v_name) end),
             price = nullif(r->>'price', '')::numeric, sale_price = nullif(r->>'sale_price', '')::numeric, status = coalesce(r->>'status', 'active'), sort_order = v_n where id = vid;
      if v_stock <> v_old.stock_quantity then
        if v_stock < v_old.reserved_quantity then raise exception 'STOCK_BELOW_RESERVED'; end if;
        update public.product_variants set stock_quantity = v_stock where id = vid;
        insert into public.inventory_movements(product_id, variant_id, type, stock_delta, reserved_delta, stock_after, reserved_after, reason, created_by)
        values (v_id, vid, 'adjust', v_stock - v_old.stock_quantity, 0, v_stock, v_old.reserved_quantity, 'Modification par le vendeur', auth.uid());
      end if;
    else
      insert into public.product_variants(product_id, sku, name, attributes, price, sale_price, status, sort_order, stock_quantity)
      values (v_id, nullif(trim(r->>'sku'), ''), v_name, coalesce(r->'attributes', case when jsonb_array_length(p_variants) = 1 then '{}'::jsonb else jsonb_build_object('Option', v_name) end), nullif(r->>'price', '')::numeric, nullif(r->>'sale_price', '')::numeric,
              coalesce(r->>'status', 'active'), v_n, v_stock) returning id into vid;
      if v_stock > 0 then
        insert into public.inventory_movements(product_id, variant_id, type, stock_delta, reserved_delta, stock_after, reserved_after, reason, created_by)
        values (v_id, vid, 'initial', v_stock, 0, v_stock, 0, 'Stock initial (vendeur)', auth.uid());
      end if;
    end if;
    v_keep := v_keep || vid;
  end loop;
  delete from public.product_variants where product_id = v_id and not (id = any (v_keep)); -- refusé par guard_variant_delete si des commandes la réservent
  return v_id;
end $$;
revoke all on function public.seller_save_product(jsonb, jsonb) from public, anon;
grant execute on function public.seller_save_product(jsonb, jsonb) to authenticated;

create or replace function public.seller_set_images(p_product_id uuid, p_images jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sellers := public._my_seller(); p public.products; r jsonb; n int := 0;
begin
  select * into p from public.products where id = p_product_id and seller_id = s.id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.status = 'published' then raise exception 'PRODUCT_LOCKED'; end if;
  if jsonb_typeof(p_images) is distinct from 'array' or jsonb_array_length(p_images) > 8 then raise exception 'INVALID_IMAGES'; end if;
  for r in select value from jsonb_array_elements(p_images) loop
    if coalesce(r->>'url', '') !~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/product-images/sellers/' || s.id::text || '/[A-Za-z0-9._-]+$') then raise exception 'INVALID_IMAGES'; end if;
  end loop;
  delete from public.product_images where product_id = p_product_id;
  for r in select value from jsonb_array_elements(p_images) loop
    n := n + 1; insert into public.product_images(product_id, url, alt, sort_order) values (p_product_id, r->>'url', left(r->>'alt', 200), n);
  end loop;
end $$;
revoke all on function public.seller_set_images(uuid, jsonb) from public, anon;
grant execute on function public.seller_set_images(uuid, jsonb) to authenticated;

create or replace function public.seller_submit_product(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sellers := public._my_seller(); p public.products;
begin
  select * into p from public.products where id = p_id and seller_id = s.id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p.status <> 'draft' then raise exception 'INVALID_STATUS'; end if;
  if not exists (select 1 from public.product_variants where product_id = p_id and status = 'active') then raise exception 'NO_VARIANT'; end if;
  if not exists (select 1 from public.product_images where product_id = p_id) then raise exception 'NO_IMAGE'; end if;
  update public.products set submitted_at = now() where id = p_id;
  perform public.notify_admins('product_submitted', 'Produit à valider : ' || left(p.name, 80), s.shop_name, '/admin/#products');
end $$;
revoke all on function public.seller_submit_product(uuid) from public, anon;
grant execute on function public.seller_submit_product(uuid) to authenticated;

create or replace function public.seller_withdraw_product(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.sellers := public._my_seller(false);
begin
  update public.products set status = 'draft', submitted_at = null where id = p_id and seller_id = s.id;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;
revoke all on function public.seller_withdraw_product(uuid) from public, anon;
grant execute on function public.seller_withdraw_product(uuid) to authenticated;

create or replace function public.seller_my_products() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.sellers := public._my_seller(false);
begin
  return coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'submitted_at', p.submitted_at, 'price', p.price, 'created_at', p.created_at,
      'variants', (select count(*) from public.product_variants v where v.product_id = p.id),
      'available', coalesce((select sum(v.available_quantity) from public.product_variants v where v.product_id = p.id and v.status = 'active'), 0),
      'image', (select url from public.product_images i where i.product_id = p.id order by sort_order limit 1)) x
    from public.products p where p.seller_id = s.id) t), '[]'::jsonb);
end $$;
revoke all on function public.seller_my_products() from public, anon;
grant execute on function public.seller_my_products() to authenticated;

create or replace function public.seller_get_product(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.sellers := public._my_seller(false); p public.products;
begin
  select * into p from public.products where id = p_id and seller_id = s.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'price', p.price, 'sale_price', p.sale_price, 'category_id', p.category_id,
    'weight_grams', p.weight_grams, 'status', p.status, 'submitted_at', p.submitted_at,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'sku', v.sku, 'attributes', v.attributes, 'price', v.price, 'sale_price', v.sale_price,
        'stock_quantity', v.stock_quantity, 'reserved_quantity', v.reserved_quantity, 'status', v.status) order by v.sort_order) from public.product_variants v where v.product_id = p.id), '[]'::jsonb),
    'images', coalesce((select jsonb_agg(jsonb_build_object('url', i.url, 'alt', i.alt) order by i.sort_order) from public.product_images i where i.product_id = p.id), '[]'::jsonb));
end $$;
revoke all on function public.seller_get_product(uuid) from public, anon;
grant execute on function public.seller_get_product(uuid) to authenticated;

-- Ventes : lignes vendues + totaux. AUCUNE donnée sur l'acheteur (nom, email, téléphone, adresse) n'est exposée.
create or replace function public.seller_sales(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.sellers := public._my_seller(false);
begin
  return jsonb_build_object('summary', public._seller_summary(s.id),
    'items', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('order_number', o.order_number, 'order_status', o.status, 'payment_status', o.payment_status, 'date', o.created_at,
        'name', oi.name, 'variant', oi.variant_name, 'quantity', oi.quantity, 'unit_price', oi.unit_price, 'line_total', oi.unit_price * oi.quantity) x
      from public.order_items oi join public.orders o on o.id = oi.order_id where oi.seller_id = s.id order by o.created_at desc limit least(greatest(p_limit, 1), 500)) t), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('amount', amount, 'method', method, 'note', note, 'paid_at', paid_at) order by paid_at desc) from public.seller_payouts where seller_id = s.id), '[]'::jsonb));
end $$;
revoke all on function public.seller_sales(int) from public, anon;
grant execute on function public.seller_sales(int) to authenticated;

-- ---------- Storage : images produits du vendeur approuvé, dans SON dossier uniquement ----------
drop policy if exists "pi_seller_insert" on storage.objects;
drop policy if exists "pi_seller_delete" on storage.objects;
create policy "pi_seller_insert" on storage.objects for insert to authenticated with check (bucket_id = 'product-images' and (storage.foldername(name))[1] = 'sellers'
  and (storage.foldername(name))[2] = (select s.id::text from public.sellers s where s.user_id = auth.uid() and s.status = 'approved'));
create policy "pi_seller_delete" on storage.objects for delete to authenticated using (bucket_id = 'product-images' and (storage.foldername(name))[1] = 'sellers'
  and (storage.foldername(name))[2] = (select s.id::text from public.sellers s where s.user_id = auth.uid()));
