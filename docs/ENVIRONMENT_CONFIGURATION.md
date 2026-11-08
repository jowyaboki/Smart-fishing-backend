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
| `CORS_ORIGIN` | Chaîne | `*` (dev uniquement) | **OUI (en prod)** | Origines autorisées pour les requêtes web cross-origin (séparées par une virgule si multiples). En production, le wildcard `*` est interdit. Les requêtes natives Android (sans header Origin) sont toujours autorisées. |
| `TRUST_PROXY` | Booléen / Entier / Chaîne | `false` | Selon infra | Configuration de `trust proxy` d'Express (ex: `true`, `1`, ou plage IP). À activer impérativement lorsque le serveur est placé derrière Nginx, Cloudflare ou un load balancer. |

---

## 2. Règles de Validation par Environnement

### En Production (`NODE_ENV=production`)
- `JWT_SECRET` est **strictement obligatoire**.
- Longueur minimale de `JWT_SECRET` : **32 caractères**.
- Liste noire de clés connues rejetées :
  - `smart-fishing-morocco-secret-key-12345`
  - `supersecretkey_change_in_production`
  - `replace_with_a_secure_random_32_chars_secret_in_production`
  - `secret`, `jwt_secret`, `changeme`, `password`, `12345678`, `1234567890`
- `CORS_ORIGIN` : **L'utilisation du wildcard `*` est strictement interdite**. Vous devez spécifier une ou plusieurs origines HTTPS légitimes séparées par une virgule.
- Si une variable est non conforme, l'application refuse immédiatement de démarrer (`throw Error`) sans jamais divulguer les secrets dans la console.

### En Développement (`NODE_ENV=development`)
- Si `JWT_SECRET` est absent ou trop court, l'application démarre en affichant un avertissement explicite dans la console (`[SECURITY WARNING]`).
- `CORS_ORIGIN=*` est accepté pour faciliter le prototypage web local.

### En Test (`NODE_ENV=test`)
- Si `JWT_SECRET` n'est pas défini, une clé de test dédiée isolée est automatiquement fournie.
- Le logger Morgan est désactivé.
- Le rate limiter est contourné par défaut pour les tests généraux de l'API, avec une suite de tests dédiée (`tests/security.test.ts`) vérifiant son fonctionnement exact.

---

## 3. Configuration Reverse Proxy (Nginx)

Lorsque le backend est déployé derrière Nginx, le rate limiter et la journalisation des adresses IP reposent sur les en-têtes transmis par le proxy.

### Configuration Express (`.env`) :
```dotenv
TRUST_PROXY=1
```
*(ou `TRUST_PROXY=127.0.0.1` si Nginx est sur la même machine)*.

### Exemple de bloc serveur Nginx :
```nginx
server {
    listen 443 ssl http2;
    server_name api.smartfishing.ma;

    ssl_certificate /etc/letsencrypt/live/api.smartfishing.ma/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.smartfishing.ma/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 4. Génération d'une Clé Secrète Sécurisée

Avant tout déploiement en production, générez un secret cryptographique robuste :

```bash
openssl rand -base64 32
```

Exemple de configuration `.env` de production complète :
```dotenv
PORT=3000
NODE_ENV=production
JWT_SECRET=b6N4R+jQ7zV9P0L2sW1kY4eX8aC3vB5nE7rT9uI1oP0=
JWT_EXPIRES_IN=7d
DATABASE_PATH=/var/data/smart_fishing.db
GEMINI_API_KEY=AIzaSy...
CORS_ORIGIN=https://app.smartfishing.ma,https://admin.smartfishing.ma
TRUST_PROXY=1
```
