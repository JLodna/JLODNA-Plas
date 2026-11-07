-- JLODNA Plas — tests SQL des modules BIO, B2B et confidentialité. À lancer APRÈS tests.sql sur la MÊME base de test
-- (réutilise ses utilisateurs). Résultat attendu : que des "PASS". ⚠ Base de TEST uniquement.
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

-- ===== Préparation (superutilisateur) =====
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000a1','admin1@test.com',now()),
 ('00000000-0000-0000-0000-0000000000a2','u1@test.com',now()),
 ('00000000-0000-0000-0000-0000000000a3','u2@test.com',now()),
 ('00000000-0000-0000-0000-0000000000a4','u4@test.com',now());
insert into admin_roles(user_id, role) values ('00000000-0000-0000-0000-0000000000a1','ADMIN');
-- Rappel : ...f1 = jlodnaplas@gmail.com (SUPER_ADMIN), ...b1 = SUPPORT (bio.moderate + b2b.manage), ...e1 = EDITOR

select pg_temp.ok('SUPER ADMIN: jlodnaplas@gmail.com est SUPER_ADMIN', exists (select 1 from admin_roles where user_id='00000000-0000-0000-0000-0000000000f1' and role='SUPER_ADMIN'));
select pg_temp.ok('SUPER ADMIN: bootstrap_admin_email = jlodnaplas@gmail.com', (select value #>> '{}' from settings where key='bootstrap_admin_email') = 'jlodnaplas@gmail.com');
select pg_temp.ok('PERMISSIONS: SUPPORT a b2b.manage et bio.moderate; EDITOR non',
  (select count(*) from admin_permissions where role='SUPPORT' and permission in ('b2b.manage','bio.moderate')) = 2
  and not exists (select 1 from admin_permissions where role='EDITOR' and permission in ('b2b.manage','bio.moderate')));

-- ===== Un ADMIN ne peut pas s'auto-promouvoir via la clé bootstrap =====
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select pg_temp.ok('SÉCURITÉ: ADMIN ne peut PAS modifier bootstrap_admin_email', pg_temp.upd($$update settings set value='"pirate@test.com"' where key='bootstrap_admin_email'$$) = 0);
select pg_temp.ok('SÉCURITÉ: ADMIN peut modifier un autre réglage (store)', pg_temp.upd($$update settings set value=value where key='store'$$) = 1);
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select pg_temp.ok('SÉCURITÉ: SUPER_ADMIN peut modifier bootstrap_admin_email', pg_temp.upd($$update settings set value='"jlodnaplas@gmail.com"' where key='bootstrap_admin_email'$$) = 1);

-- ===== BIO : visiteur =====
reset role; set role anon; select pg_temp.login(null);
select pg_temp.err('select count(*) from bio_profiles', 'permission denied', 'BIO: ANON ne peut pas lire la table (pas d''annuaire)');
select pg_temp.ok('BIO: get_public_bio inconnu => null', public.get_public_bio('inconnu') is null);

-- ===== BIO : propriétaire =====
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
insert into bio_profiles(user_id, slug, display_name, headline, links) values ('00000000-0000-0000-0000-0000000000a2','marie-j','Marie J','Coiffeuse','[{"label":"Facebook","url":"https://facebook.com/marie"}]');
select pg_temp.ok('BIO: création du profil (privé par défaut)', (select is_public from bio_profiles where slug='marie-j') = false);
select pg_temp.err($$insert into bio_profiles(user_id, slug, display_name) values ('00000000-0000-0000-0000-0000000000a3','vole','Autre')$$, 'row-level security', 'BIO: impossible de créer un profil au nom d''un autre');
select pg_temp.err($$update bio_profiles set links='[{"label":"x","url":"http://pas-https.com"}]' where slug='marie-j'$$, 'BIO_LINKS_INVALID', 'BIO: lien http:// refusé');
select pg_temp.err($$update bio_profiles set links='[{"label":"x","url":"javascript:alert(1)"}]' where slug='marie-j'$$, 'BIO_LINKS_INVALID', 'BIO: lien javascript: refusé');
select pg_temp.err($$update bio_profiles set avatar_path='00000000-0000-0000-0000-0000000000a3/photo.png' where slug='marie-j'$$, 'BIO_MEDIA_INVALID', 'BIO: fichier d''un autre dossier refusé');
select pg_temp.err($$insert into bio_profiles(user_id, slug, display_name) values ('00000000-0000-0000-0000-0000000000a2','admin','X')$$, 'violates', 'BIO: slug réservé ou doublon refusé');
update bio_profiles set avatar_path='00000000-0000-0000-0000-0000000000a2/abc123.png', is_public=true where slug='marie-j';
select pg_temp.ok('BIO: avatar dans son propre dossier accepté', (select avatar_path from bio_profiles where slug='marie-j') like '%/abc123.png');
update bio_profiles set is_blocked = true where slug='marie-j';
select pg_temp.ok('BIO: l''utilisateur ne peut pas se (dé)bloquer lui-même', (select is_blocked from bio_profiles where slug='marie-j') = false);

-- ===== BIO : autre utilisateur et visiteur =====
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select pg_temp.ok('BIO: un autre utilisateur ne voit pas ce profil dans la table', (select count(*) from bio_profiles) = 0);
select pg_temp.ok('BIO: un autre utilisateur ne peut pas le modifier', pg_temp.upd($$update bio_profiles set display_name='Piraté' where slug='marie-j'$$) = 0);
select pg_temp.ok('BIO: un autre utilisateur ne peut pas le supprimer', pg_temp.upd($$delete from bio_profiles where slug='marie-j'$$) = 0);
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok('BIO: profil publié visible via get_public_bio', public.get_public_bio('MARIE-J')->>'display_name' = 'Marie J');
select pg_temp.ok('BIO: la réponse publique n''expose ni user_id ni email', not (public.get_public_bio('marie-j') ? 'user_id') and not (public.get_public_bio('marie-j') ? 'id'));

-- ===== BIO : modération =====
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok('MODÉRATION: SUPPORT voit le profil', (select count(*) from bio_profiles where slug='marie-j') = 1);
update bio_profiles set display_name='Modifié par modérateur', is_blocked=true where slug='marie-j';
select pg_temp.ok('MODÉRATION: le modérateur bloque mais ne modifie pas le contenu', (select display_name from bio_profiles where slug='marie-j') = 'Marie J' and (select is_blocked from bio_profiles where slug='marie-j'));
select pg_temp.ok('MODÉRATION: profil bloqué => dépublié', (select is_public from bio_profiles where slug='marie-j') = false);
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok('MODÉRATION: profil bloqué invisible du public', public.get_public_bio('marie-j') is null);
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
update bio_profiles set is_public = true where slug='marie-j';
select pg_temp.ok('MODÉRATION: un profil bloqué ne peut pas être republié', (select is_public from bio_profiles where slug='marie-j') = false);

-- ===== B2B : visiteur (connexion obligatoire) =====
reset role; set role anon; select pg_temp.login(null);
select pg_temp.err('select count(*) from b2b_requests', 'permission denied', 'B2B: ANON ne peut pas lire les demandes');
select pg_temp.err($$insert into b2b_requests(full_name,phone,email,country,request_type,product,quantity,description) values ('X Y','5090000','x@y.com','HT','quote','p',1,'description')$$, 'permission denied', 'B2B: insertion directe interdite (RPC uniquement)');
select pg_temp.err($$select public.submit_b2b_request('Jean Pierre','ACME','50912345678','jean@acme.com','Haïti','wholesale','Riz 50kg',200,'5000 USD','Besoin de 200 sacs par mois',null)$$, 'permission denied', 'B2B: un visiteur NON connecté ne peut PAS soumettre de demande');
select pg_temp.err('select public.post_b2b_message(gen_random_uuid(), ''x'')', 'permission denied', 'B2B: visiteur ne peut pas écrire de message');

-- ===== B2B : validations (connecté) =====
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select pg_temp.err($$select public.submit_b2b_request('Jean Pierre',null,'50912345678','jean3@acme.com','Haïti','nimporte','Riz',10,null,'Besoin urgent',null)$$, 'violates', 'B2B: type de demande invalide refusé');
select pg_temp.err($$select public.submit_b2b_request('Jean Pierre',null,'50912345678','pas-un-email','Haïti','quote','Riz',10,null,'Besoin urgent',null)$$, 'violates', 'B2B: email invalide refusé');
select pg_temp.err($$select public.submit_b2b_request('Jean Pierre',null,'50912345678','jean4@acme.com','Haïti','quote','Riz',0,null,'Besoin urgent',null)$$, 'violates', 'B2B: quantité 0 refusée');
select pg_temp.err($$select public.submit_b2b_request('Jean Pierre',null,'50912345678','jean5@acme.com','Haïti','quote','Riz',5,null,'Besoin urgent','00000000-0000-0000-0000-0000000000a2/f.pdf')$$, 'INVALID_ATTACHMENT', 'B2B: pièce jointe du dossier d''un autre refusée');

-- ===== B2B : anti-abus =====
select public.submit_b2b_request('Spam Bot',null,'50900000000','spam'||g||'@x.com','HT','quote','a b',1,null,'description 1',null) from generate_series(1,5) g;
select pg_temp.err($$select public.submit_b2b_request('Spam Bot',null,'50900000000','spam9@x.com','HT','quote','a b',1,null,'description 1',null)$$, 'RATE_LIMITED', 'B2B: 6e demande/heure pour un même compte => RATE_LIMITED');

-- ===== B2B : client connecté =====
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select public.submit_b2b_request('Marie J','Salon M','50955555555','u1@test.com','Haïti','special_order','Sèche-cheveux pro',50,null,'Commande spéciale 50 pièces','00000000-0000-0000-0000-0000000000a2/doc1.pdf') as ref \gset
select pg_temp.ok('B2B: client connecté soumet avec pièce jointe', :'ref' ~ '^B2B-');
select pg_temp.ok('B2B: le client ne voit que SES demandes', (select count(*) from b2b_requests) = 1 and (select user_id from b2b_requests limit 1) = '00000000-0000-0000-0000-0000000000a2');
select set_config('t.req', (select id::text from b2b_requests limit 1), false);
select pg_temp.ok('B2B: le client poste un message', public.post_b2b_message(current_setting('t.req')::uuid, 'Bonjour, des nouvelles ?') > 0);
select pg_temp.err($$select public.admin_set_b2b_status(current_setting('t.req')::uuid, 'confirmed')$$, 'FORBIDDEN', 'B2B: le client ne peut pas changer le statut');
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select pg_temp.ok('B2B: un autre client ne voit aucune demande ni message', (select count(*) from b2b_requests) = 0 and (select count(*) from b2b_messages) = 0);
select pg_temp.err($$select public.post_b2b_message(current_setting('t.req')::uuid, 'intrusion')$$, 'FORBIDDEN', 'B2B: un autre client ne peut pas écrire dans cette demande');

-- ===== B2B : personnel =====
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select pg_temp.ok('B2B: le personnel voit toutes les demandes (≥ 6)', (select count(*) from b2b_requests) >= 6);
select pg_temp.ok('B2B: le personnel répond', public.post_b2b_message(current_setting('t.req')::uuid, 'Devis en préparation.') > 0);
select public.admin_set_b2b_status(current_setting('t.req')::uuid, 'quote_sent');
select pg_temp.ok('B2B: statut modifié => quote_sent', (select status from b2b_requests where id = current_setting('t.req')::uuid) = 'quote_sent');
select pg_temp.ok('B2B: historique conserve message client, réponse et changement de statut', (select count(*) from b2b_messages where request_id = current_setting('t.req')::uuid) = 3);
select pg_temp.err($$select public.admin_set_b2b_status(current_setting('t.req')::uuid, 'inconnu')$$, 'INVALID_STATUS', 'B2B: statut inconnu refusé');
select pg_temp.ok('B2B: les 7 statuts sont acceptés', (select count(*) from (select public.admin_set_b2b_status(current_setting('t.req')::uuid, s) from unnest(array['new','analysis','quote_sent','awaiting_confirmation','confirmed','completed','rejected']) s) x) = 7);
reset role; select pg_temp.ok('B2B: changements de statut tracés dans le journal d''audit', exists (select 1 from audit_logs where action='set_b2b_status'));
select pg_temp.ok('B2B: le client est notifié (réponse + statut)', (select count(*) from notifications where user_id='00000000-0000-0000-0000-0000000000a2' and type in ('b2b_reply','b2b_status')) >= 2);
select pg_temp.ok('B2B: l''équipe est notifiée d''une nouvelle demande', exists (select 1 from notifications where audience='admin' and type='b2b_request'));
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select pg_temp.ok('B2B: EDITOR (sans b2b.manage) ne voit rien', (select count(*) from b2b_requests) = 0);

-- ===== Droits utilisateur : export + suppression =====
reset role; set role authenticated; select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select pg_temp.ok('EXPORT: contient mes demandes B2B avec messages et mon BIO',
  jsonb_array_length(public.export_my_data()->'b2b_requests') = 1
  and jsonb_array_length(public.export_my_data()->'b2b_requests'->0->'messages') >= 3
  and public.export_my_data()->'bio'->>'slug' = 'marie-j');
select pg_temp.ok('EXPORT: aucune donnée d''un autre utilisateur', public.export_my_data()::text not like '%u2@test.com%' and public.export_my_data()::text not like '%spam1@x.com%');
select pg_temp.ok('EXPORT: le profil exporté est bien le mien', public.export_my_data()->'account'->>'email' = 'u1@test.com');
select public.request_account_deletion();
reset role; select pg_temp.ok('SUPPRESSION: la demande notifie les administrateurs', exists (select 1 from notifications where type='deletion_request' and body='u1@test.com'));
reset role; set role anon; select pg_temp.login(null);
select pg_temp.err('select public.export_my_data()', 'permission denied', 'EXPORT: refusé aux visiteurs');
select pg_temp.err('select public.request_account_deletion()', 'permission denied', 'SUPPRESSION: refusée aux visiteurs');

-- ===== Storage =====
reset role;
select pg_temp.ok('STORAGE: b2b-files PRIVÉ (10 Mo, images + PDF)', (select not public and file_size_limit = 10485760 and 'application/pdf' = any(allowed_mime_types) from storage.buckets where id='b2b-files'));
select pg_temp.ok('STORAGE: bio-media public (lecture par URL), types image/vidéo uniquement', (select public and 'video/mp4' = any(allowed_mime_types) and not 'application/pdf' = any(allowed_mime_types) from storage.buckets where id='bio-media'));
select pg_temp.ok('STORAGE: 7 politiques bio_media / b2b_files', (select count(*) from pg_policies where tablename='objects' and (policyname like 'bio_media_%' or policyname like 'b2b_files_%')) = 7);
select pg_temp.ok('STORAGE: aucune lecture publique (anon) sur bio-media ni b2b-files', not exists (select 1 from pg_policies where tablename='objects' and (policyname like 'bio_media_%' or policyname like 'b2b_files_%') and 'anon' = any(roles::text[]) ) and not exists (select 1 from pg_policies where tablename='objects' and (policyname like 'bio_media_%' or policyname like 'b2b_files_%') and 'public' = any(roles::text[])));

-- ===== Rejouabilité =====
\i supabase/modules/10_bio_b2b.sql
select pg_temp.ok('MODULE: relançable sans erreur ni doublon', (select count(*) from admin_permissions where permission='b2b.manage') = 3);
