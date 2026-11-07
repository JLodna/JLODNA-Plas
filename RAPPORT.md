# JLODNA Plas — Rapport de livraison (variantes, stock, avis, tests)

**Statut : NON prêt pour la production.** Le SQL et la logique ont été testés automatiquement ; les tests navigateur et Supabase réel restent à faire (voir §9 et `TESTING.md`).

## 1. Fichiers modifiés
`supabase/schema.sql`, `functions.sql`, `triggers.sql`, `policies.sql`, `seed.sql` · `js/products.js`, `js/cart.js`, `js/auth.js`, `js/search.js`, `js/utils.js` · `js/pages/product.js`, `cartpage.js`, `checkout.js`, `orders.js` · `admin/js/products.js`, `inventory.js`, `orders.js`, `dashboard.js`, `admin.js` · `css/style.css` · `scripts/build-config.js` · `package.json` · `README.md`

## 2. Fichiers créés
`js/variants.js` · `admin/js/reviews.js` · `supabase/migrations/001_variants_stock_reviews.sql` · `supabase/tests/tests.sql`, `run-local.sh`, `concurrency.sh`, `stub-supabase.sql` · `tests/variants.test.mjs` · `TESTING.md` · `RAPPORT.md`

## 3. Tables (21)
Créées : **product_variants** (id, product_id, sku, name, attributes, price, sale_price, stock_quantity, reserved_quantity, available_quantity *calculée*, low_stock_threshold, status, sort_order, created_at, updated_at ; unicité SKU et (produit, attributs) ; contraintes réservé ≤ stock, promo < prix).
Modifiées : **products** (colonne JSON `variants` supprimée) · **order_items** (+ variant_id, variant_name ; `variant` = attributs figés) · **cart_items** (clé = variante) · **inventory_movements** (+ variant_id, type, reserved_delta, reserved_after ; stock_delta, stock_after) · **reviews** (`is_visible` remplacé par `status` pending/approved/rejected).
Supprimée : **inventory** (le stock vit dans `product_variants`).
Inchangées : profiles, admin_roles, admin_permissions, categories, product_images, addresses, coupons, coupon_usages, orders, payments, notifications, messages, newsletter, audit_logs, settings.

## 4. Fonctions SQL
Nouvelles : `admin_save_variants`, `admin_set_variant_stock`, `guard_variant_delete`, `guard_product_publish`, `notify_new_review`.
Réécrites : `create_order` (réservation + verrous, par variante), `set_order_status` (transitions strictes, libération/sortie du stock), `inventory_alert` (stock disponible), `admin_stats`.
Supprimée : `admin_set_stock`. Conservées : `has_perm`, `is_admin`, `current_role_name`, `notify_admins`, `validate_coupon`, `handle_new_user`, `grant_bootstrap_admin`, `audit_row`, `sync_payment_status`, `log_admin_login`, `touch_updated_at`, `admin_user_ids`.

## 5. Triggers
`trg_inventory_alert` (variantes), `trg_guard_variant_delete`, `trg_guard_product_publish`, `trg_notify_new_review`, `trg_audit` (produits, catégories, coupons, paramètres, rôles, **avis**), `trg_touch` (dont variantes), `trg_sync_payment`, `trg_touch_payments`, `on_auth_user_created`, `on_auth_user_confirmed`.

## 6. Politiques RLS (37)
- addresses : addresses_all
- admin_permissions : perms_select, perms_write
- admin_roles : roles_select, roles_write
- audit_logs : audit_read
- cart_items : cart_all
- categories : categories_read, categories_write
- coupon_usages : coupon_usages_admin
- coupons : coupons_admin
- inventory_movements : inv_mov_read
- messages : messages_admin, messages_insert, messages_update
- newsletter : newsletter_admin, newsletter_insert
- notifications : notif_delete, notif_select, notif_update
- order_items : order_items_select
- orders : orders_admin_update, orders_select
- payments : payments_select
- product_images : pimages_read, pimages_write
- product_variants : variants_read
- products : products_read, products_write
- profiles : profiles_select, profiles_update
- reviews : reviews_delete, reviews_insert, reviews_moderate, reviews_read
- settings : settings_read, settings_write
Écritures sensibles (variantes, stock, statuts, commandes, notifications) : **uniquement par fonctions serveur** contrôlées par rôle ; nouvelle permission `reviews.moderate` (ADMIN, MANAGER, SUPPORT). Storage : `pi_read`, `pi_insert`, `pi_update`, `pi_delete` sur `product-images`.

## 7. Variables d'environnement et étapes
Voir **README §2 (Supabase pas à pas) et §3 (variables, public/secret, Vercel)**. Publiques : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`. Secrètes (serveur) : `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`, clés de paiement futures. Aucune clé `service_role` nulle part (le build la refuse).

## 8. Tests effectués (réellement exécutés)
- **93 tests SQL automatisés** sur PostgreSQL 16, base vierge, les 5 fichiers dans l'ordre : admin initial (email non confirmé refusé), isolation client/visiteur, permissions EDITOR/SUPPORT/ADMIN, création de commande (réservation, prix serveur, coupon, paiement, notifications), refus de survente (dont lignes dupliquées et variante épuisée), atomicité (aucune réservation fantôme), variante désactivée / produit non publié, confirmation, livraison, annulation, transitions interdites, alerte stock faible/rupture, stock < réservé refusé, suppression d'une variante réservée refusée, publication sans variante refusée, avis (pending/approved/rejected, usurpation, doublon), audit, synchronisation paiement.
- **Concurrence réelle** (2 sessions) : le 2ᵉ client attend le verrou ~2 s puis reçoit `OUT_OF_STOCK` ; 1 commande, 1 unité réservée.
- **Migration** testée sur une base de l'ancienne version avec données (commande en cours, livrée, annulée, variantes JSON, avis, panier) : variantes créées, stock total conservé, commande en cours convertie en réservation, avis convertis ; **structure finale identique à une base neuve** (430 éléments comparés, 0 différence).
- **6 tests unitaires** de la logique (prix, fourchette, options, combinaisons) ; syntaxe de tous les modules JS vérifiée ; `run-local.sh` et `concurrency.sh` exécutés.

## 9. Tests que vous devez encore faire
Tout `TESTING.md` : parcours navigateur (client, admin), Realtime en conditions réelles, upload Storage, emails (Auth + Resend), politiques Storage, PWA, mobile Android/iPhone, 9 largeurs d'écran, Lighthouse, en-têtes de sécurité, `tests.sql` sur un vrai projet Supabase de test.

## 10. Problèmes connus / limites
1. **Aucun test navigateur ni Supabase réel** : des bugs d'interface sont probables (le code JS n'a été vérifié que syntaxiquement et par tests de logique).
2. `tests.sql` utilise des commandes `psql` (`\gset`) et insère dans `auth.users` : exécuté seulement sur PostgreSQL local avec `stub-supabase.sql`, pas encore sur un vrai projet Supabase.
3. Les fonctions `SECURITY DEFINER` supposent que leur propriétaire (`postgres`) contourne la RLS, ce qui est le cas sur Supabase mais n'est pas vérifié ici sur une vraie instance.
4. Les quantités de stock (physique, réservé) sont lisibles par tout visiteur (nécessaire pour « Plus que 3 en stock »).
5. Les variantes partagent les images du produit (pas d'image par variante).
6. Migration : le stock des produits à variantes est mis sur la 1ʳᵉ variante (à répartir dans l'admin) ; paniers navigateur et paniers en base réinitialisés.
7. « Payé » à la livraison se règle à la main ; quand une passerelle en ligne sera ajoutée, un paiement échoué devra appeler `set_order_status(…, 'cancelled')` pour libérer le stock (aucune passerelle n'existe aujourd'hui).
8. Les emails sont déclenchés par le navigateur après la commande : si le client ferme l'onglet à cet instant, pas d'email (la notification dans le site, elle, est créée par le serveur).
9. Pas de limitation de débit applicative (à régler dans Supabase Auth) ; recherche par `ilike` (suffisant pour un petit catalogue, à indexer s'il grossit).
10. `npm test` affiche un avertissement Node sans gravité (module ES dans un projet CommonJS).

## 11. Actions manuelles nécessaires
Créer le projet Supabase et exécuter les 5 fichiers SQL · renseigner les variables dans Vercel puis redéployer · créer/confirmer le compte `jlodnaplas@gmail.com` · configurer Auth (Confirm email, URLs, SMTP) · créer le compte Resend et vérifier le domaine · pointer le DNS `www.jlodna.com` / `jlodna.com` · dérouler `TESTING.md` · supprimer les données de démo · activer 2FA et sauvegardes.
