-- JLODNA Plas — tests automatisés SQL (RLS, rôles, stock, commandes, avis).
-- ⚠ À exécuter UNIQUEMENT sur une base de TEST (projet Supabase jetable ou base locale) : le script crée des utilisateurs
--   factices dans auth.users et des commandes. Prérequis : schema → functions → triggers → policies → seed déjà exécutés,
--   et AUCUN admin existant (le test vérifie la création de l'admin initial).
-- Résultat attendu : que des lignes "PASS", aucune "FAIL".  Lancer :  psql "$DATABASE_URL" -f supabase/tests/tests.sql 2>&1 | grep -E "PASS|FAIL"
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

-- ===== Préparation (superutilisateur) =====
select set_config('t.ship', '{"full_name":"Marie J","phone":"50900000","email":"c1@test.com","address":"Rue 1","city":"PAP","department":"Ouest"}', false);
select set_config('t.noir',  (select id::text from product_variants where sku='DEMO-001-NOIR'), false);
select set_config('t.blanc', (select id::text from product_variants where sku='DEMO-001-BLANC'), false);
select set_config('t.xl',    (select id::text from product_variants where sku='DEMO-003-XL'), false);
select set_config('t.m',     (select id::text from product_variants where sku='DEMO-003-M'), false);
select set_config('t.lampe', (select id::text from product_variants where sku='DEMO-002-STD'), false);
select set_config('t.prod_ecou', (select id::text from products where slug='demo-ecouteurs'), false);
insert into coupons(code,type,value) values ('BIENVENUE','percent',10);

insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000f1','jlodnaplas@gmail.com',null);
select pg_temp.ok('ADMIN: email admin NON confirmé => aucun rôle', not exists (select 1 from admin_roles));
update auth.users set email_confirmed_at = now() where id='00000000-0000-0000-0000-0000000000f1';
select pg_temp.ok('ADMIN: email confirmé => SUPER_ADMIN', exists (select 1 from admin_roles where user_id='00000000-0000-0000-0000-0000000000f1' and role='SUPER_ADMIN'));
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000e1','editor@test.com',now()),('00000000-0000-0000-0000-0000000000b1','support@test.com',now()),
 ('00000000-0000-0000-0000-0000000000c1','c1@test.com',now()),('00000000-0000-0000-0000-0000000000c2','c2@test.com',now());
insert into admin_roles(user_id, role) values ('00000000-0000-0000-0000-0000000000e1','EDITOR'),('00000000-0000-0000-0000-0000000000b1','SUPPORT');

-- ===== VISITEUR (anon) =====
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok('ANON: voit les produits publiés (4)', (select count(*) from products) = 4);
select pg_temp.ok('ANON: voit les variantes actives (8)', (select count(*) from product_variants) = 8);
select pg_temp.err('select count(*) from orders', 'permission denied', 'ANON: orders interdit');
select pg_temp.err('select count(*) from payments', 'permission denied', 'ANON: payments interdit');
select pg_temp.err('select count(*) from coupons', 'permission denied', 'ANON: coupons interdit');
select pg_temp.err('select count(*) from audit_logs', 'permission denied', 'ANON: audit_logs interdit');
select pg_temp.err($$select public.create_order('[]'::jsonb,'{}'::jsonb,null,'cod')$$, 'AUTH_REQUIRED', 'ANON: create_order refusé (non connecté)');

-- ===== CLIENT 1 =====
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok('CLIENT: ne voit aucun coupon', (select count(*) from coupons) = 0);
select pg_temp.ok('CLIENT: ne voit aucun audit', (select count(*) from audit_logs) = 0);
select pg_temp.ok('CLIENT: ne voit que son profil', (select count(*) from profiles) = 1);
select pg_temp.ok('CLIENT: ne voit aucun rôle admin', (select count(*) from admin_roles) = 0);
select pg_temp.ok('CLIENT: ne voit pas les mouvements de stock', (select count(*) from inventory_movements) = 0);
update products set price = 1;
reset role; select pg_temp.ok('CLIENT: modifier un produit n''a aucun effet (RLS)', not exists (select 1 from products where price = 1));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.err($$update product_variants set stock_quantity = 9999$$, 'permission denied', 'CLIENT: modifier le stock interdit');
select pg_temp.err($$insert into product_variants(product_id,name) select id,'x' from products limit 1$$, 'permission denied', 'CLIENT: créer une variante interdit');
select pg_temp.err($$select public.admin_set_variant_stock(current_setting('t.noir')::uuid, 999)$$, 'FORBIDDEN', 'CLIENT: admin_set_variant_stock interdit');
select pg_temp.err($$select public.admin_save_variants(current_setting('t.prod_ecou')::uuid, '[{"name":"x"}]')$$, 'FORBIDDEN', 'CLIENT: admin_save_variants interdit');
select pg_temp.err($$update orders set status='delivered'$$, 'permission denied', 'CLIENT: modifier une commande interdit');
select pg_temp.err($$select public.set_order_status(gen_random_uuid(),'confirmed')$$, 'FORBIDDEN', 'CLIENT: set_order_status interdit');
select pg_temp.err($$insert into notifications(user_id,type,title) values (auth.uid(),'x','faux')$$, 'permission denied', 'CLIENT: fabriquer une notification interdit');

-- Commande 1 : 2 × Écouteurs Noir (stock 12) avec coupon 10 %
select (public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.noir'), 'quantity', 2)), current_setting('t.ship')::jsonb, 'BIENVENUE', 'cod'))->>'order_number' as n1 \gset
select pg_temp.ok('COMMANDE: numéro JLD-000001', :'n1' = 'JLD-000001');
select set_config('t.o1', (select id::text from orders where order_number='JLD-000001'), false);
reset role;
select pg_temp.ok('STOCK: après création stock=12, réservé=2, disponible=10', (select (stock_quantity, reserved_quantity, available_quantity) = (12,2,10) from product_variants where id = current_setting('t.noir')::uuid));
select pg_temp.ok('STOCK: mouvement "reserve" enregistré', exists (select 1 from inventory_movements where type='reserve' and reserved_delta=2 and order_id = current_setting('t.o1')::uuid));
select pg_temp.ok('PAIEMENT: ligne payments en attente créée', exists (select 1 from payments where order_id = current_setting('t.o1')::uuid and status='pending' and method='cod'));
select pg_temp.ok('COUPON: usage enregistré + compteur +1', (select count(*) from coupon_usages) = 1 and (select used_count from coupons) = 1);
select pg_temp.ok('PRIX: sous-total 2×1990 recalculé serveur, remise 10 %', (select (subtotal, discount) = (3980, 398) from orders where id = current_setting('t.o1')::uuid));
select pg_temp.ok('ORDER_ITEMS: variante identifiée (id + nom + attributs)', exists (select 1 from order_items where order_id = current_setting('t.o1')::uuid and variant_id = current_setting('t.noir')::uuid and variant_name='Noir' and variant->>'Couleur'='Noir' and sku='DEMO-001-NOIR'));
select pg_temp.ok('NOTIF: le client a été notifié', exists (select 1 from notifications where user_id='00000000-0000-0000-0000-0000000000c1' and type='order_new'));
select pg_temp.ok('NOTIF: l''admin a reçu "Nouvelle commande #JLD-000001"', exists (select 1 from notifications where user_id='00000000-0000-0000-0000-0000000000f1' and title='Nouvelle commande #JLD-000001'));

-- Refus de survente et atomicité
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.err($$select public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.noir'), 'quantity', 11)), current_setting('t.ship')::jsonb, null, 'cod')$$, 'OUT_OF_STOCK', 'STOCK: 11 demandés > 10 disponibles refusé');
select pg_temp.err($$select public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.noir'), 'quantity', 6), jsonb_build_object('variant_id', current_setting('t.noir'), 'quantity', 5)), current_setting('t.ship')::jsonb, null, 'cod')$$, 'OUT_OF_STOCK', 'STOCK: lignes dupliquées cumulées (6+5>10) refusées');
select pg_temp.err($$select public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.blanc'), 'quantity', 1), jsonb_build_object('variant_id', current_setting('t.xl'), 'quantity', 1)), current_setting('t.ship')::jsonb, null, 'cod')$$, 'OUT_OF_STOCK', 'STOCK: variante épuisée (XL) refuse tout le panier');
select pg_temp.err($$select public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.blanc'), 'quantity', 1)), current_setting('t.ship')::jsonb, null, 'moncash')$$, 'PAYMENT_METHOD_UNAVAILABLE', 'PAIEMENT: méthode non configurée refusée');
select pg_temp.err($$select public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.blanc'), 'quantity', 1)), current_setting('t.ship')::jsonb, 'FAUX', 'cod')$$, 'COUPON_INVALID', 'COUPON: code invalide refusé');
select pg_temp.err($$select public.create_order(jsonb_build_array(jsonb_build_object('variant_id', gen_random_uuid(), 'quantity', 1)), current_setting('t.ship')::jsonb, null, 'cod')$$, 'VARIANT_UNAVAILABLE', 'COMMANDE: variante inconnue refusée');
reset role;
select pg_temp.ok('ATOMICITÉ: aucune réservation fantôme après erreurs (blanc=0, noir=2)', (select reserved_quantity from product_variants where id=current_setting('t.blanc')::uuid) = 0 and (select reserved_quantity from product_variants where id=current_setting('t.noir')::uuid) = 2);
select pg_temp.ok('ATOMICITÉ: toujours 1 seule commande', (select count(*) from orders) = 1);

-- Variante désactivée / produit non publié
update product_variants set status='disabled' where id = current_setting('t.lampe')::uuid;
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.err($$select public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.lampe'), 'quantity', 1)), current_setting('t.ship')::jsonb, null, 'cod')$$, 'VARIANT_UNAVAILABLE', 'STOCK: variante désactivée refusée');
reset role; update product_variants set status='active' where id = current_setting('t.lampe')::uuid;
update products set status='draft' where slug='demo-lampe-led';
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.err($$select public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.lampe'), 'quantity', 1)), current_setting('t.ship')::jsonb, null, 'cod')$$, 'PRODUCT_UNAVAILABLE', 'STOCK: produit non publié refusé');
select pg_temp.ok('CLIENT: ne voit plus le produit non publié', (select count(*) from products where slug='demo-lampe-led') = 0);
reset role; update products set status='published' where slug='demo-lampe-led';

-- ===== CLIENT 2 : isolation =====
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select pg_temp.ok('ISOLATION: client 2 ne voit aucune commande', (select count(*) from orders) = 0);
select pg_temp.ok('ISOLATION: client 2 ne voit aucune ligne de commande', (select count(*) from order_items) = 0);
select pg_temp.ok('ISOLATION: client 2 ne voit aucun paiement', (select count(*) from payments) = 0);
select pg_temp.ok('ISOLATION: client 2 ne voit aucune notification', (select count(*) from notifications) = 0);
select pg_temp.ok('ISOLATION: client 2 ne voit aucune adresse/panier d''autrui', (select count(*) from addresses) = 0 and (select count(*) from cart_items) = 0);
select pg_temp.err($$update payments set status='paid'$$, 'permission denied', 'ISOLATION: client ne peut pas modifier un paiement');

-- ===== AVIS =====
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.err($$insert into reviews(product_id,user_id,author_name,rating,comment,status) values (current_setting('t.prod_ecou')::uuid, auth.uid(), 'Marie', 5, 'top', 'approved')$$, 'permission denied', 'AVIS: client ne peut pas s''auto-approuver à l''insertion');
insert into reviews(product_id,user_id,author_name,rating,comment) values (current_setting('t.prod_ecou')::uuid, auth.uid(), 'Marie', 5, 'Très bien');
select pg_temp.ok('AVIS: créé avec statut pending', (select status from reviews where user_id = auth.uid()) = 'pending');
update reviews set status='approved' where user_id = auth.uid();
reset role; select pg_temp.ok('AVIS: client ne peut pas modifier le statut (RLS)', (select status from reviews where user_id='00000000-0000-0000-0000-0000000000c1') = 'pending');
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select pg_temp.err($$insert into reviews(product_id,user_id,author_name,rating) values (current_setting('t.prod_ecou')::uuid, auth.uid(), 'Marie', 4)$$, 'duplicate', 'AVIS: un seul avis par client et par produit');
select pg_temp.err($$insert into reviews(product_id,user_id,author_name,rating) values (current_setting('t.prod_ecou')::uuid, '00000000-0000-0000-0000-0000000000c2', 'Usurpé', 4)$$, 'row-level security', 'AVIS: impossible d''écrire au nom d''un autre');
select pg_temp.ok('AVIS: l''auteur voit son avis en attente', (select count(*) from reviews) = 1);
set role anon; select pg_temp.login(null);
select pg_temp.ok('AVIS: un avis PENDING n''est PAS public', (select count(*) from reviews) = 0);
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select pg_temp.ok('AVIS: un autre client ne voit pas l''avis pending', (select count(*) from reviews) = 0);
reset role;
select pg_temp.ok('AVIS: l''admin est notifié du nouvel avis', exists (select 1 from notifications where user_id='00000000-0000-0000-0000-0000000000f1' and type='new_review'));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000b1'); -- SUPPORT (reviews.moderate)
update reviews set status='rejected';
set role anon; select pg_temp.login(null);
select pg_temp.ok('AVIS: un avis REJECTED n''est PAS public', (select count(*) from reviews) = 0);
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
update reviews set status='approved';
set role anon; select pg_temp.login(null);
select pg_temp.ok('AVIS: un avis APPROVED devient public', (select count(*) from reviews) = 1);
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
delete from reviews;
reset role; select pg_temp.ok('AVIS: un autre client ne peut pas supprimer', (select count(*) from reviews) = 1);
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e1'); -- EDITOR : pas reviews.moderate
update reviews set status='rejected';
reset role; select pg_temp.ok('AVIS: EDITOR ne peut pas modérer', (select status from reviews) = 'approved');

-- ===== RÔLES =====
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok('EDITOR: ne voit pas les commandes', (select count(*) from orders) = 0);
select pg_temp.ok('EDITOR: ne voit pas les coupons', (select count(*) from coupons) = 0);
select pg_temp.ok('EDITOR: ne voit pas les paiements', (select count(*) from payments) = 0);
select pg_temp.err($$select public.set_order_status((select id from orders limit 1),'confirmed')$$, 'FORBIDDEN', 'EDITOR: changer un statut interdit');
select pg_temp.err($$select public.admin_set_variant_stock(current_setting('t.noir')::uuid, 50)$$, 'FORBIDDEN', 'EDITOR: ajuster le stock interdit');
update products set description = 'maj' where slug='demo-creme';
reset role; select pg_temp.ok('EDITOR: peut modifier un produit', (select description from products where slug='demo-creme') = 'maj');
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select public.admin_save_variants(current_setting('t.prod_ecou')::uuid, (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'attributes', attributes, 'stock_quantity', 999, 'price', price, 'sale_price', sale_price, 'sku', sku)) from product_variants where product_id = current_setting('t.prod_ecou')::uuid));
reset role;
select pg_temp.ok('EDITOR: admin_save_variants ignore le stock sans droit inventory.write', (select stock_quantity from product_variants where id = current_setting('t.noir')::uuid) = 12);
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000b1'); -- SUPPORT
select pg_temp.ok('SUPPORT: voit les commandes', (select count(*) from orders) = 1);
update products set price = 1;
reset role; select pg_temp.ok('SUPPORT: modifier un produit n''a aucun effet (RLS)', not exists (select 1 from products where price = 1));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok('SUPPORT: ne voit pas les coupons', (select count(*) from coupons) = 0);
select pg_temp.err($$select public.admin_set_variant_stock(current_setting('t.noir')::uuid, 50)$$, 'FORBIDDEN', 'SUPPORT: ajuster le stock interdit');

-- ===== CYCLE DE COMMANDE ET STOCK (admin) =====
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select public.set_order_status(current_setting('t.o1')::uuid, 'confirmed');
reset role;
select pg_temp.ok('CONFIRMATION: la réservation est conservée (12 / 2 / 10)', (select (stock_quantity, reserved_quantity, available_quantity) = (12,2,10) from product_variants where id=current_setting('t.noir')::uuid));
select pg_temp.ok('NOTIF: client notifié "Votre commande JLD-000001 a été confirmée."', exists (select 1 from notifications where user_id='00000000-0000-0000-0000-0000000000c1' and title='Votre commande JLD-000001 a été confirmée.'));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select pg_temp.err($$select public.set_order_status(current_setting('t.o1')::uuid, 'new')$$, 'INVALID_TRANSITION', 'STATUT: retour en arrière refusé');
select public.set_order_status(current_setting('t.o1')::uuid, 'delivered');
reset role;
select pg_temp.ok('LIVRAISON: stock sorti (10 / 0 / 10)', (select (stock_quantity, reserved_quantity, available_quantity) = (10,0,10) from product_variants where id=current_setting('t.noir')::uuid));
select pg_temp.ok('LIVRAISON: mouvement "sale" + ventes du produit +2', exists (select 1 from inventory_movements where type='sale' and stock_delta=-2) and (select sold_count from products where slug='demo-ecouteurs') = 2);
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select pg_temp.err($$select public.set_order_status(current_setting('t.o1')::uuid, 'cancelled')$$, 'ORDER_FINAL', 'STATUT: commande livrée définitive (annulation refusée)');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
-- Commande 2 puis annulation
select (public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.m'), 'quantity', 4)), current_setting('t.ship')::jsonb, null, 'cod'))->>'order_number' as n2 \gset
select set_config('t.o2', (select id::text from orders where order_number = :'n2'), false);
reset role;
select pg_temp.ok('COMMANDE 2: réservé=4 sur T-shirt M (15 → dispo 11)', (select (stock_quantity, reserved_quantity, available_quantity) = (15,4,11) from product_variants where id=current_setting('t.m')::uuid));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select public.set_order_status(current_setting('t.o2')::uuid, 'cancelled');
reset role;
select pg_temp.ok('ANNULATION: réservation libérée (15 / 0 / 15)', (select (stock_quantity, reserved_quantity, available_quantity) = (15,0,15) from product_variants where id=current_setting('t.m')::uuid));
select pg_temp.ok('ANNULATION: mouvement "release" + client notifié', exists (select 1 from inventory_movements where type='release' and reserved_delta=-4) and exists (select 1 from notifications where title like '%a été annulée.' and user_id='00000000-0000-0000-0000-0000000000c1'));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select pg_temp.err($$select public.set_order_status(current_setting('t.o2')::uuid, 'confirmed')$$, 'ORDER_FINAL', 'STATUT: commande annulée définitive');

-- ===== STOCK ADMIN, ALERTES, GARDE-FOUS =====
-- Réserver 9 sur Noir (dispo 10) pour tester stock < réservé et alerte stock faible (seuil 5)
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select (public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.noir'), 'quantity', 7)), current_setting('t.ship')::jsonb, null, 'cod'))->>'order_number' as n3 \gset
select set_config('t.o3', (select id::text from orders where order_number = :'n3'), false);
reset role;
select pg_temp.ok('ALERTE: stock faible (3 disponibles ≤ 5) notifié à l''admin', exists (select 1 from notifications where type='low_stock' and user_id='00000000-0000-0000-0000-0000000000f1' and body like '%possède seulement 3 unité%'));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select pg_temp.err($$select public.admin_set_variant_stock(current_setting('t.noir')::uuid, 5)$$, 'STOCK_BELOW_RESERVED', 'STOCK: stock < réservé refusé');
select public.admin_set_variant_stock(current_setting('t.noir')::uuid, 30, 'Réapprovisionnement');
reset role;
select pg_temp.ok('STOCK: ajustement admin (30 / 7 / 23) + mouvement + audit', (select (stock_quantity, reserved_quantity, available_quantity) = (30,7,23) from product_variants where id=current_setting('t.noir')::uuid) and exists (select 1 from inventory_movements where type='adjust' and stock_delta=20) and exists (select 1 from audit_logs where action='stock_change'));
select pg_temp.err($$delete from product_variants where id = current_setting('t.noir')::uuid$$, 'VARIANT_HAS_RESERVATIONS', 'GARDE-FOU: suppression d''une variante réservée refusée');
-- épuisement : réserver tout le disponible de XL impossible (0) ; épuiser Blanc (8)
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.create_order(jsonb_build_array(jsonb_build_object('variant_id', current_setting('t.blanc'), 'quantity', 8)), current_setting('t.ship')::jsonb, null, 'cod');
reset role;
select pg_temp.ok('ALERTE: rupture (0 disponible) notifiée', exists (select 1 from notifications where type='out_of_stock' and user_id='00000000-0000-0000-0000-0000000000f1'));
select pg_temp.err($$update products set status='published' where false$$, 'zzz', 'neutre') where false;
insert into products(name, slug, price, status) values ('Sans variante','sans-variante',100,'draft');
select pg_temp.err($$update products set status='published' where slug='sans-variante'$$, 'NO_VARIANT', 'GARDE-FOU: publier un produit sans variante active refusé');

-- ===== AUDIT / PAIEMENT ADMIN =====
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
update orders set payment_status='paid' where order_number='JLD-000001';
reset role;
select pg_temp.ok('PAIEMENT: payments.status synchronisé avec la commande', (select status from payments where order_id=current_setting('t.o1')::uuid) = 'paid');
select pg_temp.ok('AUDIT: changement de statut et stock journalisés', (select count(*) from audit_logs where action in ('order_status_change','stock_change')) >= 4);
select pg_temp.ok('AUDIT: ventes client NON journalisées comme actions admin', not exists (select 1 from audit_logs where user_email = 'c1@test.com'));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select pg_temp.ok('ADMIN: voit les commandes, paiements, coupons, audit', (select count(*) from orders) = 4 and (select count(*) from payments) = 4 and (select count(*) from coupons) = 1 and (select count(*) from audit_logs) > 0);
select pg_temp.ok('ADMIN: statistiques disponibles', (public.admin_stats()->>'orders')::int = 4);
reset role;
\echo === FIN DES TESTS ===
