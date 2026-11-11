# JLODNA Plas.

Boutique en ligne : HTML/CSS/JavaScript modulaire (sans framework) + Supabase (PostgreSQL, Auth, Storage, Realtime, RLS) + Vercel.
Domaine principal : **https://www.jlodna.com** (`jlodna.com` redirige en 301 vers `www`). Email administrateur : `jlodnaplas@gmail.com`.

> ## ⚠ Statut honnête
> Le code et le SQL sont écrits, et la base de données a été testée automatiquement (93 tests SQL, 6 tests de logique, test de concurrence, test de migration).
> **Les tests dans un navigateur et sur un VRAI projet Supabase n'ont pas encore été faits** (Realtime, upload Storage, emails d'authentification, PWA, affichage mobile).
> Le projet n'est donc **pas déclaré prêt pour la production** : suivez `TESTING.md` jusqu'au bout avant d'ouvrir au public.

Logos : `assets/logo/original/` contient vos deux images **telles que fournies**. Le site affiche `logo.webp` (même image, marges blanches rognées) ; favicon et icônes sont dérivés de la 2ᵉ image.

> **Version intégrée** : boutique + BIO (`/bio`) + B2B (`/b2b`) + JLodni (assistant) + administration unique. Lire **INTEGRATION.md** en premier.

## 1. Architecture
```
*.html            pages client (accueil, boutique, produit, panier, commande, compte, commandes, contact, à propos)
admin/            Admin Center (une seule page /admin/, sections par #hash, contrôle d'accès par rôle)
js/ · js/pages/   modules du site ; js/variants.js = logique pure des variantes/prix (testée)
admin/js/         modules de l'admin (produits, variantes, stock, commandes, avis, coupons, équipe…)
api/              fonctions Vercel : notify.js (emails), sitemap.js
supabase/         schema.sql → functions.sql → triggers.sql → policies.sql → seed.sql · migrations/ · tests/
scripts/build-config.js   génère js/config.js depuis les variables d'environnement et copie le site dans dist/
```

## 2. Connecter le projet à VOTRE Supabase (pas à pas)
1. **Créer le projet** : supabase.com → *New project* → nom `jlodna-plas`, mot de passe de base (gardez-le pour vous, il ne va jamais dans le site), région la plus proche (ex. East US).
2. **Récupérer l'URL** : tableau de bord du projet → ⚙ *Project Settings* → **API** (ou *Data API*) → **Project URL**, de la forme `https://xxxxxxxx.supabase.co`.
3. **Récupérer la clé publique** : même page → *Project API keys* → clé **`anon` `public`** (commence par `eyJ…`). Sur le nouveau tableau de bord, la **Publishable key** (`sb_publishable_…`) convient aussi.
   **Ne jamais utiliser** la clé `service_role` ni la clé `sb_secret_…` : le build s'arrête avec une erreur si vous en collez une.
4. **Créer la base** : *SQL Editor* → *New query* → coller et exécuter **dans cet ordre**, un fichier à la fois :
   `supabase/schema.sql` → `functions.sql` → `triggers.sql` → `policies.sql` → (optionnel) `seed.sql` → **`modules/10_bio_b2b.sql`** → **`modules/20_jlodni.sql`** (voir INTEGRATION.md).
   Chaque exécution doit afficher *Success*. Le bucket `product-images` (public, 5 Mo, JPG/PNG/WebP) est créé par `policies.sql`.
5. **Authentication** → *Providers* : Email activé, **Confirm email activé**. *URL Configuration* : Site URL `https://www.jlodna.com` ; Redirect URLs `https://www.jlodna.com/**` et `http://localhost:3000/**`. Recommandé : *Rate Limits* et SMTP personnalisé (Resend : `smtp.resend.com`, port 465, utilisateur `resend`, mot de passe = clé API Resend).
6. **Realtime** : vérifier *Database → Publications → supabase_realtime* : notifications, orders, products, product_variants, messages doivent être cochées (le SQL le fait déjà).
7. **Storage** : *Storage* → le bucket `product-images` existe et est *Public*.
8. **Variables Vercel** : voir §3.
9. **Compte admin** : voir §4.

## 3. Variables d'environnement
| Variable | Public / secret | Rôle |
|---|---|---|
| `VITE_SUPABASE_URL` | **Public** (visible dans le navigateur, normal) | URL du projet |
| `VITE_SUPABASE_ANON_KEY` | **Public** (protégée par RLS) | clé anon / publishable |
| `VITE_SITE_URL` | Public | `https://www.jlodna.com` |
| `RESEND_API_KEY` | **SECRET** (serveur uniquement) | envoi des emails de commande |
| `EMAIL_FROM` | Serveur | ex. `JLODNA Plas <commandes@jlodna.com>` (domaine vérifié dans Resend) |
| `ADMIN_EMAIL` | Serveur | reçoit les nouvelles commandes |
| `MONCASH_*`, `NATCASH_API_KEY`, `PAYPAL_*`, `STRIPE_SECRET_KEY` | **SECRET** | réservées aux futures passerelles (inutilisées aujourd'hui) |

Le préfixe `VITE_` n'indique pas l'usage de Vite : le projet est en HTML pur, `scripts/build-config.js` écrit les 3 variables publiques dans `js/config.js` au build. Les variables secrètes ne sont lues que par `api/*.js` (côté serveur Vercel) et n'apparaissent jamais dans le site.

**Dans Vercel** : projet → *Settings* → *Environment Variables* → ajouter chaque variable (cocher Production et Preview) → *Deployments* → ⋯ → **Redeploy** (la configuration est lue au build : toute modification demande un redéploiement).

**En local (Windows PowerShell)** :
```powershell
$env:VITE_SUPABASE_URL="https://xxxx.supabase.co"; $env:VITE_SUPABASE_ANON_KEY="eyJ..."; npm run build; npx serve dist -l 3000
```
(Mac/Linux : `export VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… && npm run dev`.) Modèle : `.env.example`.

## 4. Créer le compte admin
1. Sur le site : `/register` avec **jlodnaplas@gmail.com** et le mot de passe de votre choix (jamais dans le code).
2. Cliquer le lien de confirmation reçu par email.
3. Le premier compte **confirmé** avec cet email devient `SUPER_ADMIN` automatiquement (un compte non confirmé ne reçoit aucun droit).
4. Se connecter sur `/admin`. Ajouter des collaborateurs dans **Paramètres → Équipe et rôles** (ils doivent d'abord s'inscrire).

| Rôle | Peut |
|---|---|
| SUPER_ADMIN | tout, y compris les rôles |
| ADMIN | produits, catégories, commandes, stock, coupons, clients, messages, avis, paramètres, audit |
| MANAGER | produits, catégories, commandes, stock, coupons, clients, messages, avis |
| EDITOR | produits et catégories (ne modifie pas le stock) |
| SUPPORT | commandes, clients, messages, avis |

## 5. Variantes, stock, avis
- **Variantes** (`product_variants`) : chaque produit a ≥ 1 variante. Produit simple = une variante « Standard ». Avec options (Taille, Couleur…), l'admin saisit les options puis clique **Générer les variantes** : une ligne par combinaison avec SKU, prix, prix promo (vides = prix du produit), stock, alerte et statut. Une commande mémorise `variant_id`, le nom, les attributs et le SKU.
- **Stock** : `stock_quantity` (physique), `reserved_quantity` (réservé), `available_quantity = stock − réservé` (colonne calculée par PostgreSQL). Cycle :

  | Événement | Effet |
  |---|---|
  | Création de commande | réserve (verrou de ligne, refus si disponible insuffisant, tout ou rien) |
  | Confirmation / préparation / expédition | la réservation est conservée |
  | Livraison | le stock sort (stock −n, réservé −n) |
  | Annulation | la réservation est libérée |
  | Erreur pendant la commande | rien n'est réservé (une seule transaction) |

  Une commande livrée ou annulée est définitive. Le stock ne peut pas être fixé en dessous du réservé. Tout mouvement est journalisé (`inventory_movements`).
- **Avis** : statuts `pending` (défaut) → `approved` / `rejected`. Seuls les avis approuvés sont publics (RLS). Modération : Admin → *Avis*.

## 6. Migrer une base existante
Base **neuve** : ignorez cette section. Base créée avec la version précédente (variantes en JSON) : sauvegardez, exécutez `supabase/migrations/001_variants_stock_reviews.sql`, puis `functions.sql`, `triggers.sql`, `policies.sql`. Détails et limites en tête du fichier (le stock des produits à variantes est placé sur la 1ʳᵉ variante : à répartir dans Admin → Stock).

## 7. Déploiement
```bash
git init && git add . && git commit -m "JLODNA Plas" && git branch -M main
git remote add origin https://github.com/<vous>/jlodna-plas.git && git push -u origin main
```
Vercel → *Add New → Project* → importer le dépôt → Framework « Other » (le `vercel.json` fixe build `npm run build` et sortie `dist`) → variables (§3) → Deploy.
**Domaine** : *Settings → Domains* → ajouter `www.jlodna.com` (principal) et `jlodna.com`. Chez le registrar : `CNAME www → cname.vercel-dns.com`, `A @ → 76.76.21.21` (ou les valeurs affichées par Vercel). HTTPS automatique.

## 8. Emails et paiements
- **Emails** : Resend, domaine vérifié, clé dans `RESEND_API_KEY`. Sans clé, la boutique fonctionne et aucun email n'est envoyé (les notifications dans le site restent actives). Envoyés : confirmation de commande (client), nouvelle commande (admin), changement de statut (client).
- **Paiements** : seul le **paiement à la livraison** est actif ; aucun paiement n'est simulé. MonCash, NatCash, carte, PayPal sont **désactivés** dans `settings.payment_methods`. Pour en ajouter un : créer `api/pay-<nom>.js` (clés privées côté serveur, vérification serveur du paiement), puis activer la méthode ; `create_order` refuse tout mode désactivé. Le statut « payé » d'une commande à la livraison se règle à la main dans l'admin.

## 9. Tests
- `npm test` : logique des variantes (prix, options, combinaisons).
- `supabase/tests/run-local.sh` : les 5 fichiers SQL + 93 tests (RLS, rôles, stock, commandes, avis) sur un PostgreSQL **local** (psql requis).
- `supabase/tests/concurrency.sh` : deux clients, une dernière unité.
- **`TESTING.md`** : checklist complète à dérouler à la main (client, admin, sécurité, mobile).

## 10. Sécurité (résumé)
RLS activé et forcé partout · commandes, statuts et stock uniquement par fonctions serveur contrôlées par rôle · prix recalculés en base · client isolé (commandes, paiements, notifications, adresses, panier) · coupons invisibles aux clients · avis non approuvés jamais publics · upload limité (type, 5 Mo, bucket) · XSS : données échappées + CSP stricte (`vercel.json`) · aucune clé secrète dans le site · journal d'audit (pas d'adresse IP collectée).
À faire par vous : 2FA sur Supabase/GitHub/Vercel, *Confirm email*, limites de débit Auth, surveiller les logs.
