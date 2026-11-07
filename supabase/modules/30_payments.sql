-- JLODNA Plas — paiements EN LIGNE (carte Stripe, PayPal, MonCash) + paiement manuel (NatCash).
-- ADDITIF et idempotent. À exécuter APRÈS les modules 10 et 20.
-- Principe de sécurité : le navigateur ne peut JAMAIS marquer une commande « payée ».
-- Seules les fonctions ci-dessous, réservées au rôle service_role (appelées par les fonctions serveur Vercel
-- après vérification auprès du prestataire), peuvent confirmer un paiement.

-- 1) Une même référence de paiement ne peut servir qu'une fois
create unique index if not exists payments_method_ref_uniq on public.payments(method, provider_ref) where provider_ref is not null;

-- 2) Modes de paiement : NatCash = manuel (le personnel confirme après réception) ; les réglages « enabled » ne sont PAS modifiés
update public.settings
   set value = value || jsonb_build_object('natcash', (value->'natcash') || '{"manual": true, "instructions": ""}'::jsonb)
 where key = 'payment_methods' and value ? 'natcash' and not (value->'natcash' ? 'manual');

-- 3) Confirmation d'un paiement (service_role uniquement) — idempotente
create or replace function public.confirm_payment(p_order_id uuid, p_method text, p_provider_ref text) returns text
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if o.payment_method <> p_method or p_method not in ('card','paypal','moncash') then raise exception 'METHOD_MISMATCH'; end if;
  if p_provider_ref is null or char_length(p_provider_ref) < 3 or char_length(p_provider_ref) > 200 then raise exception 'REF_REQUIRED'; end if;
  if o.payment_status = 'paid' then return 'already_paid'; end if;
  update public.payments set provider_ref = p_provider_ref where order_id = o.id and method = o.payment_method;
  if o.status = 'cancelled' then
    -- Paiement reçu après annulation (ex. expiration) : rien n'est perdu, le personnel est alerté pour rembourser ou rouvrir.
    perform public.notify_admins('payment_needs_refund', 'Paiement reçu sur commande annulée #' || o.order_number, 'Référence ' || p_provider_ref || ' — à rembourser', '/admin/#orders');
    insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
    values (null, 'système', 'payment_on_cancelled_order', 'orders', o.id::text, jsonb_build_object('order_number', o.order_number, 'method', p_method));
    return 'needs_refund';
  end if;
  update public.orders set payment_status = 'paid' where id = o.id;   -- le trigger sync_payment_status met payments.status = 'paid'
  insert into public.notifications(user_id, audience, type, title, body, link)
  values (o.user_id, 'customer', 'payment_paid', 'Paiement reçu pour la commande ' || o.order_number, 'Merci ! Votre paiement a bien été reçu.', '/orders');
  perform public.notify_admins('payment_paid', 'Paiement reçu #' || o.order_number, 'Mode : ' || p_method || ' — ' || o.total, '/admin/#orders');
  insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
  values (null, 'système', 'payment_received', 'orders', o.id::text, jsonb_build_object('order_number', o.order_number, 'method', p_method, 'total', o.total));
  return 'paid';
end $$;
revoke all on function public.confirm_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.confirm_payment(uuid, text, text) to service_role;

-- 4) Échec de paiement (service_role uniquement) : la commande reste, le client peut réessayer
create or replace function public.mark_payment_failed(p_order_id uuid, p_method text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.orders set payment_status = 'failed' where id = p_order_id and payment_method = p_method and payment_status = 'pending' and status = 'new';
end $$;
revoke all on function public.mark_payment_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_payment_failed(uuid, text) to service_role;

-- 5) Annulation automatique des commandes en ligne NON payées (libère le stock réservé) — tâche planifiée (service_role uniquement)
create or replace function public.cancel_unpaid_orders(p_minutes int default 60) returns int
language plpgsql security definer set search_path = public as $$
declare o public.orders; it record; v_var public.product_variants; n int := 0;
begin
  if p_minutes is null or p_minutes < 15 then raise exception 'INVALID_DELAY'; end if;
  for o in select * from public.orders
           where payment_method in ('card','paypal','moncash') and payment_status in ('pending','failed') and status = 'new'
             and created_at < now() - make_interval(mins => p_minutes)
           order by created_at for update skip locked loop
    for it in select variant_id, product_id, quantity from public.order_items where order_id = o.id and variant_id is not null order by variant_id loop
      select * into v_var from public.product_variants where id = it.variant_id for update;
      if not found then continue; end if;
      update public.product_variants set reserved_quantity = greatest(reserved_quantity - it.quantity, 0) where id = it.variant_id;
      insert into public.inventory_movements(product_id, variant_id, type, stock_delta, reserved_delta, stock_after, reserved_after, reason, order_id, created_by)
      values (it.product_id, it.variant_id, 'release', 0, -it.quantity, v_var.stock_quantity, greatest(v_var.reserved_quantity - it.quantity, 0), 'Paiement non reçu ' || o.order_number, o.id, null);
    end loop;
    update public.orders set status = 'cancelled', payment_status = 'failed' where id = o.id;
    insert into public.notifications(user_id, audience, type, title, body, link)
    values (o.user_id, 'customer', 'order_cancelled', 'Commande ' || o.order_number || ' annulée : paiement non reçu', 'Vous pouvez repasser commande à tout moment.', '/orders');
    insert into public.audit_logs(user_id, user_email, action, entity, entity_id, details)
    values (null, 'système', 'order_auto_cancelled', 'orders', o.id::text, jsonb_build_object('order_number', o.order_number, 'reason', 'unpaid'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cancel_unpaid_orders(int) from public, anon, authenticated;
grant execute on function public.cancel_unpaid_orders(int) to service_role;
