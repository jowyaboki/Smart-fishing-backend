# Rapport de Durcissement de la Sécurité (P0 Security & Configuration Hardening)

Ce rapport documente les vulnérabilités identifiées et corrigées sur le backend TypeScript du projet **Smart Fishing Morocco**, les protections mises en œuvre, la couverture de tests et les risques résiduels.

---

## 1. Vulnérabilités Découvertes

Avant cette intervention de sécurisation (P0), l'audit préalable a relevé plusieurs faiblesses critiques :

1. **Clé secrète JWT par défaut vulnérable (CWE-798 / CWE-1188) :**
   - La configuration contenait une clé de secours en dur : `"smart-fishing-morocco-secret-key-12345"` et `.env.example` proposait `"supersecretkey_change_in_production"`.
   - Si l'environnement de production était déployé sans variable `JWT_SECRET`, le serveur démarrait silencieusement avec cette clé connue, permettant à n'importe quel attaquant de forger des jetons d'authentification valides avec les privilèges de n'importe quel utilisateur.
2. **Absence de validation stricte de la configuration au démarrage (CWE-16) :**
   - Aucune validation Zod ou vérification de l'intégrité / longueur des secrets n'était effectuée au lancement de l'application.
3. **Absence de Rate Limiting sur les routes d'authentification (CWE-307) :**
   - Les endpoints `/api/v1/auth/login` et `/api/v1/auth/register` étaient exposés aux attaques de force brute et par déni de service.
4. **Politique de mot de passe trop permissive (CWE-521) :**
   - La longueur minimale acceptée à l'inscription était de seulement 6 caractères sans assainissement ni normalisation.
5. **Absence de contrôle de taille sur le payload JSON (CWE-400 / CWE-770) :**
   - `express.json()` utilisait la valeur par défaut sans limitation explicite à 1 Mo, exposant le service à des payloads démesurés.
6. **Absence de contrôle fin des origines CORS (CWE-942) :**
   - `cors()` autorisait indistinctement toutes les origines web sans configuration possible.
7. **Gestion des erreurs et fuite potentielle de données sensibles :**
   - Les messages d'erreurs en production risquaient d'exposer des détails internes (`stack`, `password_hash`).

---

## 2. Fichiers Modifiés et Ajoutés

### Fichiers Modifiés :
- `src/config/index.ts` : Remplacement du fallback statique par un schéma de validation strict Zod, interdisant le démarrage en production sans un secret robuste d'au moins 32 caractères et bloquant les clés connues.
- `src/routes/authRoutes.ts` : Passage de la politique de mot de passe à l'inscription à 8 caractères minimum, normalisation (`trim()` et `toLowerCase()`) des emails, et application du middleware de rate limiting.
- `src/services/authService.ts` : Normalisation stricte des entrées utilisateurs (email, nom, région) et garantie d'absence d'exposition de `password_hash`.
- `src/middlewares/authMiddleware.ts` : Vérification rigoureuse du Bearer token, distinction explicite des tokens expirés (`TokenExpiredError`) et rejet des payloads malformés.
- `src/app.ts` : Configuration CORS stricte et paramétrable (tout en préservant le fonctionnement des requêtes Android natives sans header Origin), limitation JSON à 1 Mo, et support configurable de `trust proxy`.
- `src/middlewares/errorHandler.ts` : Interception des erreurs de taille de payload (413), des violations de politique CORS (403) et masquage des erreurs internes 500 en production.
- `.env.example` : Mise à jour avec documentation exhaustive des variables et directives de sécurité pour la production.
- `package.json` : Ajout de la dépendance maintenue `express-rate-limit`.

### Fichiers Ajoutés :
- `src/middlewares/rateLimiter.ts` : Implémentation du limiteur de requêtes (10 requêtes par fenêtre de 15 minutes par IP sur `/login` et `/register`) avec mode bypass contrôlé pour les tests Vitest.
- `tests/config.test.ts` : Tests unitaires de validation de la configuration (production, développement, tests, secrets courts ou par défaut, port invalide).
- `tests/security.test.ts` : Tests d'intégration de sécurité (rejet des mots de passe < 8 caractères, normalisation des emails, expiration/falsification de jetons JWT, vérification de rate limiter, limitation de charge utile à 1 Mo, requêtes sans header origin).
- `docs/SECURITY_HARDENING_REPORT.md` : Le présent rapport d'audit et de durcissement.
- `docs/ENVIRONMENT_CONFIGURATION.md` : Guide de configuration des variables d'environnement.

---

## 3. Protections Mises en Œuvre

1. **Validation Stricte de la Configuration Zod au Démarrage :**
   - En environnement `NODE_ENV=production` : `JWT_SECRET` est obligatoire, doit faire au minimum 32 caractères, et ne doit correspondre à aucun secret de développement connu (`smart-fishing-morocco-secret-key-12345`, `supersecretkey_change_in_production`, etc.). Tout manquement provoque l'arrêt immédiat avec un message d'erreur explicite sans jamais divulguer les secrets dans les logs.
   - En environnement `development` : Fallback temporaire de développement autorisé avec un avertissement de sécurité (`[SECURITY WARNING]`).
   - En environnement `test` : Utilisation sécurisée et isolée d'un secret dédié.
2. **Rate Limiting Anti-Bruteforce :**
   - Mise en place de `express-rate-limit` limitant à 10 tentatives toutes les 15 minutes par IP les endpoints `/api/v1/auth/register` et `/api/v1/auth/login`. En cas de dépassement, le code HTTP 429 est retourné avec un message clair.
3. **Authentification JWT Robuste :**
   - Expiration gérée via `JWT_EXPIRES_IN`.
   - Rejet immédiat des tokens falsifiés, mal formés ou expirés (HTTP 401).
   - Les routes privées vérifient systématiquement la présence et la conformité du payload (`sub`, `email`).
4. **Politique de Mot de Passe & Compatibilité Android :**
   - Le schéma d'inscription impose désormais `min(8)` caractères.
   - L'endpoint de login conserve `min(1)` pour garantir la rétrocompatibilité des comptes utilisateurs préalablement enregistrés.
   - Normalisation standard des adresses e-mail (`trim().toLowerCase()`).
   - Vérification que `password_hash` n'est jamais présent dans les réponses API (`user` DTO).
5. **Sécurisation HTTP & CORS :**
   - Headers de sécurité via `helmet`.
   - `express.json({ limit: '1mb' })` prévenant les attaques DoS mémoire.
   - CORS paramétrable par variable d'environnement `CORS_ORIGIN` autorisant les clients mobiles Android (qui n'envoient pas de header `Origin`).
   - Gestion sécurisée de `trust proxy` pour les environnements sous reverse-proxy (NGINX, Traefik, AWS ALB).

---

## 4. Tests Exécutés et Résultats

L'ensemble de la suite de tests a été exécutée via Vitest :
- `tests/config.test.ts` (8 tests) : Validation Zod, blocage prod sans JWT_SECRET ou avec secret faible/connu, tolérance dev/test.
- `tests/security.test.ts` (11 tests) : Rejet mot de passe court, normalisation, token expiré / altéré, non-exposition du hash, rate limiting (HTTP 429), payload > 1 Mo (HTTP 413).
- `tests/api.test.ts` (20 tests) : Endpoints existants auth, marine, journal, fishing, encyclopedia, IA.
- `tests/scoringEngine.test.ts` (3 tests) : Algorithmes de calcul du score de pêche.

**Résultats de la commande `npm test` :**
```text
Test Files  4 passed (4)
Tests       42 passed (42)
```

**Résultats des contrôles statiques :**
- `npm run lint` (`tsc --noEmit`) : Réussite sans aucune erreur TypeScript.
- `npm run build` (`tsc`) : Compilation réussie du code source dans `dist/`.

---

## 5. Risques Restants à Traiter

Bien que les risques P0 immédiats soient résolus, les points suivants méritent d'être planifiés dans une phase ultérieure :

1. **Mécanisme de Refresh Tokens :**
   - Actuellement, l'authentification repose sur un Access Token valide 7 jours. L'implémentation future d'un système de token d'accès court (ex. 15 minutes) combiné à un Refresh Token révocable en base de données augmenterait la résilience en cas de compromission de token.
2. **Réinitialisation de mot de passe & Vérification d'Email :**
   - Aucun flux "Mot de passe oublié" ou confirmation d'email n'est actuellement présent sur le backend.
3. **Persistance décentralisée pour le Rate Limiting en cluster :**
   - Le rate limiter utilise le stockage en mémoire par défaut. Si le backend est mis à l'échelle horizontalement (plusieurs instances / conteneurs), un store partagé (Redis / Valkey) sera recommandé.
4. **Rotation des clés JWT :**
   - Prévoir une procédure ou un service supportant la rotation de clé (liste de clés acceptées pour la vérification pendant la transition).
