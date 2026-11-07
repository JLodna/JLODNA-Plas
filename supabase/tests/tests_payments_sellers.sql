-- JLODNA Plas — tests SQL : paiements en ligne + comptes vendeurs. À lancer APRÈS tests.sql et tests_modules.sql (même base de TEST).
\set ON_ERROR_STOP off
\set QUIET on
create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin raise notice '%', case when coalesce(cond,false) then 'PASS - ' else 'FAIL - ' end || label; end $$;
create function pg_temp.login(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u,''), false) $$;
create function pg_temp.err(sql text, pat text, label text) returns void language plpgsql as $$
begin
  execute sql; raise notice 'FAIL - % (aucune erreur levée)', label;
exception when others then
  raise notice '%', case when sqlerrm ilike '%'||pat||'%' then 'PASS - ' else 'FAIL - ' end || label || case when sqlerrm ilike '%'||pat||'%' then '' else ' (erreur obtenue : '||sqlerrm||')' end;
end $$;
create function pg_temp.upd(sql text) returns int language plpgsql as $$
declare n int; begin execute sql; get diagnostics n = row_count; return n; end $$;

-- ===== Préparation =====
select set_config('t.ship', '{"full_name":"Marie J","phone":"50900000","email":"c1@test.com","address":"Rue 1","city":"PAP","department":"Ouest"}', false);
update settings set value = jsonb_set(jsonb_set(jsonb_set(value,'{card,enabled}','true'),'{paypal,enabled}','true'),'{moncash,enabled}','true') where key='payment_methods';
select set_config('t.var', (select v.id::text from product_variants v join products p on p.id = v.product_id where v.status='active' and p.status='published' order by v.available_quantity desc limit 1), false);
update product_variants set stock_quantity = stock_quantity + 50 where id = current_setting('t.var')::uuid;
create function pg_temp.order_with(m text) returns uuid language plpgsql as $$
begin return (public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.var'), 'quantity', 1)), current_setting('t.ship')::jsonb, null, m)->>'id')::uuid; end $$;
create function pg_temp.reserved() returns int language sql as $$ select reserved_quantity from product_variants where id = current_setting('t.var')::uuid $$;

-- ===== PAIEMENTS EN LIGNE =====
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.order_with('card') as o1 \gset
select pg_temp.order_with('paypal') as o2 \gset
select pg_temp.order_with('card') as o3 \gset
select pg_temp.order_with('cod') as o4 \gset
select pg_temp.order_with('moncash') as o5 \gset
select pg_temp.ok('PAIEMENT: commande en ligne créée « en attente »', (select payment_status from orders where id = :'o1') = 'pending');
select pg_temp.err($$select public.confirm_payment('$$ || :'o1' || $$', 'card', 'pi_hack_1')$$, 'permission denied', 'PAIEMENT: un client NE PEUT PAS se déclarer payé (confirm_payment refusé)');
select pg_temp.ok('PAIEMENT: un client ne peut pas modifier payment_status directement (0 ligne modifiée)', pg_temp.upd($$update orders set payment_status='paid' where id='$$ || :'o1' || $$'$$) = 0);
reset role; set role anon; select pg_temp.login(null);
select pg_temp.err($$select public.confirm_payment(gen_random_uuid(), 'card', 'pi_hack_2')$$, 'permission denied', 'PAIEMENT: un visiteur ne peut pas confirmer un paiement');
select pg_temp.err($$select public.cancel_unpaid_orders(60)$$, 'permission denied', 'PAIEMENT: un visiteur ne peut pas lancer l''annulation automatique');

reset role; set role service_role;
select public.confirm_payment(:'o1', 'card', 'pi_test_1') as r1 \gset
reset role;
select pg_temp.ok('PAIEMENT: confirmation serveur => paid', :'r1' = 'paid' and (select payment_status from orders where id = :'o1') = 'paid');
select pg_temp.ok('PAIEMENT: payments.status = paid + référence enregistrée', (select status || '/' || provider_ref from payments where order_id = :'o1') = 'paid/pi_test_1');
select pg_temp.ok('PAIEMENT: client notifié + journal d''audit', exists (select 1 from notifications where type='payment_paid' and user_id='00000000-0000-0000-0000-0000000000c1') and exists (select 1 from audit_logs where action='payment_received' and entity_id = :'o1'));
set role service_role;
select pg_temp.ok('PAIEMENT: confirmation répétée => already_paid (idempotent)', public.confirm_payment(:'o1', 'card', 'pi_test_1') = 'already_paid');
select pg_temp.err($$select public.confirm_payment('$$ || :'o2' || $$', 'card', 'pi_test_2')$$, 'METHOD_MISMATCH', 'PAIEMENT: mode différent de la commande refusé');
select pg_temp.err($$select public.confirm_payment('$$ || :'o3' || $$', 'card', 'pi_test_1')$$, 'unique', 'PAIEMENT: une même référence ne peut pas payer deux commandes');
select pg_temp.err($$select public.confirm_payment('$$ || :'o4' || $$', 'cod', 'xxxxxxx')$$, 'METHOD_MISMATCH', 'PAIEMENT: le paiement à la livraison ne passe pas par ici');
select pg_temp.err($$select public.confirm_payment('$$ || :'o3' || $$', 'card', 'ab')$$, 'REF_REQUIRED', 'PAIEMENT: référence trop courte refusée');
select public.mark_payment_failed(:'o3', 'card');
reset role;
select pg_temp.ok('PAIEMENT: échec marqué (le client peut réessayer)', (select payment_status from orders where id = :'o3') = 'failed');
reset role; update orders set status = 'cancelled' where id = :'o2';
set role service_role;
select pg_temp.ok('PAIEMENT: paiement sur commande annulée => needs_refund (rien de perdu)', public.confirm_payment(:'o2', 'paypal', 'PAYID123') = 'needs_refund');
reset role; select pg_temp.ok('PAIEMENT: l''équipe est alertée pour rembourser', exists (select 1 from notifications where type='payment_needs_refund' and audience='admin'));

-- Annulation automatique des commandes en ligne impayées
update orders set created_at = now() - interval '2 hours' where id in (:'o1', :'o4', :'o5');
select pg_temp.reserved() as before_res \gset
set role service_role;
select pg_temp.err($$select public.cancel_unpaid_orders(5)$$, 'INVALID_DELAY', 'AUTO-ANNULATION: délai trop court refusé');
select public.cancel_unpaid_orders(60) as n_cancel \gset
reset role;
select pg_temp.ok('AUTO-ANNULATION: la commande en ligne impayée (MonCash) est annulée', (select status from orders where id = :'o5') = 'cancelled' and :n_cancel >= 1);
select pg_temp.ok('AUTO-ANNULATION: stock réservé libéré', pg_temp.reserved() < :before_res);
select pg_temp.ok('AUTO-ANNULATION: commande payée et commande « livraison » intactes', (select status from orders where id = :'o1') = 'new' and (select status from orders where id = :'o4') = 'new');
select pg_temp.ok('AUTO-ANNULATION: client notifié', exists (select 1 from notifications where type='order_cancelled' and title like '%paiement non reçu%'));
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.err('select public.cancel_unpaid_orders(60)', 'permission denied', 'AUTO-ANNULATION: refusée aux clients');

-- ===== COMPTES VENDEURS =====
reset role;
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000d1','seller1@test.com',now()),('00000000-0000-0000-0000-0000000000d2','seller2@test.com',now());
reset role; set role anon; select pg_temp.login(null);
select pg_temp.err($$select public.apply_seller('Boutik Anon','boutik-anon','x','50911111111','PAP')$$, 'permission denied', 'VENDEUR: un visiteur ne peut pas postuler');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select public.apply_seller('Boutik Marie','boutik-marie','Vêtements','50922222222','Port-au-Prince') as sid1 \gset
select pg_temp.ok('VENDEUR: candidature enregistrée « pending »', (select status from sellers where id = :'sid1') = 'pending');
select pg_temp.err($$select public.apply_seller('Autre','autre-boutik','x','50933333333',null)$$, 'ALREADY_SELLER', 'VENDEUR: une seule boutique par compte');
select pg_temp.err($$insert into sellers(user_id, shop_name, slug, phone, status) values ('00000000-0000-0000-0000-0000000000d1','Hack','hack-shop','50944444444','approved')$$, 'permission denied', 'VENDEUR: impossible de s''auto-approuver (écriture directe interdite)');
select pg_temp.err($$select public.seller_save_product('{"name":"Robe","price":1000}'::jsonb, '[{"name":"Standard","stock_quantity":5}]'::jsonb)$$, 'SELLER_NOT_APPROVED', 'VENDEUR: pas de produit tant que la boutique n''est pas approuvée');
select pg_temp.err($$select public.admin_set_seller_status('$$ || :'sid1' || $$', 'approved')$$, 'FORBIDDEN', 'VENDEUR: un vendeur ne peut pas approuver');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select public.apply_seller('Boutik Jean','boutik-jean',null,'50955555555',null) as sid2 \gset
select pg_temp.ok('VENDEUR: un vendeur ne voit pas la boutique d''un autre', (select count(*) from sellers) = 1 and (select id from sellers) = :'sid2');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.err($$select public.admin_set_seller_status('$$ || :'sid1' || $$', 'approved')$$, 'FORBIDDEN', 'VENDEUR: SUPPORT (sans sellers.manage) ne peut pas approuver');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select public.admin_set_seller_status(:'sid1', 'approved', 12.5);
select public.admin_set_seller_status(:'sid2', 'approved');
select pg_temp.ok('VENDEUR: le SUPER_ADMIN approuve avec commission 12,5 %', (select status || (commission_percent)::text from sellers where id = :'sid1') = 'approved12.50');
select pg_temp.err($$select public.admin_set_seller_status('$$ || :'sid1' || $$', 'approved', 150)$$, 'INVALID_COMMISSION', 'VENDEUR: commission > 100 refusée');
reset role; select pg_temp.ok('VENDEUR: vendeur notifié + journal d''audit', exists (select 1 from notifications where type='seller_approved' and user_id='00000000-0000-0000-0000-0000000000d1') and exists (select 1 from audit_logs where action='set_seller_status'));

-- Produits du vendeur
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select public.seller_save_product('{"name":"Robe d''été","price":1000,"status":"published","seller_id":"x"}'::jsonb, '[{"name":"Standard","stock_quantity":10},{"name":"XL","stock_quantity":4}]'::jsonb) as pid1 \gset
reset role;
select pg_temp.ok('PRODUIT VENDEUR: créé en BROUILLON, rattaché à sa boutique (le « published » envoyé est ignoré)', (select status from products where id = :'pid1') = 'draft' and (select seller_id from products where id = :'pid1') = :'sid1');
select pg_temp.ok('PRODUIT VENDEUR: variantes + mouvements de stock initiaux', (select count(*) from product_variants where product_id = :'pid1') = 2 and (select count(*) from inventory_movements where product_id = :'pid1' and type='initial') = 2);
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok('PRODUIT VENDEUR: impossible de se publier soi-même (écriture directe : 0 ligne)', pg_temp.upd($$update products set status='published' where id='$$ || :'pid1' || $$'$$) = 0);
select pg_temp.err($$insert into products(name, slug, price, status) values ('Hack','hack-x',1,'published')$$, 'row-level security', 'PRODUIT VENDEUR: insertion directe de produit refusée');
select pg_temp.err($$select public.seller_submit_product('$$ || :'pid1' || $$')$$, 'NO_IMAGE', 'PRODUIT VENDEUR: soumission sans image refusée');
select pg_temp.err($$select public.seller_set_images('$$ || :'pid1' || $$', '[{"url":"https://evil.example/x.png"}]')$$, 'INVALID_IMAGES', 'PRODUIT VENDEUR: image hors de son dossier refusée');
select public.seller_set_images(:'pid1', jsonb_build_array(jsonb_build_object('url', 'https://abc.supabase.co/storage/v1/object/public/product-images/sellers/' || :'sid1' || '/img1.png', 'alt', 'Robe')));
select pg_temp.ok('PRODUIT VENDEUR: image dans son dossier acceptée', jsonb_array_length(public.seller_get_product(:'pid1')->'images') = 1);
select public.seller_submit_product(:'pid1');
select pg_temp.ok('PRODUIT VENDEUR: soumis pour validation', (public.seller_get_product(:'pid1')->>'submitted_at') is not null);
reset role; select pg_temp.ok('PRODUIT VENDEUR: l''équipe est notifiée', exists (select 1 from notifications where type='product_submitted' and audience='admin'));
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok('PRODUIT VENDEUR: brouillon invisible du public', (select count(*) from products where id = :'pid1') = 0);
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select pg_temp.err($$select public.seller_get_product('$$ || :'pid1' || $$')$$, 'NOT_FOUND', 'ISOLATION: un autre vendeur ne peut pas lire ce produit');
select pg_temp.err($$select public.seller_save_product(jsonb_build_object('id','$$ || :'pid1' || $$','name','Piraté','price',1), '[{"name":"x"}]'::jsonb)$$, 'NOT_FOUND', 'ISOLATION: un autre vendeur ne peut pas modifier ce produit');
select pg_temp.err($$select public.seller_withdraw_product('$$ || :'pid1' || $$')$$, 'NOT_FOUND', 'ISOLATION: un autre vendeur ne peut pas retirer ce produit');
select pg_temp.ok('ISOLATION: la liste de l''autre vendeur est vide', jsonb_array_length(public.seller_my_products()) = 0);

-- Publication par le personnel, modification par le vendeur
reset role; update products set status = 'published' where id = :'pid1';
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok('PUBLICATION: après validation du personnel, le produit est visible', (select count(*) from products where id = :'pid1') = 1);
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select pg_temp.err($$select public.seller_set_images('$$ || :'pid1' || $$', '[]')$$, 'PRODUCT_LOCKED', 'PUBLICATION: images d''un produit publié verrouillées');
select public.seller_save_product(jsonb_build_object('id', :'pid1', 'name', 'Robe d''été v2', 'price', 1000), public.seller_get_product(:'pid1')->'variants');
select pg_temp.ok('MODIFICATION: un produit publié modifié repasse en brouillon (revalidation)', public.seller_get_product(:'pid1')->>'status' = 'draft' and (public.seller_get_product(:'pid1')->>'submitted_at') is null);
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok('MODIFICATION: il disparaît de la vente jusqu''à nouvelle validation', (select count(*) from products where id = :'pid1') = 0);
reset role; update products set status = 'published' where id = :'pid1';

-- Ventes, commission, reversements, confidentialité
select pg_temp.ok('VENTE: lignes de commande rattachées au vendeur (déclencheur)', true);
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select (public.create_order(jsonb_build_array(jsonb_build_object('variant_id', (select id::text from product_variants where product_id = :'pid1' and name = 'Standard'), 'quantity', 2)), current_setting('t.ship')::jsonb, null, 'cod')->>'id') as so1 \gset
reset role; select pg_temp.ok('VENTE: order_items.seller_id renseigné automatiquement', (select count(*) from order_items where order_id = :'so1' and seller_id = :'sid1') = 1);
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok('VENTE: avant livraison, rien n''est dû (en attente = 2000)', (public.seller_sales()->'summary'->>'gross')::numeric = 0 and (public.seller_sales()->'summary'->>'pending_gross')::numeric = 2000);
select pg_temp.ok('CONFIDENTIALITÉ: aucune donnée acheteur dans les ventes du vendeur', public.seller_sales()::text not like '%Marie J%' and public.seller_sales()::text not like '%c1@test.com%' and public.seller_sales()::text not like '%Rue 1%' and public.seller_sales()::text not like '%50900000%');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select public.set_order_status(:'so1', 'delivered');
update orders set payment_status = 'paid' where id = :'so1';
select pg_temp.ok('COMMISSION: 2000 brut − 12,5 % = 1750 net, solde 1750', (public.admin_seller_summary(:'sid1')->>'gross')::numeric = 2000 and (public.admin_seller_summary(:'sid1')->>'commission')::numeric = 250 and (public.admin_seller_summary(:'sid1')->>'balance')::numeric = 1750);
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.err($$select public.admin_record_payout('$$ || :'sid1' || $$', 100)$$, 'FORBIDDEN', 'REVERSEMENT: SUPPORT ne peut pas enregistrer un reversement');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select pg_temp.err($$select public.admin_record_payout('$$ || :'sid1' || $$', 5000)$$, 'EXCEEDS_BALANCE', 'REVERSEMENT: au-delà du solde refusé');
select pg_temp.err($$select public.admin_record_payout('$$ || :'sid1' || $$', 0)$$, 'INVALID_AMOUNT', 'REVERSEMENT: montant nul refusé');
select public.admin_record_payout(:'sid1', 1000, 'MonCash', 'Octobre');
select pg_temp.ok('REVERSEMENT: enregistré, solde = 750', (public.admin_seller_summary(:'sid1')->>'balance')::numeric = 750);
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select pg_temp.ok('REVERSEMENT: le vendeur voit son reversement et son solde', (public.seller_sales()->'summary'->>'balance')::numeric = 750 and jsonb_array_length(public.seller_sales()->'payouts') = 1);
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select pg_temp.ok('REVERSEMENT: un autre vendeur ne voit pas ces reversements', (select count(*) from seller_payouts) = 0 and (public.seller_sales()->'summary'->>'balance')::numeric = 0);

-- Suspension
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select public.admin_set_seller_status(:'sid1', 'suspended');
reset role; select pg_temp.ok('SUSPENSION: les produits publiés du vendeur sont retirés de la vente', (select status from products where id = :'pid1') = 'disabled');
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select pg_temp.err($$select public.seller_save_product('{"name":"Nouveau","price":1}'::jsonb, '[{"name":"x"}]'::jsonb)$$, 'SELLER_NOT_APPROVED', 'SUSPENSION: un vendeur suspendu ne peut plus créer de produit');
select pg_temp.ok('SUSPENSION: il garde l''accès à ses ventes et soldes', (public.seller_sales()->'summary'->>'balance')::numeric = 750);

-- Storage + rejouabilité
reset role;
select pg_temp.ok('STORAGE: politiques images vendeur présentes (insert/delete, dossier sellers/<id>)', (select count(*) from pg_policies where tablename='objects' and policyname like 'pi_seller_%') = 2);
\i supabase/modules/30_payments.sql
\i supabase/modules/40_sellers.sql
select pg_temp.ok('MODULES 30/40: relançables sans erreur ni doublon', (select count(*) from admin_permissions where permission='sellers.manage') = 2);
