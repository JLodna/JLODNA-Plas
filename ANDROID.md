# JLODNA Plas — application Android (Capacitor)
Dossier `mobile/` : projet **Capacitor 7** qui charge le site officiel `https://www.jlodna.com` dans l'application et ajoute les fonctions natives : **appareil photo** (BIO, B2B, produits vendeur) et **notifications push**. Le code web n'a pas été réécrit : une seule application, un seul code, mises à jour instantanées du site dans l'app.
Identifiant : `com.jlodna.plas` · Icônes : générées depuis votre logo `assets/icons/icon-512.png` (aucun nouveau logo).

## État réel
- ✔ Projet Android généré, plugins synchronisés, permissions déclarées (Internet, caméra, notifications), sauvegarde Android désactivée (confidentialité), trafic non chiffré interdit.
- ✘ **Non compilé** : la génération de l'APK/AAB demande Android Studio + SDK, absents ici. Aucun test sur téléphone n'a été fait.

## Construire l'application (poste Windows)
1. Installer **Android Studio** (SDK 34+) et **Node 20+**.
2. `cd mobile && npm install && npx cap sync android && npx cap open android`
3. **Notifications push** (obligatoire pour les recevoir) :
   - Créer un projet **Firebase** (console.firebase.google.com) → ajouter une app Android `com.jlodna.plas` → télécharger `google-services.json` → le placer dans `mobile/android/app/` (ignoré par git).
   - Firebase → Paramètres → Comptes de service → générer une clé privée (JSON) → la coller dans la variable Vercel `FCM_SERVICE_ACCOUNT` (JSON sur une ligne).
   - Vercel : `PUSH_WEBHOOK_SECRET` = un secret aléatoire long.
   - Supabase → Database → **Webhooks** → créer : table `notifications`, événement **INSERT**, type HTTP Request `POST`, URL `https://www.jlodna.com/api/push/send`, en-tête `x-webhook-secret: <le même secret>`.
4. Android Studio → Build → Generate Signed Bundle (AAB). **Conservez précieusement le fichier de signature (.jks) et ses mots de passe** (hors dépôt).
5. Play Console : fiche, captures, **politique de confidentialité** (URL publique), formulaire « Sécurité des données », catégorie. **URL de suppression de compte à saisir : `https://www.jlodna.com/delete-account`.**

## Ce que Google Play exige — état
| Exigence | État |
|---|---|
| Suppression de compte dans l'app ET via une URL web | ✔ `/delete-account` (aussi dans Compte → Mes données) |
| Signalement des contenus d'utilisateurs | ✔ bouton « Signaler » (BIO, produits) + modération admin |
| Politique de confidentialité publique | ✘ à rédiger et publier (je ne peux pas le faire à votre place) |
| Formulaire « Sécurité des données » | ✘ à remplir (données : email, nom, téléphone, adresses, commandes, photos/vidéos, jeton de notification) |
| Compte personnel : test fermé (≈ 20 testeurs, plusieurs semaines) | à vérifier dans la Play Console |
| Appli « enveloppe de site » | risque de refus si l'app semble n'être qu'un site : l'appareil photo et les notifications natives aident, sans garantie |

## Notes
- Paiements : Stripe / PayPal / MonCash s'ouvrent dans l'application (liste `allowNavigation` dans `mobile/capacitor.config.json`). Produits physiques : pas de Google Play Billing.
- iOS : non fait (nécessite un Mac, un compte Apple Developer et `npx cap add ios`).
- Tester impérativement sur de vrais téléphones : photo (galerie + caméra), permission des notifications (Android 13+), paiement et retour dans l'app, déconnexion.
