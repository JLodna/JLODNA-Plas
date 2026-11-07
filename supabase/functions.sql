-- JLODNA Plas — fonctions (rôles, notifications, RPC sécurisées). Exécuter APRÈS schema.sql.

create or replace function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select role from public.admin_roles where user_id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles where user_id = auth.uid())
$$;

create or replace function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_roles r
    where r.user_id = auth.uid()
      and (r.role = 'SUPER_ADMIN' or exists (select 1 from public.admin_permissions ap where ap.role = r.role and ap.permission = p))
  )
$$;

create or replace function public.admin_user_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select user_id from public.admin_roles
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.notify_admins(p_type text, p_title text, p_body text, p_link text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications(user_id, audience, type, title, body, link)
  select user_id, 'admin', p_type, p_title, p_body, p_link from public.admin_roles;
end $$;
revoke all on function public.notify_admins(text,text,text,text) from public, anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, first_name, last_name, phone)
  values (new.id, new.email, left(new.raw_user_meta_data->>'first_name',80), left(new.raw_user_meta_data->>'last_name',80), left(new.raw_user_meta_data->>'phone',30))
  on conflict (id) do nothing;
  perform public.notify_admins('new_customer','Nouveau client', coalesce(new.email,''), '/admin/#customers');
  return new;
end $$;

create or replace function public.grant_bootstrap_admin() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select value #>> '{}' into v_email from public.settings where key = 'bootstrap_admin_email';
  if new.email_confirmed_at is not null and v_email is not null and lower(new.email) = lower(v_email)
     and not exists (select 1 from public.admin_roles where role = 'SUPER_ADMIN') then
    insert into public.admin_roles(user_id, role) values (new.id, 'SUPER_ADMIN') on conflict do nothing;
  end if;
  return new;
end $$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_old jsonb; v_email text;
begin
  if auth.uid() is null then return coalesce(new, old); end if; -- actions système (triggers/RPC internes) déjà tracées ailleurs
  -- Ignorer les mises à jour purement techniques (compteur de ventes, horodatage) : ce ne sont pas des actions admin.
  if tg_op = 'UPDATE' and tg_table_name = 'products' and (to_jsonb(new) - 'sold_count' - 'updated_at') = (to_jsonb(old) - 'sold_count' - 'updated_at') then return new; end if;
  if not public.is_admin() then return coalesce(new, old); end if;
  select email into v_email from auth.users where id = auth.uid();
  v_row := to_jsonb(coalesce(new, old));
  if tg_op = 'UPDATE' then v_old := to_jsonb(old); end if;
  insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
  values (auth.uid(), v_email, lower(tg_op) || '_' || tg_table_name, tg_table_name, v_row->>'id',
          jsonb_build_object('name', coalesce(v_row->>'name', v_row->>'code', v_row->>'key', v_row->>'role'), 'before_status', v_old->>'status', 'after_status', v_row->>'status'));
  return coalesce(new, old);
end $$;


create or replace function public.validate_coupon(p_code text, p_subtotal numeric)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.coupons; d numeric;
begin
  select * into c from public.coupons where upper(code) = upper(trim(p_code)) and is_active;
  if not found or (c.expires_at is not null and c.expires_at < now()) or (c.max_uses is not null and c.used_count >= c.max_uses) then
    return jsonb_build_object('valid', false, 'message', 'Code promo invalide ou expiré.');
  end if;
  if p_subtotal < c.min_subtotal then
    return jsonb_build_object('valid', false, 'message', 'Montant minimum non atteint pour ce code.');
  end if;
  d := case when c.type = 'percent' then round(p_subtotal * least(c.value,100) / 100, 2) else least(c.value, p_subtotal) end;
  return jsonb_build_object('valid', true, 'discount', d, 'code', c.code);
end $$;
grant execute on function public.validate_coupon(text, numeric) to authenticated;




create or replace function public.log_admin_login() returns void
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_admin() then return; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.audit_logs(user_id, user_email, action, entity) values (auth.uid(), v_email, 'admin_login', 'auth');
end $$;
grant execute on function public.log_admin_login() to authenticated;


-- Synchronise payments.status avec orders.payment_status (modifié par l'admin).
create or replace function public.sync_payment_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status is distinct from old.payment_status then
    update public.payments set status = new.payment_status where order_id = new.id and method = new.payment_method;
  end if;
  return new;
end $$;


-- ========== Alertes stock (basées sur le stock DISPONIBLE) ==========
create or replace function public.inventory_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.available_quantity < old.available_quantity and new.status = 'active' then
    select p.name || case when new.name <> 'Standard' then ' (' || new.name || ')' else '' end
      into v_name from public.products p where p.id = new.product_id;
    if new.available_quantity = 0 then
      perform public.notify_admins('out_of_stock', 'Produit en rupture', v_name || ' est en rupture de stock.', '/admin/#inventory');
    elsif new.available_quantity <= new.low_stock_threshold then
      perform public.notify_admins('low_stock', 'Stock faible', 'Attention : le produit ' || v_name || ' possède seulement ' || new.available_quantity || ' unité(s) disponible(s).', '/admin/#inventory');
    end if;
  end if;
  return new;
end $$;

-- ========== Garde-fous ==========
create or replace function public.guard_variant_delete() returns trigger language plpgsql as $$
begin
  if old.reserved_quantity > 0 then raise exception 'VARIANT_HAS_RESERVATIONS'; end if;
  return old;
end $$;

create or replace function public.guard_product_publish() returns trigger language plpgsql as $$
begin
  if new.status = 'published' and old.status is distinct from 'published'
     and not exists (select 1 from public.product_variants where product_id = new.id and status = 'active') then
    raise exception 'NO_VARIANT';
  end if;
  return new;
end $$;

create or replace function public.notify_new_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select name into v_name from public.products where id = new.product_id;
  perform public.notify_admins('new_review', 'Nouvel avis à modérer', coalesce(v_name, 'Produit') || ' — ' || new.rating || '/5', '/admin/#reviews');
  return new;
end $$;

-- ========== RPC : créer une commande ==========
-- Prix, stock et coupon sont recalculés côté base. Le stock est RÉSERVÉ (pas encore sorti) ; tout est dans une seule transaction :
-- si une ligne échoue, rien n'est réservé ni créé. Les variantes sont verrouillées dans un ordre fixe (pas de deadlock).
create or replace function public.create_order(p_items jsonb, p_shipping jsonb, p_coupon text default null, p_payment_method text default 'cod')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_item jsonb; v_var public.product_variants; v_prod public.products;
  v_qty int; v_price numeric; v_subtotal numeric := 0; v_fee numeric := 0; v_discount numeric := 0;
  v_order_id uuid := gen_random_uuid(); v_number text; v_img text; v_cfg jsonb; v_cv jsonb; v_methods jsonb; v_free_over numeric;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then raise exception 'CART_EMPTY'; end if;
  if char_length(coalesce(p_shipping->>'full_name','')) < 2 or char_length(coalesce(p_shipping->>'phone','')) < 6
     or char_length(coalesce(p_shipping->>'address','')) < 3 or char_length(coalesce(p_shipping->>'city','')) < 2
     or char_length(coalesce(p_shipping->>'department','')) < 2 or coalesce(p_shipping->>'email','') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_SHIPPING';
  end if;
  select value into v_methods from public.settings where key = 'payment_methods';
  if v_methods is null or not (v_methods ? p_payment_method) or coalesce((v_methods->p_payment_method->>'enabled')::boolean, false) = false then
    raise exception 'PAYMENT_METHOD_UNAVAILABLE';
  end if;

  v_number := 'JLD-' || lpad(nextval('public.order_number_seq')::text, 6, '0');
  insert into public.orders(id, order_number, user_id, payment_method, subtotal, shipping_fee, discount, total, full_name, phone, email, address, city, department, notes)
  values (v_order_id, v_number, v_uid, p_payment_method, 0, 0, 0, 0,
          left(p_shipping->>'full_name',150), left(p_shipping->>'phone',30), left(p_shipping->>'email',200),
          left(p_shipping->>'address',300), left(p_shipping->>'city',100), left(p_shipping->>'department',100), left(p_shipping->>'notes',1000));

  for v_item in select e from jsonb_array_elements(p_items) e order by e->>'variant_id' loop
    v_qty := greatest(1, least(99, coalesce((v_item->>'quantity')::int, 1)));
    select * into v_var from public.product_variants where id = (v_item->>'variant_id')::uuid and status = 'active' for update;
    if not found then raise exception 'VARIANT_UNAVAILABLE'; end if;
    select * into v_prod from public.products where id = v_var.product_id and status = 'published';
    if not found then raise exception 'PRODUCT_UNAVAILABLE'; end if;
    if v_var.available_quantity < v_qty then raise exception 'OUT_OF_STOCK:%', v_prod.name; end if;
    v_price := coalesce(v_var.sale_price, v_var.price, v_prod.sale_price, v_prod.price);
    v_subtotal := v_subtotal + v_price * v_qty;
    select url into v_img from public.product_images where product_id = v_prod.id order by sort_order limit 1;
    insert into public.order_items(order_id, product_id, variant_id, name, variant_name, sku, image_url, variant, unit_price, quantity)
    values (v_order_id, v_prod.id, v_var.id, v_prod.name, v_var.name, coalesce(v_var.sku, v_prod.sku), v_img, v_var.attributes, v_price, v_qty);
    update public.product_variants set reserved_quantity = reserved_quantity + v_qty where id = v_var.id;
    insert into public.inventory_movements(product_id, variant_id, type, stock_delta, reserved_delta, stock_after, reserved_after, reason, order_id, created_by)
    values (v_prod.id, v_var.id, 'reserve', 0, v_qty, v_var.stock_quantity, v_var.reserved_quantity + v_qty, 'Commande ' || v_number, v_order_id, v_uid);
  end loop;

  select value into v_cfg from public.settings where key = 'shipping';
  v_fee := coalesce((v_cfg->>'flat_fee')::numeric, 0);
  v_free_over := (v_cfg->>'free_over')::numeric;
  if v_free_over is not null and v_free_over > 0 and v_subtotal >= v_free_over then v_fee := 0; end if;

  if p_coupon is not null and trim(p_coupon) <> '' then
    v_cv := public.validate_coupon(p_coupon, v_subtotal);
    if (v_cv->>'valid')::boolean then
      v_discount := (v_cv->>'discount')::numeric;
      update public.coupons set used_count = used_count + 1 where upper(code) = upper(v_cv->>'code');
    else raise exception 'COUPON_INVALID'; end if;
  end if;

  update public.orders set subtotal = v_subtotal, shipping_fee = v_fee, discount = v_discount,
         total = greatest(v_subtotal + v_fee - v_discount, 0), coupon_code = case when v_discount > 0 then upper(trim(p_coupon)) end
   where id = v_order_id;

  insert into public.payments(order_id, method, amount) select id, payment_method, total from public.orders where id = v_order_id;
  if v_discount > 0 then
    insert into public.coupon_usages(coupon_id, order_id, user_id, discount)
    select id, v_order_id, v_uid, v_discount from public.coupons where upper(code) = upper(trim(p_coupon));
  end if;
  delete from public.cart_items where user_id = v_uid;
  insert into public.notifications(user_id, audience, type, title, body, link)
  values (v_uid, 'customer', 'order_new', 'Votre commande a été enregistrée', 'Commande ' || v_number || ' reçue.', '/orders.html');
  perform public.notify_admins('order_new', 'Nouvelle commande #' || v_number, 'Total : ' || (select total from public.orders where id = v_order_id), '/admin/#orders');
  return jsonb_build_object('id', v_order_id, 'order_number', v_number);
end $$;
grant execute on function public.create_order(jsonb, jsonb, text, text) to authenticated;

-- ========== RPC : changer le statut d'une commande (admin) ==========
-- Cycle du stock : création = RÉSERVER · confirmation/préparation/expédition = la réservation est conservée
--                  livraison = SORTIR du stock (stock - n) et libérer la réservation · annulation = LIBÉRER la réservation.
-- Une commande livrée ou annulée est définitive.
create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.orders; v_title text; v_email text; it record; v_var public.product_variants;
  v_rank jsonb := '{"new":0,"confirmed":1,"preparing":2,"shipped":3,"out_for_delivery":4,"delivered":5}';
begin
  if not public.has_perm('orders.write') then raise exception 'FORBIDDEN'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_status not in ('new','confirmed','preparing','shipped','out_for_delivery','delivered','cancelled') then raise exception 'INVALID_STATUS'; end if;
  if o.status = p_status then return; end if;
  if o.status in ('delivered','cancelled') then raise exception 'ORDER_FINAL'; end if;
  if p_status <> 'cancelled' and (v_rank->>p_status)::int <= (v_rank->>o.status)::int then raise exception 'INVALID_TRANSITION'; end if;

  if p_status in ('cancelled','delivered') then
    for it in select variant_id, product_id, quantity from public.order_items where order_id = o.id and variant_id is not null order by variant_id loop
      select * into v_var from public.product_variants where id = it.variant_id for update;
      if not found then continue; end if;
      if p_status = 'cancelled' then
        update public.product_variants set reserved_quantity = reserved_quantity - it.quantity where id = it.variant_id;
        insert into public.inventory_movements(product_id, variant_id, type, stock_delta, reserved_delta, stock_after, reserved_after, reason, order_id, created_by)
        values (it.product_id, it.variant_id, 'release', 0, -it.quantity, v_var.stock_quantity, v_var.reserved_quantity - it.quantity, 'Annulation ' || o.order_number, o.id, auth.uid());
      else
        update public.product_variants set stock_quantity = stock_quantity - it.quantity, reserved_quantity = reserved_quantity - it.quantity where id = it.variant_id;
        insert into public.inventory_movements(product_id, variant_id, type, stock_delta, reserved_delta, stock_after, reserved_after, reason, order_id, created_by)
        values (it.product_id, it.variant_id, 'sale', -it.quantity, -it.quantity, v_var.stock_quantity - it.quantity, v_var.reserved_quantity - it.quantity, 'Livraison ' || o.order_number, o.id, auth.uid());
        update public.products set sold_count = sold_count + it.quantity where id = it.product_id;
      end if;
    end loop;
  end if;

  update public.orders set status = p_status where id = o.id;
  v_title := case p_status
    when 'confirmed' then 'Votre commande ' || o.order_number || ' a été confirmée.' when 'preparing' then 'Votre commande ' || o.order_number || ' est en préparation.'
    when 'shipped' then 'Votre commande ' || o.order_number || ' a été expédiée.' when 'out_for_delivery' then 'Votre commande ' || o.order_number || ' est en cours de livraison.'
    when 'delivered' then 'Votre commande ' || o.order_number || ' a été livrée.' when 'cancelled' then 'Votre commande ' || o.order_number || ' a été annulée.' else 'Mise à jour de votre commande.' end;
  insert into public.notifications(user_id, audience, type, title, body, link)
  values (o.user_id, 'customer', 'order_' || p_status, v_title, 'Commande ' || o.order_number, '/orders.html');
  select email into v_email from auth.users where id = auth.uid();
  insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
  values (auth.uid(), v_email, 'order_status_change', 'orders', o.id::text, jsonb_build_object('order_number', o.order_number, 'from', o.status, 'to', p_status));
end $$;
grant execute on function public.set_order_status(uuid, text) to authenticated;

-- ========== RPC : ajuster le stock d'une variante (admin) ==========
create or replace function public.admin_set_variant_stock(p_variant_id uuid, p_quantity int, p_reason text default 'Ajustement manuel', p_threshold int default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.product_variants; v_email text;
begin
  if not public.has_perm('inventory.write') then raise exception 'FORBIDDEN'; end if;
  if p_quantity is null or p_quantity < 0 then raise exception 'INVALID_QUANTITY'; end if;
  select * into v from public.product_variants where id = p_variant_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_quantity < v.reserved_quantity then raise exception 'STOCK_BELOW_RESERVED'; end if;
  update public.product_variants set stock_quantity = p_quantity, low_stock_threshold = coalesce(greatest(p_threshold, 0), low_stock_threshold) where id = v.id;
  if p_quantity <> v.stock_quantity then
    insert into public.inventory_movements(product_id, variant_id, type, stock_delta, reserved_delta, stock_after, reserved_after, reason, created_by)
    values (v.product_id, v.id, 'adjust', p_quantity - v.stock_quantity, 0, p_quantity, v.reserved_quantity, left(coalesce(p_reason, 'Ajustement manuel'), 200), auth.uid());
    select email into v_email from auth.users where id = auth.uid();
    insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
    values (auth.uid(), v_email, 'stock_change', 'product_variants', v.id::text, jsonb_build_object('from', v.stock_quantity, 'to', p_quantity, 'reason', p_reason));
  end if;
end $$;
grant execute on function public.admin_set_variant_stock(uuid, int, text, int) to authenticated;

-- ========== RPC : enregistrer toutes les variantes d'un produit (admin, atomique) ==========
-- Les variantes absentes de la liste sont supprimées (refusé si des commandes en cours les réservent).
-- Sans droit inventory.write : le stock des variantes existantes n'est pas modifié et les nouvelles démarrent à 0.
create or replace function public.admin_save_variants(p_product_id uuid, p_variants jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_id uuid; v_old public.product_variants; v_stock int; v_keep uuid[] := '{}'; v_email text; v_can_stock boolean; v_n int := 0;
  v_name text; v_price numeric; v_sale numeric;
begin
  if not public.has_perm('products.write') then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) = 0 or jsonb_array_length(p_variants) > 200 then raise exception 'NO_VARIANT'; end if;
  if not exists (select 1 from public.products where id = p_product_id) then raise exception 'NOT_FOUND'; end if;
  v_can_stock := public.has_perm('inventory.write');
  for r in select e from jsonb_array_elements(p_variants) e loop
    v_n := v_n + 1;
    v_id := nullif(r->>'id', '')::uuid;
    v_stock := greatest(0, coalesce(nullif(r->>'stock_quantity', '')::int, 0));
    v_name := left(coalesce(nullif(trim(r->>'name'), ''), 'Standard'), 200);
    v_price := nullif(r->>'price', '')::numeric; v_sale := nullif(r->>'sale_price', '')::numeric;
    if coalesce(r->>'status', 'active') not in ('active', 'disabled') then raise exception 'INVALID_STATUS'; end if;
    if v_id is not null then
      select * into v_old from public.product_variants where id = v_id and product_id = p_product_id for update;
      if not found then raise exception 'NOT_FOUND'; end if;
      update public.product_variants set
        sku = nullif(trim(r->>'sku'), ''), name = v_name, attributes = coalesce(r->'attributes', '{}'::jsonb),
        price = v_price, sale_price = v_sale, status = coalesce(r->>'status', 'active'), sort_order = v_n,
        low_stock_threshold = case when v_can_stock then greatest(0, coalesce(nullif(r->>'low_stock_threshold', '')::int, v_old.low_stock_threshold)) else v_old.low_stock_threshold end
       where id = v_id;
      if v_can_stock and v_stock <> v_old.stock_quantity then
        if v_stock < v_old.reserved_quantity then raise exception 'STOCK_BELOW_RESERVED'; end if;
        update public.product_variants set stock_quantity = v_stock where id = v_id;
        insert into public.inventory_movements(product_id, variant_id, type, stock_delta, reserved_delta, stock_after, reserved_after, reason, created_by)
        values (p_product_id, v_id, 'adjust', v_stock - v_old.stock_quantity, 0, v_stock, v_old.reserved_quantity, 'Modification fiche produit', auth.uid());
      end if;
    else
      insert into public.product_variants(product_id, sku, name, attributes, price, sale_price, status, sort_order, low_stock_threshold, stock_quantity)
      values (p_product_id, nullif(trim(r->>'sku'), ''), v_name, coalesce(r->'attributes', '{}'::jsonb), v_price, v_sale, coalesce(r->>'status', 'active'), v_n,
              greatest(0, coalesce(nullif(r->>'low_stock_threshold', '')::int, 5)), case when v_can_stock then v_stock else 0 end)
      returning id into v_id;
      if v_can_stock and v_stock > 0 then
        insert into public.inventory_movements(product_id, variant_id, type, stock_delta, reserved_delta, stock_after, reserved_after, reason, created_by)
        values (p_product_id, v_id, 'initial', v_stock, 0, v_stock, 0, 'Stock initial', auth.uid());
      end if;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  delete from public.product_variants where product_id = p_product_id and not (id = any (v_keep));
  select email into v_email from auth.users where id = auth.uid();
  insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
  values (auth.uid(), v_email, 'variants_saved', 'product_variants', p_product_id::text, jsonb_build_object('count', v_n));
end $$;
grant execute on function public.admin_save_variants(uuid, jsonb) to authenticated;

-- ========== RPC : statistiques du tableau de bord ==========
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'revenue', coalesce((select sum(total) from public.orders where status <> 'cancelled'), 0),
    'orders', (select count(*) from public.orders),
    'pending', (select count(*) from public.orders where status in ('new','confirmed','preparing')),
    'products', (select count(*) from public.products),
    'out_of_stock', (select count(*) from public.product_variants v join public.products p on p.id = v.product_id where v.available_quantity = 0 and v.status = 'active' and p.status = 'published'),
    'low_stock', (select count(*) from public.product_variants v where v.status = 'active' and v.available_quantity > 0 and v.available_quantity <= v.low_stock_threshold),
    'customers', (select count(*) from public.profiles),
    'pending_reviews', (select count(*) from public.reviews where status = 'pending'),
    'by_day', coalesce((select jsonb_agg(x order by x->>'day') from (
        select jsonb_build_object('day', to_char(d::date, 'YYYY-MM-DD'), 'orders', count(o.id), 'revenue', coalesce(sum(o.total), 0)) x
        from generate_series(current_date - 13, current_date, '1 day') d
        left join public.orders o on o.created_at::date = d::date and o.status <> 'cancelled' group by d) s), '[]'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from public.orders group by status) t), '{}'::jsonb)
  );
end $$;
grant execute on function public.admin_stats() to authenticated;
