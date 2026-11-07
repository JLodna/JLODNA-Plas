# JLODNA Plas — Checklist de tests réels

Cochez chaque ligne **uniquement après l'avoir réellement faite**. Une case non cochée = non testé.
Utilisez d'abord un projet Supabase de TEST (pas votre projet final), avec les données de `seed.sql`.

## 0. Préparation
- [ ] `npm test` → 6 tests passent
- [ ] Projet Supabase créé, 5 fichiers SQL exécutés sans erreur (README §2)
- [ ] Variables dans Vercel, site déployé, ouvert sur `https://…vercel.app` puis sur `www.jlodna.com`
- [ ] Compte `jlodnaplas@gmail.com` créé, confirmé, accès à `/admin` (rôle SUPER_ADMIN visible en haut)
- [ ] (Local, facultatif) `supabase/tests/run-local.sh` → `FAIL: 0` ; `concurrency.sh` → « OK »
- [ ] 2 comptes clients de test créés : **client A** et **client B** (emails réels, confirmés)

## 1. CLIENT
| # | Test | Résultat attendu | OK |
|---|---|---|---|
| C1 | Inscription (prénom, nom, email, téléphone, mot de passe ×2) | Message « Vérifiez votre email » ; email reçu ; après clic, connexion possible | [ ] |
| C2 | Inscription avec mots de passe différents / email invalide | Message d'erreur clair, aucun compte créé | [ ] |
| C3 | Connexion | Arrive sur « Mon compte » ; icône cloche visible | [ ] |
| C4 | Mauvais mot de passe | « Email ou mot de passe incorrect. » | [ ] |
| C5 | Déconnexion (Compte → Paramètres) | Retour accueil ; cloche disparue | [ ] |
| C6 | Mot de passe oublié | Email reçu, nouveau mot de passe fonctionne | [ ] |
| C7 | Recherche « écouteurs », puis un SKU de variante (`DEMO-001-NOIR`) | Résultats instantanés ; le SKU trouve le produit | [ ] |
| C8 | Catégorie, filtre prix, tri (prix, nouveautés, popularité) | Liste cohérente ; catégorie vide → « Il n'y a aucun produit dans cette catégorie. » | [ ] |
| C9 | Page produit simple (lampe) | Image, prix, stock, quantité, Ajouter / Acheter maintenant | [ ] |
| C10 | **Variantes** : T-shirt → choisir S, M, L | Prix/stock/SKU changent par variante ; XL affiché « épuisé » et achat bloqué | [ ] |
| C11 | Variante désactivée dans l'admin | Disparaît de la page produit sans recharger (Realtime) ou au rechargement | [ ] |
| C12 | Ajouter 2 variantes différentes au panier ; recharger la page | Panier conservé, 2 lignes distinctes | [ ] |
| C13 | Quantité > stock disponible | Plafonnée au disponible avec message | [ ] |
| C14 | Supprimer une ligne, modifier une quantité | Totaux recalculés | [ ] |
| C15 | **Coupon** valide / invalide / sous le minimum | Réduction appliquée ; message clair sinon | [ ] |
| C16 | Livraison offerte au-dessus du seuil (Admin → Paramètres) | Frais à 0 | [ ] |
| C17 | **Checkout** : champs vides / valides | Validation ; commande créée ; écran avec numéro `JLD-…`, montant, date, statut | [ ] |
| C18 | Après commande : Admin → Stock | `Réservé` augmente, `Disponible` baisse, `Stock` inchangé | [ ] |
| C19 | **Paiement** : seul « Paiement à la livraison » proposé | MonCash/NatCash/Carte/PayPal absents | [ ] |
| C20 | Historique : « Mes commandes » | Commande listée avec frise de suivi et variantes | [ ] |
| C21 | **Notification** : l'admin confirme la commande | Cloche du client : « Votre commande JLD-… a été confirmée. » **sans recharger** | [ ] |
| C22 | **Avis** : client connecté publie un avis | « sera publié après modération » ; l'avis n'apparaît PAS publiquement (tester en navigation privée) | [ ] |
| C23 | Avis approuvé par l'admin | Apparaît sur la page produit | [ ] |
| C24 | Contact + newsletter | Message visible dans Admin → Messages | [ ] |
| C25 | Panier d'un visiteur puis connexion | Panier fusionné, pas de doublon | [ ] |

## 2. ADMIN
| # | Test | Résultat attendu | OK |
|---|---|---|---|
| A1 | Connexion `/admin` avec un compte **non admin** | « Accès réservé aux administrateurs. » | [ ] |
| A2 | Connexion admin ; tableau de bord | Chiffres cohérents avec les commandes réelles ; graphique 14 jours | [ ] |
| A3 | **Créer un produit simple** (nom, prix, stock 10, image, catégorie, Publié) | Apparaît dans la boutique **sans toucher au code** | [ ] |
| A4 | **Créer un produit à variantes** (Taille : S, M, L → *Générer*) ; stock par variante | 3 lignes ; produit visible avec sélecteur | [ ] |
| A5 | Enregistrer sans cliquer *Générer* après avoir changé les options | Message « Cliquez sur Générer… » | [ ] |
| A6 | Modifier prix / prix promo / SKU / stock d'une variante | Mis à jour sur le site | [ ] |
| A7 | Prix promo ≥ prix | Refusé avec message | [ ] |
| A8 | **Upload image** depuis le téléphone ; fichier .gif / > 5 Mo | JPG/PNG/WebP acceptés ; autres refusés avec message | [ ] |
| A9 | Retirer une image puis enregistrer | Image absente du site (et du bucket) | [ ] |
| A10 | Désactiver / Publier / Supprimer un produit | Statut appliqué ; suppression refusée si des commandes en cours réservent du stock | [ ] |
| A11 | Catégories : créer, image, désactiver, supprimer | Reflété dans la boutique | [ ] |
| A12 | **Stock** : ajuster ; mettre un stock < réservé | Ajustement journalisé ; refus « inférieur aux quantités réservées » | [ ] |
| A13 | Stock faible / rupture | Notification admin « Attention : le produit X possède seulement N unité(s) » | [ ] |
| A14 | **Commandes** : voir, confirmer, changer statut, annuler, imprimer, rechercher | Statuts avançables seulement vers l'avant ; annulée/livrée = définitives | [ ] |
| A15 | Livrer une commande | Stock −n, réservé −n ; mouvement « Vente » | [ ] |
| A16 | Annuler une commande | Réservation libérée ; client notifié | [ ] |
| A17 | **Paiement** : passer une commande en « Payé » | Statut paiement mis à jour | [ ] |
| A18 | **Coupons** : créer, désactiver, supprimer ; usage après commande | Compteur d'utilisations incrémenté | [ ] |
| A19 | **Avis** : approuver / refuser / supprimer | Public seulement si approuvé ; compteur « Avis à modérer » | [ ] |
| A20 | **Notification temps réel** : client passe commande, admin sur une autre page | « Nouvelle commande #JLD-… » apparaît sans actualiser | [ ] |
| A21 | Notifications : marquer lu / tout lu / supprimer | Badge mis à jour | [ ] |
| A22 | **Audit logs** | Connexion admin, produit, stock, statut de commande visibles ; aucune donnée sensible | [ ] |
| A23 | Équipe : ajouter un EDITOR et un SUPPORT | Menus limités à leurs droits | [ ] |
| A24 | Admin sur téléphone : ajouter produit + image, changer un statut | Utilisable à 375 px | [ ] |

## 3. SÉCURITÉ
Se connecter en **client A** puis en **navigation privée (anonyme)**. Les requêtes se testent dans l'onglet *Réseau* ou la console du navigateur avec la clé anon.
| # | Test | Résultat attendu | OK |
|---|---|---|---|
| S1 | Client A ouvre `/admin/` | Refusé, déconnecté | [ ] |
| S2 | Client A lit les commandes / paiements / notifications / adresses du client B (par API) | 0 ligne | [ ] |
| S3 | Client A tente `update products`, `update product_variants set stock_quantity`, `insert coupons` | Refusé ou 0 ligne modifiée | [ ] |
| S4 | Client A appelle `set_order_status`, `admin_set_variant_stock`, `admin_save_variants` | `FORBIDDEN` | [ ] |
| S5 | Client A modifie le prix dans le panier (localStorage) puis commande | La commande utilise le **prix de la base** | [ ] |
| S6 | Client A lit `coupons`, `audit_logs`, `admin_roles`, `inventory_movements` | 0 ligne / refusé | [ ] |
| S7 | Visiteur anonyme lit `orders`, `payments`, `coupons`, `reviews` en attente | Refusé / 0 ligne | [ ] |
| S8 | Client A s'insère un avis avec `status: approved` ou écrit au nom de B | Refusé | [ ] |
| S9 | EDITOR : ouvre Commandes / Coupons / Avis / change un stock | Page refusée ; stock refusé | [ ] |
| S10 | SUPPORT : modifie un produit | Refusé | [ ] |
| S11 | **Storage** : client A tente d'uploader dans `product-images` | Refusé | [ ] |
| S12 | **Fichiers** : renommer un .exe/.html en .jpg, envoyer | Refusé (type MIME contrôlé par le bucket) | [ ] |
| S13 | Clé secrète : chercher `service_role`, `sb_secret`, `RESEND` dans le code source de la page (Ctrl+U) et `js/config.js` | Introuvable | [ ] |
| S14 | Champs texte avec `<script>alert(1)</script>` (nom, avis, adresse, message) | Affiché comme texte, jamais exécuté | [ ] |
| S15 | En-têtes (securityheaders.com) | HSTS, CSP, nosniff, X-Frame-Options présents | [ ] |
| S16 | Deux clients commandent la dernière unité en même temps | Un seul réussit ; l'autre « Produit actuellement indisponible » | [ ] |

## 4. MOBILE ET PERFORMANCE
- [ ] Android (Chrome) : menu, recherche, panier, checkout, admin, upload d'image
- [ ] iPhone (Safari) : idem + encoches/barres système correctes
- [ ] Tablette et ordinateur
- [ ] Largeurs 320, 375, 390, 414, 768, 1024, 1280, 1440, 1920 : aucun débordement horizontal
- [ ] Installation PWA (Ajouter à l'écran d'accueil) ; page « hors ligne » si coupure
- [ ] Lighthouse mobile (accueil, produit) : noter les scores ; images lazy-load
- [ ] Clavier seul : menu, formulaires, boutons atteignables, focus visible

## 5. Avant d'ouvrir au public
- [ ] Toutes les cases ci-dessus cochées, ou écarts consignés
- [ ] `seed.sql` supprimé (`delete from products where sku like 'DEMO-%'`)
- [ ] 2FA activée (Supabase, GitHub, Vercel) ; Confirm email ON ; limites de débit Auth réglées
- [ ] Sauvegardes Supabase activées ; domaine + HTTPS vérifiés ; sitemap.xml accessible
- [ ] Email Resend : domaine vérifié, test de commande reçu


## Paiements — essai en sandbox (à faire AVANT d'activer un mode en production)
1. Saisir les clés **de test** dans Vercel (Stripe `sk_test_…`, PayPal sandbox, MonCash sandbox) et `HTG_PER_USD`.
2. Activer le mode dans `settings.payment_methods`, passer une commande test, payer avec une carte/un compte de test.
3. Vérifier : commande « Payé » dans /orders et dans l'admin, notification reçue, une référence enregistrée dans `payments.provider_ref`.
4. Rejouer l'événement Stripe : la commande ne doit pas être payée deux fois. Abandonner un paiement : la commande doit être annulée par la tâche planifiée (ou appeler `/api/pay`… avec `CRON_SECRET`).
5. Tester l'échec (carte refusée) et la falsification : un appel direct à `confirm_payment` depuis le navigateur doit renvoyer « permission denied ».


## Sécurité + mobile — checklist à dérouler (rien de ceci n'a pu être exécuté pour vous : il faut vos comptes réels)
**CAPTCHA** : inscription, connexion, « mot de passe oublié », contact → le widget s'affiche ; sans le valider, l'envoi est refusé ; un POST direct sur `/api/contact` sans jeton renvoie `CAPTCHA_FAILED`.
**Limites** : envoyer 6 messages de contact d'affilée → le 6e est refusé (429) ; 11 demandes de paiement en 1 minute → refus.
**Signalements** : se connecter, signaler un BIO public → apparaît dans Admin → Signalements ; « Appliquer la mesure » → le BIO devient introuvable.
**Suppression de compte** : créer un compte test, passer une commande, créer un BIO avec photo, faire une demande B2B → `/delete-account` → vérifier : connexion impossible, BIO et fichiers disparus, la commande existe mais sans nom/adresse/téléphone/email. Essayer avec un compte administrateur : refus attendu.
**2FA** : activer sur un compte admin test ; se reconnecter à l'admin → code demandé ; activer `require_admin_mfa` ; vérifier qu'une session sans code n'ouvre aucune donnée admin ; tester le déblocage SQL.
**Push** : sur un téléphone, Compte → Notifications → Activer ; créer une notification pour ce compte (ex. changer le statut d'une commande) → alerte reçue, un toucher ouvre la bonne page ; se déconnecter → plus d'alerte.
**Appareil photo** (app Android) : B2B, BIO (photo), produit vendeur → « Prendre une photo » ouvre la caméra ; refuser la permission → aucun plantage.
**Rappel** : à rejouer aussi la section « Paiements — essai en sandbox » ci-dessus.
