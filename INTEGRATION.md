# JLODNA Plas — application unique (boutique + BIO + B2B + JLodni)

Noms officiels : **JLODNA Plas** (application, boutique) · **JLodni** (intelligence artificielle) · **BIO** (profil numérique) · **B2B** (espace professionnel).
Super administrateur : **jlodnaplas@gmail.com**.

## Ce qui a été intégré
| Fonction | Adresse | Détail |
|---|---|---|
| Boutique, comptes, commandes, admin | `/`, `/shop`, `/account`, `/orders`, `/admin/` | Code existant conservé |
| **BIO officiel** | `/bio` | Site d'origine (mêmes `style.css`, `script.js`, logo, favicon : fichiers identiques, seuls les chemins sont passés en `/bio/…`) |
| **BIO profils** (nouveau) | `/bio/edit` (privé), `/bio/u/<identifiant>` (public) | Photo, vidéo, liens https, publication volontaire, QR code téléchargeable, partage |
| **B2B** (nouveau) | `/b2b` | **Connexion obligatoire.** Formulaire complet, pièce jointe, suivi et échanges ; admin : `/admin/#b2b`, 7 statuts, historique |
| **Paiements en ligne** (nouveau) | checkout, `/orders`, `/api/pay/*` | Carte (Stripe), PayPal, MonCash ; NatCash en mode manuel ; confirmation uniquement par le serveur |
| **Sécurité + mobile** (nouveau) | `/delete-account`, `/api/contact`, `/api/push/send`, `mobile/` | CAPTCHA, limitation de requêtes, signalements, suppression de compte complète, 2FA, notifications push, appareil photo, application Android (Capacitor) |
| **Comptes vendeurs** (nouveau) | `/seller`, admin `/admin/#sellers` | Candidature, approbation, produits en brouillon validés par l'équipe, ventes, commission, reversements |
| **JLodni** | widget sur toutes les pages boutique, `/api/jlodni` | Ex « JLODNA As », renommé partout ; clé IA côté serveur uniquement |
| Admin unique | `/admin/` | Sections ajoutées : Demandes B2B, Profils BIO, JLodni — mêmes rôles, même authentification |

## Ordre d'installation Supabase (SQL Editor, un fichier à la fois)
`schema` → `functions` → `triggers` → `policies` → `seed` (optionnel) → `modules/10_bio_b2b` → `modules/20_jlodni` → `modules/30_payments` → `modules/40_sellers` → `modules/50_security_mobile`.
Les modules sont additifs et relançables. `policies.sql` ne supprime plus que les politiques du noyau.
**Base déjà en production** : n'exécutez PAS `schema.sql` à nouveau ; exécutez seulement `policies.sql` (mis à jour) puis les 5 modules, dans l'ordre. ⚠ `policies.sql` retire l'insertion directe des messages de contact : le formulaire passe par `/api/contact` (voir CAPTCHA ci-dessous).

## Super administrateur
1. Créez le compte `jlodnaplas@gmail.com` sur `/register` et **confirmez l'email**.
2. Base neuve : il devient SUPER_ADMIN automatiquement. Base existante : exécutez `modules/10_bio_b2b.sql` APRÈS la confirmation (il attribue le rôle).
3. L'ancien compte `jloodna@gmail.com`, s'il a déjà le rôle SUPER_ADMIN, **n'est pas modifié** : retirez-le vous-même dans Admin → Paramètres → Équipe si vous le souhaitez.
4. Seul un SUPER_ADMIN peut modifier l'email de bootstrap (un ADMIN ne peut pas s'auto-promouvoir).

## Variables d'environnement Vercel (valeurs à saisir vous-même)
Publiques : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`.
Serveur : `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (JLodni uniquement), `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`.
Activer JLodni : `update public.settings set value = jsonb_set(value,'{enabled}','true') where key='assistant';` puis renseigner contact support et FAQ dans Admin → JLodni.

## Domaines
- `www.jlodna.com` : application (et `jlodna.com` → 301 vers `www`, règle existante). **BIO = `https://www.jlodna.com/bio`** ; `jlodna.com/bio` redirige vers cette adresse.
- `bio.jlodna.com` : ajoutez-le comme domaine du MÊME projet Vercel. La règle l'envoie en redirection **temporaire (307)** vers `/bio`. Après vérification, passez `"permanent": true` dans `vercel.json`. Aucun DNS n'a été modifié ; gardez l'ancien projet bio actif jusqu'à validation.
- Le dépôt GitHub d'origine de BIO ne doit pas être supprimé (sauvegarde).

## Sécurité et vie privée (ce qui est en place)
- RLS forcée sur toutes les nouvelles tables ; écritures B2B uniquement par fonctions serveur (validation, anti-abus : 5 demandes/h par email, plafond global visiteurs).
- BIO privé par défaut ; aucune lecture publique de la table (pas d'annuaire) ; le public passe par `get_public_bio()` qui n'expose ni identifiant interne ni email ; liens `https://` uniquement ; fichiers limités au dossier de leur propriétaire ; modérateurs : blocage seulement, jamais modification du contenu ; pages de profil `noindex`.
- Pièces jointes B2B : bucket **privé**, liens signés de 5 minutes pour le personnel autorisé. Fichiers vérifiés par signature réelle (pas seulement l'extension), taille et type limités côté navigateur ET bucket.
- Droits utilisateur : « Mes données » (export JSON complet) et demande de suppression de compte (Compte → Mes données).
- JLodni : ne stocke pas le contenu des conversations (statistiques agrégées seulement) ; aucune commande ni paiement sans confirmation ; limitation de débit.
- En-têtes : CSP stricte (+ `object-src 'none'`, médias Supabase seulement), HSTS, COOP, X-Frame-Options DENY, API en `no-store`. Clé `service_role` refusée par le build côté navigateur.
- Corrigé au passage : l'admin écoutait la table `inventory` supprimée (désormais `product_variants`).

## Paiements en ligne (détails)
**Principe** : le navigateur demande seulement une page de paiement (`/api/pay/create`). Le **montant est relu en base** (jamais envoyé par le navigateur). Seules les fonctions serveur, après vérification auprès du prestataire (signature Stripe, relecture PayPal / MonCash, montant et référence comparés), appellent `confirm_payment`, réservée au rôle `service_role`. Un client ne peut pas se déclarer « payé ». Une référence de paiement ne peut servir qu'une fois. Un paiement reçu sur une commande déjà annulée alerte l'équipe pour remboursement.
| Mode (réglage `payment_methods`) | Prestataire | Mise en service |
|---|---|---|
| `card` | Stripe Checkout (USD) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` ; webhook Stripe → `https://www.jlodna.com/api/pay/stripe-webhook` (événements `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`) |
| `paypal` | PayPal Orders v2 (USD) | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV` |
| `moncash` | MonCash Digicel (HTG) | `MONCASH_CLIENT_ID`, `MONCASH_CLIENT_SECRET`, `MONCASH_ENV` ; déclarer l'adresse de retour `https://www.jlodna.com/api/pay/moncash-return` dans le portail MonCash Business |
| `natcash` | **Manuel** (aucune API publique connue) | Écrire les instructions dans `settings.payment_methods.natcash.instructions` ; le personnel marque la commande « payée » dans l'admin |
| `cod` | Paiement à la livraison | Inchangé |
- **Devise** : Stripe et PayPal encaissent en USD ; renseignez `HTG_PER_USD` (gourdes pour 1 USD). Sans cette valeur, ces deux modes refusent de payer (volontaire). Le client est facturé en USD (arrondi au centime supérieur).
- **Activer un mode** : Admin → Paramètres → modes de paiement (`enabled: true`) APRÈS avoir saisi ses clés. Rien n'est activé par défaut.
- **Commandes impayées** : annulées automatiquement (stock libéré) par `/api/cron/expire-orders` (protégé par `CRON_SECRET`). `vercel.json` le lance 1 fois par jour (limite du plan gratuit) ; en plan Pro, passez à `*/15 * * * *`. Délai : `UNPAID_ORDER_MINUTES` (60 par défaut).
- **MonCash** : écrit d'après la documentation publique de l'API (jeton OAuth, CreatePayment, RetrieveTransactionPayment) mais **non vérifié contre le service réel** : testez d'abord en sandbox et vérifiez notamment que `reference` correspond bien au numéro de commande dans la réponse de MonCash.
- Aucun remboursement automatique : à faire depuis le tableau de bord du prestataire.

## Comptes vendeurs (détails)
1. Un client connecté postule sur `/seller` ; l'équipe (permission `sellers.manage` : ADMIN, MANAGER, SUPER_ADMIN) approuve dans Admin → Vendeurs et fixe la **commission**.
2. Le vendeur crée ses produits (variantes, stock, images) : ils sont **toujours en brouillon**. Il les soumet ; l'équipe les relit et les **publie** (section Produits). Toute modification d'un produit publié le remet en brouillon (revalidation).
3. **Confidentialité acheteurs** : la plateforme gère paiement et livraison ; le vendeur ne voit jamais nom, email, téléphone ni adresse (testé).
4. **Finances** : brut = lignes de commandes *livrées et payées* ; commission = pourcentage du vendeur ; solde = net − reversements. Le personnel enregistre chaque reversement (refusé s'il dépasse le solde) ; journal d'audit complet.
5. **Suspension/refus** : produits retirés de la vente immédiatement.
6. Non fait (volontairement) : page publique de boutique (« Vendu par … »), litiges/remboursements vendeurs, reversement automatique.

## Sécurité renforcée et mobile (module 50) — mise en service
### 1. CAPTCHA (Cloudflare Turnstile, gratuit)
1. Créer un widget sur dash.cloudflare.com → Turnstile : vous obtenez une **clé de site** (publique) et une **clé secrète**.
2. Vercel : `VITE_TURNSTILE_SITE_KEY` (clé de site) et `TURNSTILE_SECRET` (clé secrète, serveur uniquement) ; `RATE_LIMIT_SALT` = texte aléatoire.
3. Supabase → Authentication → **Attack Protection** → activer « Enable CAPTCHA protection » (Turnstile) avec la MÊME clé secrète : l'inscription, la connexion et la réinitialisation du mot de passe sont alors protégées.
4. Le formulaire de contact **refuse d'envoyer tant que `TURNSTILE_SECRET` est absent** (volontaire : sans CAPTCHA, c'est une porte à spam). La newsletter (email seul) n'a pas encore de CAPTCHA.
### 2. Limitation de requêtes
Compteurs en base (`rate_limit_hit`, réservée au serveur) : paiement 10/min par client, contact 5/h par adresse IP et 3/h par email, suppression de compte 3/h, signalements 10/jour, demandes B2B 5/h. IP et emails sont **hachés** (jamais en clair). Le B2B, JLodni et les inscriptions ont en plus leurs propres limites.
### 3. Signalements
Bouton « Signaler » sur chaque BIO public et chaque produit (connexion requise, 1 signalement ouvert par cible et par utilisateur, 10/jour). Admin → **Signalements** : rejeter, ou « Appliquer la mesure » (bloque le BIO / retire le produit de la vente). L'équipe est notifiée. Permission `reports.manage` (ADMIN, MANAGER, SUPPORT).
### 4. Suppression de compte complète (`/delete-account`)
Exige le mot de passe (reconnexion toute neuve de moins de 5 min vérifiée côté serveur) et la saisie de SUPPRIMER. Efface : compte, profil, adresses, panier, avis, notifications, BIO (+ fichiers), demandes B2B (+ pièces jointes), messages de contact, jetons push, boutique vendeur sans historique. **Commandes conservées mais anonymisées** (nom, téléphone, email, adresse effacés ; montants et articles gardés pour la comptabilité). Refus explicite pour les comptes administrateur et les vendeurs ayant des reversements/ventes (traitement manuel). L'opération est répétable si une étape échoue.
### 5. Double authentification (2FA) — étapes
1. Supabase → Authentication → **Multi-Factor** : TOTP activé (par défaut sur les projets récents).
2. Chaque administrateur : Compte → **Sécurité** → Activer la 2FA (QR code + code à 6 chiffres). Dès lors, l'admin demande le code à chaque connexion.
3. **Imposer** la 2FA côté base (impossible à contourner par l'API) — seulement APRÈS que TOUS les administrateurs l'ont activée, en tant que SUPER_ADMIN : `update public.settings set value = '{"require_admin_mfa": true}' where key = 'security';`
4. **Déblocage d'urgence** (SQL Editor Supabase, rôle postgres) : `update public.settings set value = '{"require_admin_mfa": false}' where key = 'security';`
5. Seul un SUPER_ADMIN peut modifier cette clé (un ADMIN ne peut pas la désactiver).
### 6. Notifications push et appareil photo
Voir **ANDROID.md** (Firebase, `FCM_SERVICE_ACCOUNT`, `PUSH_WEBHOOK_SECRET`, webhook Supabase). Les jetons d'appareil sont rattachés au compte connecté (un téléphone partagé suit le compte actif), supprimés à la déconnexion, au plus 10 par compte.

## Tests réellement exécutés
- **273 tests SQL** (PostgreSQL 16, base vierge) : 0 échec — noyau existant + nouveaux : super admin, anti-auto-promotion, isolation BIO/B2B entre utilisateurs, modération, anti-abus, notifications, audit, export, storage, relançabilité.
- 19 tests JS (variantes, JLodni, paiements avec faux Supabase / faux prestataires : signature Stripe, montants, devises, falsification, idempotence, cron). Syntaxe de tous les modules vérifiée. `npm run build` OK ; aucun secret dans `dist/`.

## NON testé (à faire avant d'ouvrir au public — voir TESTING.md)
Les 3 prestataires de paiement avec de vrais identifiants (sandbox), Turnstile, Firebase (envoi réel), 2FA réelle, compilation et essai de l'application Android, navigateur réel (BIO, B2B, QR, lecture vidéo, mobile/desktop), vrai projet Supabase (Auth, Storage, Realtime, emails), conversations JLodni avec une vraie clé IA, DNS/domaines, Lighthouse.

## Limites et décisions à prendre
1. **BIO d'origine = page de liens** : profils, QR et vidéo n'existaient pas, ils ont été construits (nouveau code). Aucun QR d'origine n'a été trouvé donc aucun n'a été modifié.
2. Comptes vendeurs et paiements actifs : AJOUTÉS (sections ci-dessous), mais les prestataires doivent être testés avec VOS identifiants sandbox.
3. B2B : la connexion est maintenant obligatoire (visiteurs sans compte : bouton Se connecter / Créer un compte).
4. **« Achat sur commande »** n'existait pas dans la page Contact (simple formulaire) : rien à déplacer ; la page renvoie maintenant vers B2B.
5. Suppression de compte : les commandes bloquent la suppression (`on delete restrict`) ; décider d'une règle d'anonymisation.
6. Recommandé : activer la 2FA Supabase pour le super admin, les sauvegardes, CAPTCHA (Turnstile) sur B2B/inscription.
7. Android : voir ANDROID.md.
