# Rapport de Durcissement de la Sécurité (P0 Security & Configuration Hardening)

Ce rapport documente les vulnérabilités identifiées et corrigées sur le backend TypeScript du projet **Smart Fishing Morocco**, les protections mises en œuvre, la couverture de tests et les exigences de déploiement en production.

---

## 1. Vulnérabilités Découvertes et Traitées

L'audit approfondi préalable et l'analyse de revue de code ont relevé les faiblesses suivantes :

1. **Clé secrète JWT par défaut et prévisible (CWE-798 / CWE-1188) :**
   - Fallback statique dangereux (`"smart-fishing-morocco-secret-key-12345"` et `"supersecretkey_change_in_production"`).
   - *Correction :* Suppression du fallback en production. Rejet au démarrage via Zod si `JWT_SECRET` est absent, fait moins de 32 caractères ou correspond à une clé par défaut connue.
2. **Vulnérabilité d'Algorithme JWT (CWE-327 / Algorithme 'none' et confusion de clés) :**
   - Le middleware de vérification et le service d'authentification ne spécifiaient pas explicitement l'algorithme cryptographique.
   - *Correction :* Verrouillage strict de l'algorithme sur `HS256` à la signature et à la vérification (`algorithms: ['HS256']`). Rejet immédiat de tout token utilisant un algorithme non autorisé (ex: `none`, `RS256`).
3. **Validation incomplète des claims JWT (CWE-287) :**
   - Absence de vérification des types et de la non-vacuité des claims essentiels `sub` et `email`.
   - *Correction :* Validation stricte des claims dans `authMiddleware` ; rejet sécurisé avec HTTP 401 si `sub` ou `email` sont manquants ou invalides.
4. **Origine CORS non restreinte en Production (CWE-942) :**
   - Risque d'exposition avec un wildcard `*` autorisant n'importe quel site tiers dans un navigateur web.
   - *Correction :* Interdiction formelle de `CORS_ORIGIN=*` en production validée par Zod. Support d'une liste explicite d'origines autorisées (séparées par virgules) tout en préservant le bon fonctionnement des requêtes Android natives sans en-tête `Origin`.
5. **Usurpation d'IP via headers X-Forwarded-For (CWE-348) :**
   - Risque de contournement du rate limiting si le backend fait aveuglément confiance aux en-têtes transmis par des clients non autorisés.
   - *Correction :* `trust proxy` configuré explicitement (désactivé par défaut, activable selon le déploiement reverse proxy de confiance).
6. **Absence de Rate Limiting sur les routes d'authentification (CWE-307) :**
   - Risque de force brute sur `/login` et `/register`.
   - *Correction :* Intégration de `express-rate-limit` limitant à 10 requêtes par 15 minutes par IP avec réponse HTTP 429 explicite.
7. **Politique de mot de passe faible (CWE-521) :**
   - Minimum de 6 caractères insuffisant pour les nouveaux comptes.
   - *Correction :* Minimum porté à 8 caractères à l'inscription (`registerSchema`), tout en conservant `min(1)` sur `/login` pour préserver l'accès aux comptes existants.
8. **Déni de service par payload JSON démesuré et JSON malformé (CWE-400 / CWE-20) :**
   - *Correction :* Limitation stricte de `express.json({ limit: '1mb' })` avec interception renvoyant HTTP 413, et gestion propre des erreurs de syntaxe JSON renvoyant HTTP 400.
9. **Exposition potentielle de données sensibles et de stack traces (CWE-209 / CWE-532) :**
   - *Correction :* `password_hash` exclu de toutes les réponses API. Les erreurs 500 en production renvoient un message générique sans trace de pile.

---

## 2. Fichiers Modifiés et Ajoutés

### Fichiers Modifiés :
- `src/config/index.ts` : Schéma Zod complet, validation stricte de `JWT_SECRET`, interdiction de `CORS_ORIGIN=*` en production, validation de `PORT`, `NODE_ENV`, `TRUST_PROXY` et `JWT_EXPIRES_IN`.
- `src/services/authService.ts` : Signature JWT explicitement restreinte à `HS256`, normalisation systématique des emails (`trim().toLowerCase()`), exclusion garantie de `password_hash`.
- `src/middlewares/authMiddleware.ts` : Vérification JWT restreinte à `HS256`, validation stricte des claims `sub` et `email`, gestion sans fuite d'informations des erreurs d'authentification (HTTP 401).
- `src/routes/authRoutes.ts` : Validation Zod `password >= 8` à l'inscription, normalisation des entrées, rate limiting appliqué aux routes `/register` et `/login`.
- `src/app.ts` : Configuration CORS sécurisée (multi-origines + support mobile Android), `express.json({ limit: '1mb' })`, configuration contrôlée de `trust proxy`.
- `src/middlewares/errorHandler.ts` : Traitement des erreurs CORS (403), JSON malformé (400), payload trop volumineux (413), masquage des erreurs serveur en production.
- `.env.example` : Documentation exhaustive de chaque variable et recommandations.
- `package.json` : Ajout de la dépendance officielle `express-rate-limit`.

### Fichiers Ajoutés :
- `src/middlewares/rateLimiter.ts` : Factory de rate limiting configurée à 10 tentatives / 15 minutes par IP avec validation anti-crash sur les headers proxy.
- `tests/config.test.ts` : 10 tests unitaires validant l'ensemble des règles de configuration Zod.
- `tests/security.test.ts` : 17 tests de régression de sécurité couvrant l'algorithme JWT, l'absence de claims, l'expiration, le rate limiter, le spoofing IP, CORS et les erreurs HTTP.
- `docs/SECURITY_HARDENING_REPORT.md` : Présent rapport.
- `docs/ENVIRONMENT_CONFIGURATION.md` : Documentation des variables et du guide de déploiement reverse proxy.

---

## 3. Résultats des Tests et Contrôles Qualité

L'ensemble de la suite de tests a été exécutée avec succès via Vitest :
```text
Test Files  4 passed (4)
Tests       50 passed (50)
```

- `npm run lint` (`tsc --noEmit`) : 0 erreur.
- `npm run build` (`tsc`) : Compilation réussie.

---

## 4. Recommandations et Exigences de Déploiement en Production

1. **Secret JWT :** Générer une clé d'au moins 32 caractères via `openssl rand -base64 32`.
2. **Reverse Proxy (Nginx / Cloudflare / AWS ALB) :**
   - Configurer `TRUST_PROXY=1` ou la liste d'adresses IP des proxys de confiance.
   - S'assurer que le reverse proxy écoute en HTTPS et transmet l'adresse IP client dans `X-Forwarded-For`.
3. **CORS :** Renseigner dans `CORS_ORIGIN` la liste exacte des noms de domaine web légitimes (ex: `https://app.smartfishing.ma,https://admin.smartfishing.ma`).
4. **Évolution future (P1/P2) :**
   - Pour un déploiement multi-instances derrière un load balancer, connecter `express-rate-limit` à un store Redis / Valkey partagé.
   - Implémenter un schéma de Refresh Tokens avec révocation en base de données.
