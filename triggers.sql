-- JLODNA Plas — triggers (horodatage, audit, profils, alertes stock). Exécuter APRÈS functions.sql.

do $$ declare t text; begin
  foreach t in array array['profiles','products','orders','product_variants','settings'] loop
    execute format('drop trigger if exists trg_touch on public.%I; create trigger trg_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop; end $$;

do $$ declare t text; begin
  foreach t in array array['products','categories','coupons','settings','admin_roles','reviews'] loop
    execute format('drop trigger if exists trg_audit on public.%I; create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop; end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after insert or update of email_confirmed_at on auth.users
  for each row execute function public.grant_bootstrap_admin();

drop trigger if exists trg_inventory_alert on public.product_variants;
create trigger trg_inventory_alert after update on public.product_variants for each row execute function public.inventory_alert();

drop trigger if exists trg_sync_payment on public.orders;
create trigger trg_sync_payment after update of payment_status on public.orders for each row execute function public.sync_payment_status();
drop trigger if exists trg_touch_payments on public.payments;
create trigger trg_touch_payments before update on public.payments for each row execute function public.touch_updated_at();

drop trigger if exists trg_guard_variant_delete on public.product_variants;
create trigger trg_guard_variant_delete before delete on public.product_variants for each row execute function public.guard_variant_delete();
drop trigger if exists trg_guard_product_publish on public.products;
create trigger trg_guard_product_publish before update of status on public.products for each row execute function public.guard_product_publish();
drop trigger if exists trg_notify_new_review on public.reviews;
create trigger trg_notify_new_review after insert on public.reviews for each row execute function public.notify_new_review();
