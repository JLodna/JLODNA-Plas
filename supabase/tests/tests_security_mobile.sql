-- JLODNA Plas — tests SQL : limitation de requêtes, signalements, push, suppression de compte, 2FA admin.
-- À lancer APRÈS les autres fichiers de tests (même base de TEST).
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

reset role;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000e9','erase@test.com',now()), ('00000000-0000-0000-0000-0000000000e8','reporter@test.com',now()),
 ('00000000-0000-0000-0000-0000000000e7','owner@test.com',now()), ('00000000-0000-0000-0000-0000000000e6','seller-clean@test.com',now()),
 ('00000000-0000-0000-0000-0000000000e5','seller-paid@test.com',now());

-- ===== Limitation de requêtes =====
reset role; set role service_role;
select pg_temp.ok('LIMITE: 3 requêtes autorisées puis refus', public.rate_limit_hit('t:k1',3,60) and public.rate_limit_hit('t:k1',3,60) and public.rate_limit_hit('t:k1',3,60) and not public.rate_limit_hit('t:k1',3,60));
select pg_temp.ok('LIMITE: une autre clé n''est pas affectée', public.rate_limit_hit('t:k2',3,60));
reset role; update rate_limits set window_start = now() - interval '2 minutes' where key = 't:k1'; set role service_role;
select pg_temp.ok('LIMITE: la fenêtre expirée repart à zéro', public.rate_limit_hit('t:k1',3,60));
select pg_temp.err($$select public.rate_limit_hit('x', 0, 60)$$, 'INVALID', 'LIMITE: paramètres invalides refusés');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select pg_temp.err($$select public.rate_limit_hit('t:k3',3,60)$$, 'permission denied', 'LIMITE: refusée aux clients (impossible de la contourner/remettre à zéro)');
select pg_temp.err('select count(*) from rate_limits', 'permission denied', 'LIMITE: table illisible par les clients');
reset role; set role anon; select pg_temp.login(null);
select pg_temp.err($$insert into messages(name,email,body) values ('Spam','s@s.com','message spam')$$, 'permission denied', 'CONTACT: insertion directe par un visiteur interdite (passe par /api/contact)');

-- ===== Signalements =====
reset role;
insert into bio_profiles(user_id, slug, display_name, is_public) values ('00000000-0000-0000-0000-0000000000e7','profil-public','Profil Public',true),('00000000-0000-0000-0000-0000000000e6','profil-prive','Profil Privé',false);
select id as prod_id from products where status='published' limit 1 \gset
reset role; set role anon; select pg_temp.login(null);
select pg_temp.err($$select public.submit_report('bio','profil-public','spam',null)$$, 'permission denied', 'SIGNALEMENT: un visiteur doit se connecter');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select public.submit_report('bio','Profil-Public','spam','Publicité répétée');
select pg_temp.ok('SIGNALEMENT: BIO signalé (insensible à la casse)', (select count(*) from (select 1 from reports where target_id='profil-public') x) = 0);
reset role; select pg_temp.ok('SIGNALEMENT: enregistré « open » avec le nom du profil', (select status||'/'||target_label from reports where target_id='profil-public') = 'open/Profil Public');
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select public.submit_report('bio','profil-public','spam',null);
reset role; select pg_temp.ok('SIGNALEMENT: doublon ignoré (pas de spam d''alertes)', (select count(*) from reports where target_id='profil-public') = 1);
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select pg_temp.err($$select public.submit_report('bio','profil-prive','spam',null)$$, 'NOT_FOUND', 'SIGNALEMENT: un profil privé n''est pas signalable (inexistant pour le public)');
select pg_temp.err($$select public.submit_report('bio','nexiste-pas','spam',null)$$, 'NOT_FOUND', 'SIGNALEMENT: cible inconnue refusée');
select pg_temp.err($$select public.submit_report('product','$$ || :'prod_id' || $$','nimporte',null)$$, 'violates', 'SIGNALEMENT: motif inconnu refusé');
select pg_temp.err($$select public.submit_report('seller','x','spam',null)$$, 'INVALID_TARGET', 'SIGNALEMENT: type inconnu refusé');
select public.submit_report('product', :'prod_id', 'fake', 'Fausse description');
select pg_temp.ok('SIGNALEMENT: produit publié signalable', true);
select pg_temp.ok('SIGNALEMENT: un client ne voit AUCUN signalement', (select count(*) from reports) = 0);
reset role; select pg_temp.ok('SIGNALEMENT: l''équipe est alertée', exists (select 1 from notifications where type='report' and audience='admin'));
insert into reports(reporter_id,target_type,target_id,reason,created_at) select '00000000-0000-0000-0000-0000000000e7','product',gen_random_uuid()::text,'spam',now() from generate_series(1,10);
update reports set reporter_id = '00000000-0000-0000-0000-0000000000e7' where reporter_id = '00000000-0000-0000-0000-0000000000e7';
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select pg_temp.err($$select public.submit_report('bio','profil-public','spam',null)$$, 'RATE_LIMITED', 'SIGNALEMENT: plafond de 10 signalements par jour');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok('SIGNALEMENT: SUPPORT (reports.manage) voit les signalements', (select count(*) from reports where target_id = 'profil-public') = 1);
select reports.id as rid from reports where target_id='profil-public' \gset
select public.admin_set_report_status(:'rid', 'actioned', true); -- SUPPORT possède bio.moderate : le blocage est appliqué
select reports.id as rid2 from reports where target_type='product' and reporter_id='00000000-0000-0000-0000-0000000000e8' \gset
select pg_temp.err($$select public.admin_set_report_status('$$ || :'rid2' || $$', 'actioned', true)$$, 'FORBIDDEN', 'SIGNALEMENT: sans products.write, impossible de retirer un produit');
select public.admin_set_report_status(:'rid2', 'dismissed', false);
reset role; select pg_temp.ok('SIGNALEMENT: rejeté = statut dismissed, produit intact', (select status from reports where id = :'rid2') = 'dismissed' and (select status from products where id = :'prod_id') = 'published');
select pg_temp.ok('SIGNALEMENT: BIO bloqué et dépublié après mesure', (select is_blocked and not is_public from bio_profiles where slug='profil-public'));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select pg_temp.err($$select public.admin_set_report_status('$$ || :'rid' || $$', 'dismissed', false)$$, 'FORBIDDEN', 'SIGNALEMENT: un client ne peut pas traiter les signalements');

-- ===== Jetons de notifications push =====
reset role; set role anon; select pg_temp.login(null);
select pg_temp.err($$select public.register_device_token('aaaaaaaaaaaaaaaaaaaaaaaaaaaa','android')$$, 'permission denied', 'PUSH: un visiteur ne peut pas enregistrer d''appareil');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select public.register_device_token('TOKEN-ABCDEFGHIJKLMNOPQRST-1','android');
select pg_temp.err('select count(*) from device_tokens', 'permission denied', 'PUSH: table des jetons illisible par les clients');
select pg_temp.err($$select public.register_device_token('court','android')$$, 'violates', 'PUSH: jeton trop court refusé');
select pg_temp.err($$select public.register_device_token('TOKEN-ABCDEFGHIJKLMNOPQRST-2','windows')$$, 'INVALID_PLATFORM', 'PUSH: plateforme inconnue refusée');
select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select public.register_device_token('TOKEN-ABCDEFGHIJKLMNOPQRST-1','android');
reset role; select pg_temp.ok('PUSH: sur téléphone partagé, le jeton suit le compte connecté', (select user_id from device_tokens where token='TOKEN-ABCDEFGHIJKLMNOPQRST-1') = '00000000-0000-0000-0000-0000000000e7');
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select public.unregister_device_token('TOKEN-ABCDEFGHIJKLMNOPQRST-1');
reset role; select pg_temp.ok('PUSH: on ne peut pas supprimer le jeton d''un autre compte', exists (select 1 from device_tokens where token='TOKEN-ABCDEFGHIJKLMNOPQRST-1'));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select public.register_device_token('TOKEN-ABCDEFGHIJKLMNOPQRST-X' || g, 'android') from generate_series(1, 12) g;
reset role; select pg_temp.ok('PUSH: maximum 10 appareils par compte', (select count(*) from device_tokens where user_id = '00000000-0000-0000-0000-0000000000e8') = 10);

-- ===== Suppression de compte complète =====
select set_config('t.ship', '{"full_name":"Erase Me","phone":"50977777","email":"erase@test.com","address":"Rue Secrète 9","city":"PAP","department":"Ouest"}', false);
select v.id::text as var from product_variants v join products p on p.id = v.product_id where v.status='active' and p.status='published' order by v.available_quantity desc limit 1 \gset
update product_variants set stock_quantity = stock_quantity + 20 where id = :'var';
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select (public.create_order(jsonb_build_array(jsonb_build_object('variant_id', :'var', 'quantity', 1)), current_setting('t.ship')::jsonb, null, 'cod')->>'id') as eo \gset
select public.submit_b2b_request('Erase Me',null,'50977777','erase@test.com','Haïti','quote','Riz',5,null,'Demande à effacer',null);
insert into bio_profiles(user_id, slug, display_name) values ('00000000-0000-0000-0000-0000000000e9','erase-bio','Erase Bio');
select public.register_device_token('TOKEN-ERASE-ABCDEFGHIJKLMNOP','android');
reset role;
insert into messages(name,email,body) values ('Erase','erase@test.com','Mon message de contact');
set role service_role;
select public.erase_user_data('00000000-0000-0000-0000-0000000000e9') as er \gset
reset role;
select pg_temp.ok('SUPPRESSION: commande conservée mais ANONYMISÉE et détachée', (select user_id is null and full_name = 'Client supprimé' and email = '' and phone = '' and address = '' and total > 0 from orders where id = :'eo'));
select pg_temp.ok('SUPPRESSION: lignes de commande (totaux) conservées', (select count(*) from order_items where order_id = :'eo') = 1);
select pg_temp.ok('SUPPRESSION: demandes B2B, BIO, jetons push et messages effacés', not exists (select 1 from b2b_requests where user_id = '00000000-0000-0000-0000-0000000000e9') and not exists (select 1 from bio_profiles where slug='erase-bio') and not exists (select 1 from device_tokens where token like 'TOKEN-ERASE%') and not exists (select 1 from messages where email='erase@test.com'));
select pg_temp.ok('SUPPRESSION: opération répétable (idempotente)', (public.erase_user_data('00000000-0000-0000-0000-0000000000e9') is not null));
select pg_temp.ok('SUPPRESSION: l''identité n''apparaît plus dans les commandes', not exists (select 1 from orders where full_name = 'Erase Me' or email = 'erase@test.com'));
set role service_role;
select pg_temp.err($$select public.erase_user_data('00000000-0000-0000-0000-0000000000f1')$$, 'ADMIN_ACCOUNT', 'SUPPRESSION: un compte administrateur ne peut pas être effacé en libre-service');
reset role;
insert into sellers(user_id, shop_name, slug, phone, status) values ('00000000-0000-0000-0000-0000000000e5','Boutik Payée','boutik-payee','50911111111','approved') returning id as sp \gset
insert into seller_payouts(seller_id, amount) values (:'sp', 100);
insert into sellers(user_id, shop_name, slug, phone, status) values ('00000000-0000-0000-0000-0000000000e6','Boutik Propre','boutik-propre','50922222222','approved') returning id as sc \gset
insert into products(name, slug, price, seller_id) values ('Produit propre','produit-propre-x',10,:'sc');
set role service_role;
select pg_temp.err($$select public.erase_user_data('00000000-0000-0000-0000-0000000000e5')$$, 'SELLER_RECORDS_EXIST', 'SUPPRESSION: vendeur avec reversements = traitement manuel (historique financier)');
select public.erase_user_data('00000000-0000-0000-0000-0000000000e6');
reset role;
select pg_temp.ok('SUPPRESSION: vendeur sans historique : boutique et produits supprimés', not exists (select 1 from sellers where id = :'sc') and not exists (select 1 from products where slug='produit-propre-x'));
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select pg_temp.err($$select public.erase_user_data('00000000-0000-0000-0000-0000000000e8')$$, 'permission denied', 'SUPPRESSION: fonction réservée au serveur (un client ne peut pas effacer un compte)');

-- ===== 2FA obligatoire pour l'administration (option) =====
reset role;
select pg_temp.ok('2FA: désactivée par défaut', (select (value->>'require_admin_mfa')::boolean from settings where key='security') = false);
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select pg_temp.ok('2FA désactivée: le SUPER_ADMIN garde ses droits', public.has_perm('products.write') and public.is_admin());
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok('SÉCURITÉ: un ADMIN ne peut pas désactiver la 2FA obligatoire (clé réservée au SUPER_ADMIN)', pg_temp.upd($$update settings set value='{"require_admin_mfa": false}' where key='security'$$) = 0);
reset role; update settings set value = '{"require_admin_mfa": true}' where key='security';
set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1'); select set_config('request.jwt.claims', '{"aal":"aal1"}', false);
select pg_temp.ok('2FA activée: session SANS 2e facteur => droits admin refusés', not public.has_perm('products.write') and not public.is_admin() and not public.has_perm('orders.write'));
select pg_temp.ok('2FA activée: un SUPER_ADMIN en aal1 ne peut plus modifier les paramètres', pg_temp.upd($$update settings set value=value where key='store'$$) = 0);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select pg_temp.ok('2FA activée: session AVEC 2e facteur (aal2) => droits rétablis', public.has_perm('products.write') and public.is_admin());
select pg_temp.ok('2FA activée: les clients ordinaires ne sont pas concernés', true);
select pg_temp.login('00000000-0000-0000-0000-0000000000c1'); select set_config('request.jwt.claims', '{"aal":"aal1"}', false);
select pg_temp.ok('2FA activée: un client garde l''accès à ses données', (select count(*) from orders) >= 1);
select pg_temp.login('00000000-0000-0000-0000-0000000000f1'); select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select pg_temp.ok('2FA: le SUPER_ADMIN (aal2) peut la désactiver', pg_temp.upd($$update settings set value='{"require_admin_mfa": false}' where key='security'$$) = 1);
select set_config('request.jwt.claims', '', false);
reset role;
select pg_temp.ok('2FA: remise à « désactivée » après les tests', (select (value->>'require_admin_mfa')::boolean from settings where key='security') = false);
\i supabase/modules/50_security_mobile.sql
select pg_temp.ok('MODULE 50: relançable sans erreur ni doublon', (select count(*) from admin_permissions where permission='reports.manage') = 3);
