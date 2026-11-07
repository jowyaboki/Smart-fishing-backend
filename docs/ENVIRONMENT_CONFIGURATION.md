# Guide de Configuration de l'Environnement (Smart Fishing Morocco Backend)

Ce document décrit toutes les variables d'environnement prises en charge par le backend, leurs contraintes de validation, ainsi que les recommandations pour un déploiement sécurisé en production.

---

## 1. Variables d'Environnement

| Variable | Type | Valeur par défaut | Obligatoire en Production ? | Description / Contraintes |
|---|---|---|---|---|
| `PORT` | Entier (1-65535) | `3000` | Non | Port d'écoute du serveur HTTP Express. |
| `NODE_ENV` | Chaîne | `development` | Oui | Environnement d'exécution : `development`, `test` ou `production`. |
| `JWT_SECRET` | Chaîne | *Voir règles ci-dessous* | **OUI** | Clé secrète de signature et vérification des jetons JWT. En production, doit comporter au moins 32 caractères et ne pas être une valeur connue par défaut. |
| `JWT_EXPIRES_IN` | Chaîne (durée ms/zeit) | `7d` | Non | Durée de validité des tokens JWT générés (ex: `7d`, `24h`, `15m`). |
| `DATABASE_PATH` | Chaîne (chemin fichier) | `smart_fishing.db` | Non | Chemin vers le fichier de base de données SQLite. |
| `GEMINI_API_KEY` | Chaîne | *(vide)* | Non | Clé API Google Gemini pour les fonctionnalités de conseil assisté par IA. |
| `CORS_ORIGIN` | Chaîne | `*` | Recommandé | Origines autorisées pour les requêtes web cross-origin (séparées par une virgule si multiples). En production, restreindre aux domaines front-end autorisés. Les requêtes natives Android n'ayant pas d'origine sont autorisées par défaut. |
| `TRUST_PROXY` | Booléen / Nombre / Chaîne | `false` | Selon infra | Configuration de `trust proxy` d'Express (ex: `true`, `1`, ou plage IP). Activer uniquement si l'application est placée derrière un reverse proxy de confiance (NGINX, Cloudflare, ALB). |

---

## 2. Règles de Validation par Environnement

### En Production (`NODE_ENV=production`)
- `JWT_SECRET` est **strictement obligatoire**.
- Longueur minimale de `JWT_SECRET` : **32 caractères**.
- Liste noire de clés connues rejetées :
  - `smart-fishing-morocco-secret-key-12345`
  - `supersecretkey_change_in_production`
  - `secret`, `jwt_secret`, `changeme`, `password`, `12345678`, `1234567890`
- Si la configuration est invalide, le processus s'arrête immédiatement (`throw Error`) avec un détail explicite sans jamais divulguer les secrets dans la console.

### En Développement (`NODE_ENV=development`)
- Si `JWT_SECRET` est absent ou trop court, l'application démarre tout de même en affichant un avertissement explicite dans la console (`[SECURITY WARNING]`).
- Permet aux développeurs de tester localement sans friction superflue.

### En Test (`NODE_ENV=test`)
- Si `JWT_SECRET` n'est pas défini, une clé de test dédiée isolée est automatiquement fournie pour éviter toute instabilité de la suite de tests.
- Le logger Morgan est coupé pour ne pas polluer la sortie Vitest.
- Le Rate Limiting par défaut s'efface pour permettre les tests d'intégration sans latence, tandis que des tests ciblés vérifient son bon fonctionnement.

---

## 3. Génération d'une Clé Secrète Sécurisée

Avant tout déploiement en production, générez un secret cryptographiquement robuste via OpenSSL :

```bash
openssl rand -base64 32
```

Exemple de variable générée à renseigner dans les secrets de déploiement :
```dotenv
JWT_SECRET=b6N4R+jQ7zV9P0L2sW1kY4eX8aC3vB5nE7rT9uI1oP0=
```

---

## 4. Exemple de fichier `.env` pour la Production

```dotenv
PORT=3000
NODE_ENV=production
JWT_SECRET=VOTRE_SECRET_CRYPTO_ALEATOIRE_D_AU_MOINS_32_CARACTERES
JWT_EXPIRES_IN=7d
DATABASE_PATH=/var/data/smart_fishing.db
GEMINI_API_KEY=AIzaSy...
CORS_ORIGIN=https://app.smartfishing.ma,https://admin.smartfishing.ma
TRUST_PROXY=1
```
