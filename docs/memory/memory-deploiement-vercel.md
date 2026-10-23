# Mémoire — La production sur Vercel

> **En ligne depuis le 19 octobre 2026** : <https://app-vc-emn.vercel.app>,
> sur les comptes de l'école. Ce mémo dit ce qui est en ligne, comment c'est
> réglé, et comment livrer une version. Les décisions citées (G3, D7, D22…)
> sont celles du plan [`features/gestion-contenu.md`](../features/gestion-contenu.md).
>
> **Qui fait quoi** : le projet, les variables, la base et le déploiement
> reviennent au propriétaire (règle 3 de [`CLAUDE.md`](../../CLAUDE.md)).
> L'agent prépare, guide pas à pas sans jamais demander de secret dans le
> chat, puis vérifie en lecture par les MCP Vercel, Neon et GitHub.

---

## 0. Ce qui est en ligne

**Seul Next.js va sur Vercel, en offre Hobby.** La partie IA (le backend
FastAPI, sa console `/admin/cron`) vit sur la branche `local` et ne se lance
que sur le poste de l'admin (D100, D101) ; Vercel ne la construit pas.

```
 EN LIGNE — Vercel Hobby (main)              POSTE DE L'ADMIN — branche local
┌───────────────────────────────────┐       ┌───────────────────────────────────┐
│ Next.js 16                        │       │ npm run local                     │
│ • site et API v1, derrière la     │       │ • FastAPI sur 127.0.0.1:8000      │
│   connexion                       │       │   (pipeline, contributions)       │
│ • back-office, inbox comprise     │       │ • Next.js dev sur localhost:3000  │
│ • ni console IA ni backend        │       │   (la console qui pilote)         │
└─────────────────┬─────────────────┘       └─────────────────┬─────────────────┘
                  │ WebSocket 443                             │ WebSocket 443
                  ▼                                           ▼ (DB_DRIVER=neon-ws)
                  ┌───────────────────────────────────────────┐
                  │ Neon PostgreSQL, projet vc-bdd : branches │
                  │ main (production) et dev (essais du poste)│
                  └───────────────────────────────────────────┘
```

Le site en ligne et le backend ne se parlent pas : ils partagent la base.
`/admin/cron` répond 404 en ligne ; l'inbox y reste, pour que l'admin valide
les tickets que le backend du poste a écrits.

| | |
|---|---|
| **Dépôt** | `emnormandie76/veille-concurenciel` (compte GitHub de l'école, `Anton1P` collaborateur) ; production = `main`, avancée sur `gestion` par avance rapide à chaque version validée (G3) |
| **Projet Vercel** | `app-vc` (`prj_x0D6x90ihnJnc86piYtt9fJXfNLM`), équipe `em-normandie1`, Hobby (D7) ; importé comme **projet Next.js seul** (Vercel proposait un projet « Services » FastAPI + Next.js, refusé) |
| **Adresses** | principale `https://app-vc-emn.vercel.app` (= `NEXTAUTH_URL`) ; `app-vc-taupe.vercel.app`, attribuée à la création, y renvoie en 307 |
| **Base** | projet Neon `vc-bdd` (`noisy-credit-34683167`), Londres (`aws-eu-west-2`) : `main` (`ep-super-rain-zas6jyy2`) = production, `dev` (`ep-proud-lab-za705j3u`) = essais du poste |
| **Variables de Production** | `DATABASE_URL` et ses cousines (intégration Neon, Production seule, D22), `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` ; plus les `KV_*` et `REDIS_URL` de l'intégration Upstash, sans effet. Aucune du §1.3 |
| **Réglages** | région des fonctions `lhr1`, Fluid compute, Node 24.x, « Only build production » |
| **Secrets Actions** | `DATABASE_URL`, `DIRECT_URL` (sans guillemets), `NEXTAUTH_SECRET` distinct de celui de Vercel |

L'ancienne base (`lucky-cell-29057691`, Vercel personnel d'`Anton1P`) et
l'ancien dépôt (`Anton1P/veille-concurenciel`) restent en sauvegarde figée :
plus rien n'y écrit.

---

## 1. Variables d'environnement

Inventaire de tous les `process.env` de `app/`, `lib/`, `proxy.ts`,
`next.config.ts` et `prisma.config.ts`, plus les variables que `next-auth`
lit sans que le code les nomme. **Aucune variable lue par le code n'échappe
aux quatre listes ci-dessous.**

### 1.1. Obligatoires sur Vercel

| Variable | Qui la lit | Valeur | Piège |
|---|---|---|---|
| `DATABASE_URL` | `lib/prisma.ts` à l'exécution (une erreur au chargement si elle manque) ; `prisma.config.ts` au build (`prisma generate` exige la variable, sans se connecter) | URL **poolée** (hôte en `-pooler`) | **Injectée par l'intégration Neon (§2) : ne pas la saisir à la main.** |
| `NEXTAUTH_SECRET` | `app/api/auth/[...nextauth]/route.ts` et `proxy.ts` (`withAuth`) | une valeur à soi : `openssl rand -base64 32` | Le nom compte : la route passe `NEXTAUTH_SECRET` explicitement (le repli `AUTH_SECRET` de next-auth ne vaut que pour le proxy). Absente, next-auth refuse de fonctionner (`NO_SECRET`) et plus personne ne se connecte. La changer déconnecte toutes les sessions. |
| `NEXTAUTH_URL` | next-auth, implicitement (absente du code) | l'adresse principale, sans barre finale | **Environnement Production seulement.** Posée, elle fixe l'adresse des redirections de connexion. En Preview, la laisser absente : next-auth déduit l'origine de la requête (la plateforme pose `VERCEL`), alors qu'une valeur de production y renverrait la connexion vers la production. |

### 1.2. Fortement recommandées

| Variable | Qui la lit | Pourquoi |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` | `lib/rate-limit.ts` | **Le point le plus important de cette page** (§5). Ce sont exactement ces noms. |

### 1.3. Jamais sur Vercel

| Variable | Pourquoi |
|---|---|
| `FASTAPI_URL`, `INTERNAL_API_TOKEN` (anciens noms : `FASTAPI_INTERNAL_TOKEN`, `INTERNAL_TOKEN`) | Lues par la seule branche `local`, sur le poste ; aucun code de `gestion` ni de `main` ne les lit. Posées en ligne, elles ne serviraient qu'à exposer un backend ou son jeton. |
| `DB_DRIVER`, `NEON_WS_BRIDGE_PORT` | Réglages du réseau de l'établissement. Next.js ne les lit pas ; seuls les scripts de migration (`DB_DRIVER`) et le backend de `local` les lisent. **`DB_DRIVER` ne se pose jamais sur Vercel.** |
| `GEMINI_API_KEY`, `TAVILY_API_KEY*`, `CRON_*`, `CROWDSOURCING_*`, `PIPELINE_JOB_ROTATION_RETENTION_DAYS`, `PHASE2_MAX_PROGRAMS` | Backend seulement (`backend/.env`, branche `local`). |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Le seed ne se joue pas sur la base partagée (§3.3). |
| `DIRECT_URL`, `SHADOW_DATABASE_URL` | Elles ne servent qu'aux migrations, qui partent du poste (§3). Le build ne se connecte pas (§4), et `prisma.config.ts` se replie sur `DATABASE_URL`. |

### 1.4. Posées par Vercel, rien à faire

`NODE_ENV` (`production`), `VERCEL` et `VERCEL_URL` : next-auth les lit pour
déduire l'origine.

> **Environnements Vercel.** Seul l'environnement *Production* est rempli
> (§8). *Development* ne sert pas : le poste lit ses propres fichiers `.env*`.
> Les secrets (`NEXTAUTH_SECRET`, jeton Upstash) sont marqués *Sensitive*.

---

## 2. La base : intégration Neon ↔ Vercel

- **Le projet Neon `vc-bdd`** vit dans l'organisation « Vercel: EM-Normandie »
  (`org-long-unit-38729916`), gérée par le Vercel de l'école : c'est
  l'intégration Neon du Marketplace, en compte géré par Vercel. Côté Vercel, la
  base apparaît dans **Storage**, et sa branche `main` y est la branche de
  production. **Une base ainsi gérée ne se transfère pas** d'un compte à
  l'autre (ni Neon ni Vercel Hobby ne le permettent) : un changement de compte
  impose une nouvelle base et la copie des données.
- **La relier à un projet** : Storage → la base → **Connect Project** →
  choisir le projet → cocher les environnements (Production seulement, D22) →
  **Connect**, sans préfixe (avec `PRIMARY_`, la variable deviendrait
  `PRIMARY_DATABASE_URL`, que le code ne lit pas).
- **Variables injectées** : `DATABASE_URL` (**poolée**, PgBouncer),
  `DATABASE_URL_UNPOOLED` (directe), `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`,
  `PGDATABASE`, `PGPASSWORD`, et des `POSTGRES_*` hérités de Vercel Postgres.
  Le code ne lit que `DATABASE_URL`. Ne pas la saisir à la main en plus.
- **Vérification** : l'agent relit par le MCP Vercel les **noms**
  (`filter_project_envs`, jamais `decrypt`).

### 2.1. Les deux branches Neon et la bascule du poste

Décision du propriétaire : **`dev` pour les essais et les vérifications,
`main` pour le travail réel**. Une modification faite sur `main` se voit en
ligne tout de suite ; une faite sur `dev` ne se voit pas. Le poste vise `dev`
par défaut.

| Branche | Endpoint (dans l'hôte des URL, en `c-2.eu-west-2.aws.neon.tech`) |
|---|---|
| `main` (production Vercel) | `ep-super-rain-zas6jyy2` |
| `dev` | `ep-proud-lab-za705j3u` |

**Les deux branches n'ont pas le même mot de passe** (un rôle Neon est propre à
sa branche) : une bascule change **l'URL entière**. Les URL de chaque branche
se copient dans la console Neon (bouton *Connect*, branche voulue, *Connection
pooling* activé pour `DATABASE_URL`, désactivé pour `DIRECT_URL`). Les
fichiers `.env*` appartiennent au propriétaire : l'agent ne les modifie que sur
son autorisation explicite, par un script qui n'affiche rien. Pour basculer :

1. arrêter Next.js (et le backend, sur `local`) ;
2. remplacer l'URL dans les lignes actives suivantes, en gardant `-pooler` là
   où il figure :
   - `.env.local` : `DATABASE_URL` (poolée) et `DIRECT_URL` (directe) ;
   - `.env` à la racine, s'il porte encore le doublon : les deux mêmes. Sinon
     la CLI Prisma (`prisma.config.ts`), qui lit `.env` en repli, viserait
     encore l'autre branche ;
   - `backend/.env` (branche `local`) : `DATABASE_URL`.

   `.env.development.local` ne porte que `DB_DRIVER=neon-ws` : rien à y
   changer. Ne jamais poser une `DATABASE_URL` dans les variables Windows :
   elle l'emporterait sur tous les fichiers ;
3. vérifier : `npm run db:status` affiche l'hôte visé
   (`Pilote neon-ws : WebSocket (443) vers ep-… (DIRECT_URL)`).

---

## 3. Migrations et comptes

### 3.1. Les migrations partent du poste

Elles partent du poste avec `npm run db:migrate` (en WebSocket, avec
`DB_DRIVER=neon-ws` : [`bdd.md`](../architecture/bdd.md) §4), **avant** le
déploiement qui en dépend. Jamais dans le build Vercel : le build tourne à
chaque préversion et à chaque retour arrière, et une migration s'y jouerait à
des moments imprévisibles. La documentation Neon propose
`npx prisma migrate deploy && npm run build` comme commande de build : **ne
pas le faire.** Les seize migrations sont appliquées sur `main` et sur `dev`.

### 3.2. Livrer une version

1. CI verte sur le commit de `gestion` à livrer (MCP GitHub) ;
2. s'il apporte une migration : `npm run db:status` (lecture seule, permis à
   l'agent), `npm run db:migrate:dry` (applique tout, puis `ROLLBACK`), puis
   `npm run db:migrate` sur `main`, **avec l'accord du propriétaire** (la base
   est la production ; le classifieur refuse souvent cette commande à l'agent :
   le propriétaire la lance, l'agent vérifie par le MCP Neon) ;
3. ensuite seulement, `git -c credential.username=Anton1P push origin
   gestion:main` (avance rapide, sans fusion), avec un dernier commit signé au
   nom d'`emnormandie76` (§6), sans quoi Vercel le bloque ;
4. vérifier : CI verte sur `main`, déploiement de production `READY` (MCP
   Vercel), puis un coup d'œil en ligne. Si aucun déploiement de production
   n'apparaît après quelques minutes (constaté pour `66896db` à l'étape 13 :
   CI verte, aucun incident chez Vercel, sept minutes d'attente), le créer
   par le MCP Vercel, **avec l'accord du propriétaire** : `create_deployment`
   (`gitSource` github `emnormandie76`/`veille-concurenciel`, `ref` `main`,
   `sha` du commit), puis vérifier qu'il est `READY` et que
   `app-vc-emn.vercel.app` le sert.

Entre 2 et 3, l'ancien code tourne encore sur le nouveau schéma : une
migration doit rester compatible avec lui (ajouter d'abord, retirer dans une
version suivante). Jamais `prisma db push`, `migrate dev` ni `migrate reset`,
et jamais de modification d'un `migration.sql` déjà appliqué (son empreinte
change).

### 3.3. Les comptes : pas de seed, la liste blanche

La base partagée a ses comptes : **ne jamais lancer `prisma db seed`** contre
elle (règle 8), il ne sert qu'à une base vierge. Personne n'entre autrement
que par la liste blanche, et aucun e-mail n'est envoyé : l'admin ajoute
l'adresse `@em-normandie.fr` d'un collègue (« Ajouter une adresse »), le
prévient, et le collègue choisit son mot de passe sur `/admin/first-login`. Un
compte d'avant la liste blanche se connecte par son ancien identifiant tant
que l'admin n'a pas renseigné son adresse (D3).

**Risque accepté (G5)** : tant qu'un invité n'a pas fait sa première
connexion, quelqu'un qui connaît son adresse peut choisir le mot de passe à sa
place. Prévenir les collègues juste après l'ajout réduit la fenêtre.

Comptes en place : l'admin (`aparede@em-normandie.fr`), un compte
gestionnaire **de test**, à l'adresse de test au suffixe tiré au hasard (il
n'est pas remis en première connexion : avec une adresse qui ne correspond à
personne, ce serait offrir un compte gestionnaire à quiconque la devine), et
les collègues ajoutés depuis.

---

## 4. Build

- `npm run build` vaut `prisma generate && next build`. Prisma 7 n'a plus de
  `postinstall` qui génère le client : sans cet appel explicite, le build
  partirait sans client Prisma.
- **Le build ne lit pas la base** : il passe avec pour seule variable une
  `DATABASE_URL` morte (vérifié dans un `git worktree` jetable, sans aucun
  `.env*`). Le message « Dynamic server usage » sur `/api/schools` est connu
  et sans effet : la route reste dynamique.
- **npm 11 n'exécute pas les scripts d'installation non approuvés**
  (`@prisma/engines`, `esbuild`, `prisma`, `unrs-resolver`). Le build passe
  sans eux.
- **Réglages du projet** : préréglage Next.js, répertoire racine du dépôt,
  commandes par défaut, **Node 24.x** (comme la CI et le poste ;
  `package.json` ne déclare pas d'`engines`).
- Dans les journaux Vercel, des lignes `injected env (0) from .env.local`
  apparaissent. Elles sont sans effet : `lib/prisma.ts` et `prisma.config.ts`
  chargent `.env.local`, absent sur Vercel.

---

## 5. Limitation de débit : Upstash

`lib/rate-limit.ts` a deux magasins : Upstash Redis si les deux variables sont
présentes, **repli en mémoire sinon**. Sur Vercel, le repli mémoire ne protège
de rien : chaque instance a son compteur, et chaque démarrage à froid repart de
zéro.

| Plafond | Ce qu'il devient sans Upstash |
|---|---|
| 5 tentatives de connexion ou de première connexion / 15 min / IP | contournable en provoquant des démarrages à froid |
| 60 appels `/api/v1` / min / IP | idem, et la base peut être aspirée |
| 10 signalements / heure / compte | idem |

**Les noms comptent.** L'intégration « Upstash for Redis » du Marketplace
(`appvc-ratelimit`, Production seule) pose `KV_REST_API_URL`,
`KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL` et `REDIS_URL`,
que `lib/rate-limit.ts` **ne lit pas**. Les valeurs ont donc été recopiées à
la main sous `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`, sans
toucher au code. Vérifié en ligne : la 6e tentative de connexion rend 429, et
la clé `rl:login:<ip>:<fenêtre>` apparaît dans le Data Browser d'Upstash.

**Sans les deux variables**, le repli mémoire s'applique et
`[rate-limit] Aucun magasin partagé configuré (UPSTASH_REDIS_REST_URL /
UPSTASH_REDIS_REST_TOKEN)…` est journalisé au premier usage de chaque
instance. **Si Upstash répond mal**, on lit `[rate-limit] Upstash a répondu
<code>` ou `[rate-limit] Upstash injoignable`, puis le repli mémoire prend le
relais pour cette requête.

L'appelant est identifié par `x-vercel-forwarded-for`, un en-tête que Vercel
écrase et qu'un client ne peut pas forger (`clientIp()`).

---

## 6. Offre Hobby

- **Durée d'une fonction.** Avec Fluid compute, actif, la durée est de
  **300 s par défaut et au maximum** en Hobby. La transaction de `validate`
  (`timeout: 60000`) tient largement ; aucune route ne déclare `maxDuration`.
  Ne pas désactiver Fluid compute : sans lui, la durée d'une fonction Hobby est
  bien plus courte.
- **Région des fonctions** : Londres (`lhr1`), près de Neon. Hobby autorise
  une seule région ; sans ce réglage, chaque requête Prisma traverserait
  l'Atlantique (`iad1` par défaut).
- **Aucune tâche planifiée.** Le dépôt n'a ni `vercel.json` ni `vercel.ts`.
- **Usage non commercial** : l'offre Hobby est réservée à un usage personnel.
  L'outil sert une équipe ; le propriétaire garde Hobby en connaissance de
  cause (D7 ; l'agent recommandait Pro).
- **L'auteur des commits** : en Hobby, avec un dépôt **privé**, Vercel ne
  déploie un commit que si son **auteur** est le propriétaire de l'équipe,
  `emnormandie76`. Un commit d'`Anton1P` donne un déploiement `BLOCKED`, même
  lancé à la main. Parade retenue : sur ce dépôt, `git config --local` signe
  les commits au nom d'`emnormandie76`
  (`335444819+emnormandie76@users.noreply.github.com`) ; `Anton1P` pousse
  (`git -c credential.username=Anton1P push`). Écartés : l'offre Pro (D7), un
  dépôt public.

---

## 7. En-têtes de sécurité

Ils sont posés par `next.config.ts` sur `/:path*`, et le mécanisme `headers()`
de Next fonctionne nativement sur Vercel. Détail :
[`gestion-contenu.md`](../architecture/gestion-contenu.md) §8.2.
`'unsafe-eval'` est absent de la CSP en production. **`preload` de HSTS est
gardé** (D23) : il engage le domaine pour des mois, mais une adresse en
`*.vercel.app` n'entre pas dans la liste de préchargement ; la question
reviendra avec un domaine à soi. Aucune violation CSP en console, sur le site
comme sur le back-office.

---

## 8. Les préversions

Chaque push sur une autre branche que `main` créerait un déploiement de
préversion, qui lirait et écrirait la base de production. Réglage retenu
(D22) : la base n'est reliée qu'à l'environnement **Production**, et Settings
→ Build and Deployment → Ignored Build Step est sur **« Only build
production »**. Un push sur `gestion` ou sur `local` donne un déploiement
aussitôt annulé, sans build (il compte quand même dans le quota). Le même
commit poussé ensuite sur `main` n'a pas toujours eu sa production : à
l'étape 12, `0880308` l'a eue dès le push sur `main`, malgré sa préversion
annulée sur `gestion` ; à l'étape 13, `66896db` n'en a eu aucune, et il a
fallu la créer (§3.2, point 4). La cause n'est pas connue.

Écarté : relier aussi Preview avec *Preview Branching* (une branche Neon par
préversion, copie isolée de la production), qui demanderait de surveiller le
nombre de branches de l'offre gratuite de Neon et leur nettoyage.

---

## 9. Vérifier la production

À rejouer après un changement de réglage ou une montée de version qui touche
la connexion, avec l'accord du propriétaire pour ce qui demande une session :

| # | Contrôle | Attendu |
|---|---|---|
| 1 | Journaux d'exécution Vercel | **aucune** ligne `[rate-limit] Aucun magasin partagé configuré`, aucune `[next-auth][error][NO_SECRET]` |
| 2 | Variables, par le MCP (noms seulement) | celles du §0, aucune du §1.3 |
| 3 | Sans session : les pages du site et de `/admin` | redirection vers `/admin/login?callbackUrl=…` ; connexion et première connexion en 200 |
| 4 | Sans session : l'API (v1, `/api/schools`, back-office, comptes) | **401** JSON |
| 5 | 6 tentatives de connexion erronées d'affilée | la 6e renvoie **429** ; clé `rl:login:…` dans Upstash |
| 6 | En-têtes de `/admin/login` | les six en-têtes de sécurité (§7) |
| 7 | Connexion ADMIN | le menu à quatre entrées, `/admin/cron` en 404, l'inbox liste ses tickets |
| 8 | ~65 appels rapides sur `/api/v1/schools`, en session | **429** au-delà de 60 par minute |
| 9 | Console du navigateur | aucune violation CSP |
| 10 | Résumé du déploiement | fonctions en `lhr1` |
| 11 | `NEXTAUTH_URL` = l'adresse principale | `GET /api/auth/providers` rend un `callbackUrl` sur cette adresse |

**Portée du MCP Vercel** : les appels avec `teamId` (dont `get_runtime_logs`)
rendent 403 tant que le propriétaire ne s'est pas reconnecté par `/mcp` en
accordant la portée de l'équipe `em-normandie1` (`CLAUDE.md`, MCP Vercel).

---

## 10. Chantiers ouverts

1. **Base de CI éphémère** (ci-dessous).
2. **CSP à nonce**, pour retirer `'unsafe-inline'` de `script-src`.
3. **Vulnérabilités npm hautes** tirées par la CLI Prisma et l'outillage de
   lint : risque accepté ([`gestion-contenu.md`](../architecture/gestion-contenu.md)
   §8.3).
4. **Un JSON mal formé** rend 500 au lieu de 400 sur le CRUD admin et
   `create-programs` ; rien n'est écrit. Consigné et accepté.
5. **« Dynamic server usage » sur `/api/schools`** au build : bruit connu
   (§4) ; le faire taire est un petit changement de code, à décider.
6. **Avertissements ESLint** : 93 au 22 octobre 2026.

---

## 11. Base de CI éphémère

> **Pour l'agent qui reprendra ce point.** Cette section est autoportante :
> elle suppose que vous ne connaissez ni ce dépôt ni l'historique. Lisez-la
> entièrement avant de toucher au workflow.

### L'état actuel, et pourquoi il est provisoire

`.github/workflows/ci.yml`, étape **« Prisma — statut des migrations »**,
exécute `npx prisma migrate status` **contre la base Neon partagée**, celle
que désignent les secrets `DATABASE_URL` / `DIRECT_URL` du dépôt. Elle ne
fait échouer le job que sur `main` et sur les PR vers `main` :

```yaml
continue-on-error: ${{ !(github.ref == 'refs/heads/main'
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
partagée, l'étape impose la seconde partout : une branche qui ajoute une
migration échouerait tant que cette migration n'est pas appliquée à la base
commune, donc **avant même que le code soit relu**.

### Ce que personne ne vérifie aujourd'hui

Aucun test, nulle part, ne vérifie que **les migrations s'appliquent proprement
sur une base vierge**. `migrate status` compare un journal à une base déjà
migrée ; il ne rejoue jamais l'historique depuis zéro. Une migration cassée
(colonne inexistante, ordre de dépendances faux, `DROP` qui échoue) ne se
découvrirait qu'en production.

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
sur le port 5432 y est fermée. Ce chantier **ne peut pas se tester en local** :
il s'itère dans la CI. Prévoir des runs à répétition.

**5. `@prisma/adapter-neon` ne concerne pas ce point.** L'application se
connecte en WebSocket via le driver serverless, mais la **CLI** Prisma ouvre
une connexion PostgreSQL classique. Un conteneur `postgres:` standard lui
convient parfaitement.

**6. `test/no-ai-backend.test.ts` lit `ci.yml`** : n'y ajouter aucun job
Python, ni les mots qui en trahiraient un, commentaires compris.

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
le `migrate status` contre Neon sur `main` seulement — il répond alors à la
question n°2, qui est légitime *là*, avant un déploiement — ou le retirer
entièrement une fois la base éphémère en place. La première est plus
prudente.
