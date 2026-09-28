# Mémoire — Ce qu'il faudra faire au déploiement sur Vercel

> **Rédigé le** : 1er septembre 2026
> **Statut du projet à cette date** : aucun déploiement Vercel. Tout ce qui suit
> est à faire **le jour où** vous déployez, pas avant.
> **Contexte** : les six étapes de l'audit technique ont été traitées. Plusieurs
> correctifs ne prennent leur pleine valeur qu'une fois en production — c'est
> l'objet de ce document.
>
> Le détail de ce qui a été corrigé est reporté dans la documentation
> d'architecture : [`architecture.md`](../architecture/architecture.md),
> [`bdd.md`](../architecture/bdd.md), [`API-rest.md`](../architecture/API-rest.md).

---

## 0. Rappel d'architecture — ce qui va où

**Seul le Next.js va sur Vercel.** Le backend FastAPI (`backend/`) n'y a pas sa
place et n'y fonctionnerait pas :

- il fait tourner **APScheduler** en tâche de fond (`phase1_scanner`,
  `phase2_enricher`, `crowdsourcing_processor`). Une fonction serverless ne vit
  que le temps d'une requête : les crons ne tourneraient jamais ;
- il maintient un **pool de connexions psycopg2** (`backend/db.py`, 1 à 5
  connexions) qui suppose un processus long ;
- l'état des quotas Tavily (`TavilyKeyManager`) vit **en mémoire du processus**.
  Réparti sur N invocations, le compteur serait faux — c'est exactement le
  défaut corrigé lors de la remédiation — voir
  [`architecture.md`](../architecture/architecture.md) §4.2.

→ **Le backend reste sur un hébergeur à processus long** (Koyeb, Railway,
Render, un VPS…). Vercel héberge le front et le back-office ; les deux
communiquent par `FASTAPI_URL` + `INTERNAL_API_TOKEN`.

---

## 1. Variables d'environnement à créer sur Vercel

Project Settings → Environment Variables. La liste commentée complète est dans
[`.env.example`](../../.env.example) ; voici ce qui est spécifique à Vercel.

### Obligatoires — l'application ne démarre pas sans

| Variable | Valeur | Piège |
|----------|--------|-------|
| `DATABASE_URL` | URL **pooler** Neon | Le pooler, pas la directe. Chaque invocation ouvre sa connexion : sans PgBouncer, le palier Neon sature. |
| `DIRECT_URL` | URL **directe** Neon | Utilisée par le CLI Prisma pendant le build. PgBouncer ne supporte pas les migrations. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` | **Générer une valeur neuve.** Ne pas réutiliser celle de développement. |
| `NEXTAUTH_URL` | `https://votre-domaine.vercel.app` | NextAuth v4 en a besoin en production. Elle n'apparaît nulle part dans le code, ce qui la rend facile à oublier — et son absence casse la connexion. |
| `FASTAPI_URL` | URL publique du backend | Sans barre finale. |
| `INTERNAL_API_TOKEN` | secret partagé | **Exactement la même valeur** que côté FastAPI. Nom canonique depuis l'étape 6 ; si vous aviez `FASTAPI_INTERNAL_TOKEN`, renommez-la. |

### Fortement recommandées

| Variable | Pourquoi |
|----------|----------|
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | **Le point le plus important de cette page.** Voir §4. |
| `CONTRIBUTION_ALLOWED_DOMAINS` | Sans elle, une contribution ne peut citer que le site de l'école. Les catégories `Ranking` et `Accreditation` deviennent presque inalimentables. Ex. : `ft.com,letudiant.fr,lefigaro.fr,cti-commission.fr,cge.asso.fr` |

### À NE PAS mettre sur Vercel

| Variable | Pourquoi |
|----------|----------|
| `SEED_ADMIN_PASSWORD` | Le seed ne tourne pas sur Vercel (voir §3). L'y placer expose un secret sans usage. |
| `SHADOW_DATABASE_URL` | Uniquement utile au CLI Prisma en développement. |

> **Environnements Vercel** : renseignez les variables pour *Production* **et**
> *Preview* si vous utilisez les déploiements de préversion — sinon les
> previews échoueront au démarrage. Attention : une preview qui pointe sur la
> base de production écrit dans les vraies données.

---

## 2. Build

Le script de build a été mis à jour :

```json
"build": "prisma generate && next build"
```

**Pourquoi c'est indispensable** : Prisma 7 n'a plus de hook `postinstall` qui
génère le client automatiquement. Sans le `prisma generate` explicite, le build
Vercel partirait sans client Prisma généré — ou avec un client obsolète issu du
cache de `node_modules`. Vérifié localement : `npm run build` passe.

**Ne pas ajouter `prisma migrate deploy` au build.** Le build Vercel s'exécute à
chaque déploiement, y compris sur les previews et les rollbacks : une migration
s'y jouerait à des moments imprévisibles, sur la base pointée par les variables
de cet environnement. Voir §3 pour la marche à suivre.

**Node** : le projet cible Node 20+ (la CI utilise 20). Le réglage par défaut de
Vercel convient ; le fixer explicitement évite une surprise lors d'un futur
changement de leur défaut.

---

## 3. Base de données et migrations

L'historique de migrations a été remis en phase avec le schéma à l'étape 2, et
un index a été ajouté ensuite. **Cinq migrations** existent aujourd'hui, dont
`20260901120000_program_campus_refactor`, écrite à la main pour préserver les
données.

### Marche à suivre, dans cet ordre

1. **Appliquer les migrations depuis votre machine, avant le déploiement** :

   ```bash
   DIRECT_URL="<url directe de la base de production>" npx prisma migrate deploy
   ```

2. **Cas particulier — base déjà alignée par `prisma db push`.** Si la base de
   production a été mise à jour par `db push` (comme l'était la base de dev),
   `migrate deploy` échouera en tentant de recréer des colonnes existantes.
   Il faut alors la *baseliner* :

   ```bash
   npx prisma migrate resolve --applied 20260901120000_program_campus_refactor
   npx prisma migrate resolve --applied 20260901160000_inbox_status_index
   ```

   Vérifier d'abord que la base correspond bien au schéma :

   ```bash
   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   # doit répondre : -- This is an empty migration.
   ```

3. **`prisma db push` est proscrit en production.** C'est son usage qui avait
   désynchronisé le schéma au point de rendre toute reconstruction impossible.
   Un garde-fou de CI le vérifie déjà.

### Le seed

`npx prisma db seed` utilise `tsx`, qui est une **devDependency** : il ne
tournera pas dans un environnement installé avec `npm ci --omit=dev`. C'est
voulu — la création du compte administrateur est une opération d'exploitation,
pas une étape de build.

```bash
# Depuis votre machine, une seule fois, contre la base de production
SEED_ADMIN_PASSWORD="<mot de passe fort, 12 à 72 caractères>" \
DATABASE_URL="<url pooler production>" \
npx prisma db seed
```

Le seed **échoue** si `SEED_ADMIN_PASSWORD` est absente : il n'existe plus de
mot de passe par défaut depuis l'étape 1.

---

## 4. Limitation de débit — le point critique

`lib/rate-limit.ts` fonctionne avec deux magasins : Upstash Redis si les
variables sont présentes, **repli mémoire sinon**.

**Sur Vercel, le repli mémoire ne protège de rien.** Chaque invocation à froid
d'une fonction repart d'un compteur vide, et plusieurs instances tournent en
parallèle. Concrètement, sans magasin partagé :

| Plafond | Ce qu'il devient sans Upstash |
|---------|-------------------------------|
| 5 tentatives de connexion / 15 min | contournable en provoquant des démarrages à froid |
| 5 contributions / 20 s | idem — **et chaque ticket coûte des crédits Tavily** |
| 60 appels `/api/v1` / min | idem — aspiration de la base possible |

**À faire** : créer une base Upstash Redis (le palier gratuit suffit
largement) ou activer Vercel KV, qui expose la même API REST, puis renseigner
`UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`.

Le code écrit une ligne d'avertissement au premier usage quand il retombe en
mémoire — la chercher dans les logs Vercel après le premier déploiement est un
bon contrôle.

**Bonne nouvelle côté identification** : `clientIp()` interroge
`x-vercel-forwarded-for` en premier, un en-tête que Vercel **écrase** et qu'un
client ne peut donc pas forger. C'était le défaut corrigé à l'étape 4 : l'ancien
code se fiait à `x-forwarded-for`, contrôlable par l'appelant.

---

## 5. En-têtes de sécurité

Posés par `next.config.ts` sur `/:path*` — le mécanisme `headers()` de Next
fonctionne nativement sur Vercel, rien à configurer.

**Vérifié sur un build de production réel** (`npm run build && npm start`) :
la page rend correctement, et `'unsafe-eval'` est bien **absent** de la CSP en
production — il n'apparaît qu'en développement, pour le rafraîchissement à
chaud.

### Deux points à surveiller après le premier déploiement

1. **`Strict-Transport-Security` contient `preload`.** Cette directive engage
   votre domaine vers la liste de préchargement HSTS des navigateurs, et **en
   sortir prend des mois**. Ne la conservez que si vous êtes certain que le
   domaine et **tous ses sous-domaines** resteront en HTTPS. Dans le doute,
   retirez `preload` (et éventuellement `includeSubDomains`) de
   `next.config.ts` avant le premier déploiement public.

2. **Ouvrir la console du navigateur** sur `/admin` et sur `/contribute`, et
   chercher les violations `Content-Security-Policy`. La CSP conserve
   `'unsafe-inline'` sur `script-src` (Next injecte l'amorçage d'hydratation en
   ligne) ; le passage à une CSP à nonce reste un chantier identifié et non
   fait.

---

## 6. CORS côté backend FastAPI

Deux variables à poser **sur l'hébergeur du backend**, pas sur Vercel :

| Variable | Valeur | Conséquence si oubliée |
|----------|--------|------------------------|
| `ENVIRONMENT` | `production` | Tant qu'elle ne vaut pas `production`, `/docs`, `/redoc` **et** `/openapi.json` restent **ouverts** et publient la surface complète de l'API interne, routes `/internal/*` comprises. Elle décide aussi du cron : hors production, `phase1_scanner` et `phase2_enricher` ne sont pas inscrits (forçage : `CRON_RESEARCH_ENABLED`). |
| `ALLOWED_ORIGINS` | `https://votre-domaine.vercel.app` | En production, si elle est absente, **aucune origine croisée n'est acceptée** et une erreur est journalisée au démarrage. |

À noter : les appels Next.js → FastAPI sont des appels **serveur à serveur**.
Ils ne passent pas par CORS et fonctionnent même avec `ALLOWED_ORIGINS` vide.
La variable ne concerne que d'éventuels appels directs depuis un navigateur.

---

## 7. Ce qui ne tournera pas sur Vercel

| Fonctionnalité | Où elle vit | Conséquence |
|----------------|-------------|-------------|
| `phase1_scanner` (cartographie) | APScheduler, backend FastAPI | rien à faire côté Vercel |
| `phase2_enricher` (enrichissement) | idem | idem |
| `crowdsourcing_processor` | idem, toutes les minutes | **les contributions publiques ne seront traitées que si le backend tourne.** Sans lui, les tickets s'accumulent en `Pending_AI`. |

Si vous vouliez un jour tout mettre sur Vercel, il faudrait remplacer
APScheduler par des **Vercel Cron Jobs** appelant des routes dédiées — et
résoudre la question de l'état des quotas Tavily, qui ne survivrait pas au
passage en serverless.

---

## 8. Ordre des opérations recommandé

1. Créer la base Upstash / activer Vercel KV → récupérer les deux variables.
2. Déployer le **backend FastAPI** d'abord, avec `ENVIRONMENT=production`,
   `ALLOWED_ORIGINS`, `INTERNAL_API_TOKEN`, `DATABASE_URL`, `GEMINI_API_KEY`,
   les clés Tavily. Noter son URL publique.
3. Appliquer les migrations sur la base de production (§3).
4. Créer le projet Vercel, renseigner **toutes** les variables du §1.
5. Déployer. Vérifier que le build passe (`prisma generate && next build`).
6. Lancer le seed depuis votre machine (§3).
7. Se connecter sur `/admin/login`, puis **changer immédiatement le mot de
   passe** via `/admin/users` → « Changer mon mot de passe ».
8. Compléter `ALLOWED_ORIGINS` côté backend avec le domaine Vercel définitif.
9. Dérouler les vérifications du §9.

---

## 9. Vérifications après le premier déploiement

| # | Contrôle | Attendu |
|---|----------|---------|
| 1 | Logs Vercel au démarrage | **aucune** ligne `[rate-limit] Aucun magasin partagé configuré` |
| 2 | 6 tentatives de connexion erronées d'affilée | la 6ᵉ renvoie **429** |
| 3 | `curl -I https://<domaine>/admin/login` | les 6 en-têtes de sécurité présents |
| 4 | `curl https://<backend>/docs` | **404** (documentation fermée) |
| 5 | `curl https://<backend>/openapi.json` | **404** |
| 6 | `/admin` sans session | redirection vers `/admin/login` |
| 7 | Panneau admin → état du pipeline | `database: connected` **réel** (branché à l'étape 5) et section `scheduler` renseignée |
| 8 | Soumettre une contribution avec une URL hors du domaine de l'école | **400** avec message explicite |
| 9 | ~65 appels rapides sur `/api/v1/schools` | 429 au-delà de 60/min |
| 10 | Console navigateur sur `/admin` | aucune violation CSP |

---

## 10. Ce qui est déjà prêt — à ne pas refaire

Pour éviter de rejouer des corrections déjà faites :

- ✅ `dotenv` est passé en dépendance de production — `npm ci --omit=dev` ne
  plantera plus au démarrage (étape 2).
- ✅ Le compte `admin`/`admin` n'existe plus ; le seed exige un mot de passe
  fourni (étape 1).
- ✅ La limitation de débit couvre `/api/auth/callback/credentials`,
  `/api/contribute` et `/api/v1`, et s'appuie sur l'IP de plateforme (étapes
  1 et 4).
- ✅ Les en-têtes de sécurité sont posés et vérifiés sur un build de production
  (étape 5).
- ✅ Chaque route admin choisit explicitement `guardAuth` ou `guardAdmin`
  (étape 5).
- ✅ Les migrations reconstruisent une base vierge à l'identique du schéma —
  vérifié (étapes 2 et suivantes).
- ✅ `/docs`, `/redoc`, `/openapi.json` se ferment sur `ENVIRONMENT=production`
  (étape 5).

---

## 11. Chantiers ouverts, à trancher avant ou après le déploiement

1. **Vulnérabilités npm : traitées le 1er septembre 2026** (commit `4d5f85d`).
   13 sur 16, dont la critique `next-auth` et le *bypass de middleware* de
   `next`. Restent quatre hautes (`deepmerge-ts`, `mysql2`), toutes tirées par
   la CLI Prisma : risque accepté, détail et surveillance dans
   [`architecture.md`](../architecture/architecture.md), *Sécurité des
   dépendances*. **Les sept contrôles d'exécution ont été joués le 2 septembre
   2026 et sont tous au vert**, contrôle des violations CSP au navigateur
   compris — détail dans [`architecture.md`](../architecture/architecture.md),
   *Contrôles d'exécution non automatisés*.
2. **CSP à nonce**, pour retirer `'unsafe-inline'` de `script-src`.
3. **Les 114 avertissements ESLint** (étape 6, §3.1).
4. **Le prompt d'extraction multi-programme** ne restitue pas le campus : les
   capacités des programmes multi-campus sont écartées et signalées plutôt
   qu'écrites au hasard (étape 3, §3.5).

---

## 12. Base de CI éphémère — à faire juste avant le déploiement

> **Pour l'agent qui reprendra ce point.** Cette section est autoportante :
> elle suppose que vous ne connaissez ni ce dépôt ni l'historique. Lisez-la
> entièrement avant de toucher au workflow.

### L'état actuel, et pourquoi il est provisoire

`.github/workflows/ci.yml`, étape **« Prisma — statut des migrations »**,
exécute `npx prisma migrate status` **contre la base Neon partagée**, celle
que désignent les secrets `DATABASE_URL` / `DIRECT_URL` du dépôt.

Depuis le 2 septembre 2026, elle ne fait échouer le job que sur les branches
d'intégration :

```yaml
continue-on-error: ${{ !(github.ref == 'refs/heads/main'
                      || github.ref == 'refs/heads/devresearch'
                      || github.base_ref == 'main') }}
```

**C'est un palliatif assumé, pas une solution.** Il déplace le symptôme, il ne
retire pas la cause.

### La cause

`prisma migrate status` répond à deux questions que rien ne distingue :

1. *« Ces migrations sont-elles cohérentes et applicables ? »* — une propriété
   du **code**, vraie ou fausse sur n'importe quelle branche, indépendamment
   de toute base.
2. *« Cette base-là est-elle à jour ? »* — un **état de déploiement**, qui n'a
   rien à faire dans la validation d'une branche de travail.

Seule la première relève d'une CI de branche. En interrogeant une base
partagée, l'étape impose la seconde partout.

**Ce que ça a coûté, concrètement.** Le 2 septembre 2026, trois branches
successives ont buté dessus en une matinée. Une branche qui ajoute une
migration échouait tant que cette migration n'avait pas été appliquée à la
base commune — donc **avant même que le code soit relu**. L'ordre imposé est
absurde : appliquer en base précède la revue.

### Ce que personne ne vérifie aujourd'hui

Aucun test, nulle part, ne vérifie que **les migrations s'appliquent proprement
sur une base vierge**. `migrate status` compare un journal à une base déjà
migrée ; il ne rejoue jamais l'historique depuis zéro.

Conséquence directe pour le déploiement : une migration cassée — colonne
inexistante, ordre de dépendances faux, `DROP` qui échoue — ne se découvrirait
qu'en production. C'est le vrai risque, et il est plus grave que le désagrément
qui a motivé le palliatif.

### Ce qu'il faut construire

Un **service Postgres éphémère** dans le job `validate` : un conteneur jetable,
créé pour le run, détruit après. On y joue `prisma migrate deploy` depuis une
base vide. Ça teste la question n°1 seule, sur toutes les branches, sans état
partagé et sans ordre imposé.

### Les pièges propres à ce dépôt

**1. `DIRECT_URL` gagne sur `DATABASE_URL`.** [`prisma.config.ts`](../../prisma.config.ts)
choisit la variable de migration ainsi :

```ts
const MIGRATION_URL_VAR = process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL";
```

Le job définit **les deux** depuis les secrets. Un agent qui ne surchargerait
que `DATABASE_URL` pour pointer le conteneur verrait ses migrations partir
quand même vers Neon, sans le moindre avertissement. **Surcharger `DIRECT_URL`
est obligatoire** — c'est elle qui est lue.

**2. `schema.prisma` ne porte pas d'URL.** Son bloc `datasource db` n'a qu'un
`provider = "postgresql"` ; l'URL vient entièrement de `prisma.config.ts`, qui
charge `.env.local` puis `.env` avant de résoudre. En CI ces fichiers n'existent
pas, donc seules les variables d'environnement du job comptent.

**3. Ne jamais utiliser `prisma db push` pour préparer la base de CI.** Ce
serait contourner précisément ce qu'on cherche à tester, et le garde-fou du
workflow fait échouer le job s'il détecte ce motif. Utiliser `migrate deploy`.

**4. Le poste de développement ne peut pas joindre Postgres.** La sortie TCP
sur le port 5432 y est filtrée (voir [`architecture.md`](../architecture/architecture.md),
*Intégration continue*). Ce chantier **ne peut pas se tester en local** : il
s'itère dans la CI. Prévoir des runs à répétition.

**5. `@prisma/adapter-neon` ne concerne pas ce point.** L'application se
connecte en WebSocket via le driver serverless, mais la **CLI** Prisma ouvre
une connexion PostgreSQL classique. Un conteneur `postgres:` standard lui
convient parfaitement.

### Critère d'acceptation

Ne pas se contenter d'un job vert — un test qui ne peut pas échouer ne vaut
rien. Les deux conditions doivent être vraies :

1. Une branche ajoutant une migration **inédite** obtient une CI verte **sans
   que personne n'ait touché à la base Neon partagée**.
2. Une migration **délibérément cassée** (par exemple un `ALTER TABLE` sur une
   colonne inexistante), poussée sur une branche de test, **fait échouer le
   job**. Vérifier ce second point explicitement, puis retirer la migration
   fautive.

### Et le palliatif, on le garde ?

À trancher au moment de faire le travail. Deux options défendables : conserver
le `migrate status` contre Neon sur les seules branches d'intégration — il
répond alors à la question n°2, qui est légitime *là*, avant un déploiement —
ou le retirer entièrement une fois la base éphémère en place. La première est
plus prudente.
