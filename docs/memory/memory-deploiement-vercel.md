# Mémoire — Déployer le site sur Vercel

> **Rédigé le** : 1er septembre 2026
> **Réécrit le** : 15 octobre 2026, à l'étape 8 du plan
> [backend-local](../features/backend-local.md). Koyeb et le backend hébergé
> ont disparu. Variables, intégration Neon, build vérifié, offre Hobby,
> Upstash, ordre des opérations et vérifications ont été revus.
> **Statut** : aucun déploiement. Le projet Vercel de l'application n'existe
> pas encore (relevé par le MCP Vercel le 15 octobre 2026).
> **Qui fait quoi** : la création du projet, les variables, la connexion de la
> base et le déploiement reviennent au propriétaire (règle 3 de
> [`CLAUDE.md`](../../CLAUDE.md)). L'agent prépare, guide pas à pas sans
> jamais demander de secret dans le chat, puis vérifie en lecture par le MCP
> Vercel.
>
> Le détail technique vit dans [`architecture.md`](../architecture/architecture.md)
> (§2.1 à §2.3 pour l'hébergement, §10.3 pour la limitation de débit, §10 bis
> pour le build).
>
> **Mise à jour du 16 octobre 2026** (plan
> [`gestion-contenu.md`](../features/gestion-contenu.md)). La branche de travail
> est désormais `gestion` : lire `gestion` partout où ce mémo dit
> `localpython`. **Décision 8.1 tranchée, option A** : `main` reste la
> production, rattrapée sur `gestion` à chaque version validée (décision G3).
> **La mise en ligne attend la connexion obligatoire** (étape 3 du plan, après
> les étapes 1 et 2), sinon les données des écoles restent publiques dans
> l'intervalle. L'usage devient un outil d'équipe : le point « usage non
> commercial » du §6 est à revoir par le propriétaire (plan, D7). Le §8.2
> (préversions) reste à trancher. Le reste du mémo est valable ; l'étape 3 du
> plan le révisera.
>
> **Ce que l'étape 1 du plan a rendu faux ici** (16 octobre 2026), à réviser à
> l'étape 3 : `/contribute` et `/api/contribute` n'existent plus (D2), donc
> les vérifications qui les citent (§10, lignes 3, 10 et 12) tombent, et
> `CONTRIBUTION_ALLOWED_DOMAINS` n'est plus lue (§1 et §9) ; le site entier exige
> une session (sans session : renvoi vers `/admin/login`, 401 sur les API) ;
> les gardes sont `guardSignedIn`, `guardManager`, `guardAdmin` (plus de
> `guardAuth`) ; la migration `20261016120000_three_roles` (rôles `USER`,
> `GESTIONNAIRE`, `ADMIN`) doit passer sur `main` avant la fusion, et le
> compte `MODERATOR` de la production deviendra `GESTIONNAIRE`.

---

## 0. Ce qui va où

**Seul Next.js va sur Vercel, en offre Hobby.** Le backend FastAPI n'est
hébergé nulle part : l'admin le lance sur son poste avec `npm run local`
quand il veut lancer des recherches ou traiter les contributions (décision du
14 octobre 2026). Koyeb est abandonné : son offre gratuite est fermée aux
nouveaux comptes depuis le 26 février 2026.

```
 EN LIGNE — Vercel Hobby                     POSTE DE L'ADMIN — lancé à la main
┌───────────────────────────────────┐       ┌───────────────────────────────────┐
│ Next.js 16                        │       │ npm run local                     │
│ • site public, /contribute,       │       │ • FastAPI sur 127.0.0.1:8000      │
│   API v1                          │       │   (pipeline, contributions)       │
│ • back-office                     │       │ • Next.js dev sur localhost:3000  │
│ • FASTAPI_URL absente             │       │   (back-office qui pilote)        │
└─────────────────┬─────────────────┘       └─────────────────┬─────────────────┘
                  │ WebSocket 443                             │ WebSocket 443
                  ▼                                           ▼ (DB_DRIVER=neon-ws)
                  ┌───────────────────────────────────────────┐
                  │ Neon PostgreSQL, projet vc-bdd : branches │
                  │ main (production) et dev (essais du poste)│
                  └───────────────────────────────────────────┘
```

Le site en ligne et le backend ne se parlent pas : ils partagent la base. Ce
que cela donne en ligne :

- **`/admin/cron`** affiche tout de suite « Pilotage depuis le poste local »,
  avec l'historique des jobs lu en base. Aucun lancement n'est possible.
- **Les routes de relais** (`pipeline-status`, `trigger-research`,
  `run-due-passes`) répondent 503 `BACKEND_LOCAL_ONLY` sans appel réseau.
  C'est voulu (étape 5 du plan).
- **Une contribution publique** est enregistrée en `Pending_AI`. Elle attend
  que l'admin lance le backend, et le bandeau de l'inbox les compte. Lancer le
  backend coûte de l'argent : le traitement appelle Tavily et Gemma dès le
  démarrage.
- **Deux branches Neon** depuis le 15 octobre 2026 (étape 9 du plan,
  décision D7) : `main` (`br-bitter-cloud-ab3c0wop`), que lira le site en
  ligne, et `dev` (`br-rapid-bird-abck4fdr`), copie de `main` faite ce
  jour-là, pour les essais du poste. Décision du propriétaire : **`dev` pour
  les essais et les vérifications, `main` pour le travail réel**. Une
  contribution publique arrive dans `main` : seul un backend local pointé sur
  `main` la traite, et une validation faite sur `main` se voit en ligne tout
  de suite. Une passe faite sur `dev` ne produit rien que les visiteurs
  voient. Bascule du poste :
  [`manual_testing_cron.md`](../testing/manual_testing_cron.md) §1.3.

---

## 1. Variables d'environnement

Inventaire du 15 octobre 2026 : tous les `process.env` de `app/`, `lib/`,
`proxy.ts`, `next.config.ts` et `prisma.config.ts`, plus les variables que
`next-auth` 4.24.15 lit sans que le code les nomme. **Aucune variable lue par
le code n'échappe aux quatre listes ci-dessous.**

### 1.1. Obligatoires sur Vercel

| Variable | Qui la lit | Valeur | Piège |
|---|---|---|---|
| `DATABASE_URL` | `lib/prisma.ts` à l'exécution (une erreur au chargement si elle manque) ; `prisma.config.ts` au build (`prisma generate` exige la variable, sans se connecter) | URL **poolée** (hôte en `-pooler`) | **Injectée par l'intégration Neon (§2) : ne pas la saisir à la main.** |
| `NEXTAUTH_SECRET` | `app/api/auth/[...nextauth]/route.ts` et `proxy.ts` (`withAuth`) | valeur **neuve** : `openssl rand -base64 32` | Le nom compte : la route passe `NEXTAUTH_SECRET` explicitement (le repli `AUTH_SECRET` de next-auth ne vaut que pour le proxy). Absente, next-auth refuse de fonctionner (`NO_SECRET`) et plus personne ne se connecte. La changer déconnecte toutes les sessions. |
| `NEXTAUTH_URL` | next-auth, implicitement (absente du code) | `https://<projet>.vercel.app`, ou le domaine définitif, sans barre finale | **Environnement Production seulement.** Sur Vercel, next-auth sait s'en passer : la plateforme pose `VERCEL`, et l'origine se déduit alors de l'hôte de la requête. Posée, elle fixe l'adresse des redirections de connexion. En Preview, la laisser absente : une valeur de production y renverrait la connexion vers la production. |

### 1.2. Fortement recommandées

| Variable | Qui la lit | Pourquoi |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` | `lib/rate-limit.ts` | **Le point le plus important de cette page** (§5). Ce sont exactement ces noms. |
| `CONTRIBUTION_ALLOWED_DOMAINS` | `app/api/contribute/route.ts` | Sans elle, une contribution ne peut citer que le site de l'école, et les catégories `Ranking` et `Accreditation` restent presque vides. Exemple : `ft.com,letudiant.fr,lefigaro.fr,cti-commission.fr,cge.asso.fr` |

### 1.3. Jamais sur Vercel

| Variable | Pourquoi |
|---|---|
| `FASTAPI_URL` | Sans elle, le site répond `BACKEND_LOCAL_ONLY`, et c'est voulu. Posée, elle obligerait à exposer un backend sur Internet, protégé par le seul jeton. |
| `INTERNAL_API_TOKEN` (anciens noms : `FASTAPI_INTERNAL_TOKEN`, `INTERNAL_TOKEN`) | Secret du poste. Sans `FASTAPI_URL`, il ne sert à rien, et il ne doit pas quitter le poste. |
| `DB_DRIVER`, `NEON_WS_BRIDGE_PORT` | Réglages du réseau de l'établissement. Next.js ne les lit pas ; seuls les scripts de migration et le backend les lisent. **`DB_DRIVER` ne se pose jamais sur Vercel.** |
| `GEMINI_API_KEY`, `TAVILY_API_KEY*` | Backend seulement : aucune route Next ne les lit. |
| `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_USERNAME` | Le seed ne se joue pas sur la base partagée (§3.3). |
| `DIRECT_URL`, `SHADOW_DATABASE_URL` | Elles ne servent qu'aux migrations, qui partent du poste (§3). Le build ne se connecte pas (vérifié, §4), et `prisma.config.ts` se replie sur `DATABASE_URL`. **Changement** : la version du 1er septembre exigeait `DIRECT_URL` sur Vercel « pour le build » ; c'était faux. |
| `CRON_*`, `PIPELINE_JOB_ROTATION_RETENTION_DAYS`, `CROWDSOURCING_*`, `PHASE2_MAX_PROGRAMS` | `backend/.env` seulement. |

### 1.4. Posées par Vercel, rien à faire

`NODE_ENV` (`production`), `VERCEL` et `VERCEL_URL` : next-auth les lit pour
déduire l'origine.

> **Environnements Vercel.** On remplit l'environnement *Production*. Pour
> *Preview*, voir la décision du §8.2. L'environnement *Development* ne sert
> pas : le poste lit ses propres fichiers `.env*`. Marquer les secrets
> (`NEXTAUTH_SECRET`, jeton Upstash) comme *Sensitive*.

---

## 2. La base : intégration Neon ↔ Vercel

- **Le projet Neon `vc-bdd`** (`lucky-cell-29057691`, région `aws-eu-west-2`)
  vit dans l'organisation « Vercel: anton1p's projects »
  (`org-lively-cell-45152555`), gérée par Vercel : c'est l'intégration Neon du
  Marketplace, en compte géré par Vercel. Côté Vercel, la base apparaît dans
  **Storage**. Sa seule branche, `main`, y est marquée branche de production.
- **Pour la relier au projet** (documentation Neon, *Vercel-Managed
  Integration*, relue le 15 octobre 2026) : Storage → la base → **Connect
  Project** → choisir le projet → cocher les environnements → **Connect**.
- **Variables injectées** : `DATABASE_URL` (**poolée**, PgBouncer),
  `DATABASE_URL_UNPOOLED` (directe), `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`,
  `PGDATABASE`, `PGPASSWORD`, et des `POSTGRES_*` hérités de Vercel Postgres.
  Le code ne lit que `DATABASE_URL`, qui a le bon nom et pointe vers le pooler.
  Les autres variables restent sans effet.
- **Pas de doublon** : ne pas saisir `DATABASE_URL` à la main en plus de
  l'intégration.
- **Pas de préfixe** à la connexion : avec `PRIMARY_`, la variable deviendrait
  `PRIMARY_DATABASE_URL`, que le code ne lit pas.
- **Option *Preview Branching*** (Advanced Options → Deployments Configuration
  → Preview) : chaque déploiement de préversion reçoit une branche Neon
  `preview/<branche git>`, copie de la production. Voir la décision du §8.2.
- Cette intégration ne se combine pas avec l'intégration « gérée par Neon »
  dans un même projet Vercel.
- **Après la connexion**, l'agent vérifie par le MCP Vercel les **noms**
  (`filter_project_envs`, jamais `decrypt`) : `DATABASE_URL` présente en
  Production, sans doublon saisi à la main.

---

## 3. Migrations et comptes

### 3.1. Les migrations partent du poste

Elles partent du poste avec `npm run db:migrate` (en WebSocket, avec
`DB_DRIVER=neon-ws`), **avant** le déploiement qui en dépend. Jamais dans le
build Vercel : le build tourne à chaque préversion et à chaque retour arrière,
et une migration s'y jouerait à des moments imprévisibles. La documentation
Neon propose `npx prisma migrate deploy && npm run build` comme commande de
build : **ne pas le faire.**

**État au 15 octobre 2026** : `npm run db:status` annonce 10 migrations
appliquées et aucune en attente. Le premier déploiement n'a donc aucune
migration à appliquer.

### 3.2. Une version qui apporte une migration

1. `npm run db:status` : lecture seule, permis à l'agent ;
2. `npm run db:migrate:dry` : applique tout, puis `ROLLBACK` ;
3. `npm run db:migrate`, **avec l'accord du propriétaire** : la base est aussi
   la production ;
4. ensuite seulement, la fusion ou le push qui déclenche le déploiement.

Entre 3 et 4, l'ancien code tourne encore sur le nouveau schéma : une migration
doit rester compatible avec lui (ajouter d'abord, retirer dans une version
suivante). Jamais `prisma db push`, `migrate dev` ni `migrate reset`, et jamais
de modification d'un `migration.sql` déjà appliqué (son empreinte change).

### 3.3. Les comptes : pas de seed

La base partagée a déjà ses comptes : 1 ADMIN et 1 MODERATOR (relevé par le
MCP Neon le 15 octobre 2026, `SELECT` seulement). **Les comptes du site en
ligne sont ceux du développement.** Ne jamais lancer `prisma db seed` contre
cette base (règle 8). Si ces mots de passe ont servi pendant le développement,
les changer dès la mise en ligne : `/admin/users`, « Changer mon mot de
passe » ou « Réinitialiser ».

---

## 4. Build

- `npm run build` vaut `prisma generate && next build`. Prisma 7 n'a plus de
  `postinstall` qui génère le client : sans cet appel explicite, le build
  partirait sans client Prisma.
- **Vérifié le 15 octobre 2026**, sans lire un seul `.env*` et sans toucher la
  base. Dans un `git worktree` jetable de `6315a95` (aucun `.env*` suivi par
  git), `npm ci`, puis `npm run build` avec pour **seule** variable une
  `DATABASE_URL` morte (`postgresql://build:build@127.0.0.1:9/build`) :
  **build vert**. Aucune page ne lit la base au build. `/`, `/contribute`,
  `/api-docs` et `/admin/login` sont statiques ; tout le reste est dynamique,
  et le proxy est compilé. Le message « Dynamic server usage » sur
  `/api/schools` est connu et sans effet : la route reste dynamique.
- **npm 11 n'exécute pas les scripts d'installation non approuvés**
  (`@prisma/engines`, `esbuild`, `prisma`, `unrs-resolver`). Le build passe
  sans eux (vérifié dans le même worktree).
- **Réglages du projet** : préréglage Next.js, répertoire racine du dépôt,
  commandes par défaut. Le dossier `backend/` (Python) n'est pas déployé : il
  n'y a pas de dossier `api/` à la racine, et le préréglage est Next.js.
- **Node** : régler **24.x** (Settings → Build and Deployment → Node.js
  Version), comme la CI et le poste. `package.json` ne déclare pas d'`engines`.
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
| 5 tentatives de connexion / 15 min | contournable en provoquant des démarrages à froid |
| 5 contributions / 20 s | idem. Chaque ticket coûtera des crédits Tavily au prochain lancement du backend |
| 60 appels `/api/v1` / min | idem, et la base peut être aspirée |

**Création, côté propriétaire (offre gratuite)** :

1. sur [console.upstash.com](https://console.upstash.com), créer une base
   **Redis**, dans une région européenne proche de Londres (Neon est en
   `eu-west-2`). L'offre gratuite suffit largement ;
2. dans l'onglet **REST API** de la base, relever `UPSTASH_REDIS_REST_URL` et
   `UPSTASH_REDIS_REST_TOKEN` ;
3. dans Vercel (Settings → Environment Variables), créer ces deux variables
   **sous ces noms exacts**, en Production. Le jeton est à marquer
   *Sensitive* ;
4. redéployer.

> **Piège : l'intégration « Upstash for Redis » du Marketplace Vercel.** Sa
> documentation ne dit pas quels noms elle injecte. L'ancien Vercel KV, migré
> chez Upstash en décembre 2024, posait `KV_REST_API_URL` et
> `KV_REST_API_TOKEN`, que `lib/rate-limit.ts` **ne lit pas** : le site
> retomberait en mémoire sans autre signe que l'avertissement du journal.
> D'où la création directe ci-dessus. Si le propriétaire préfère
> l'intégration, l'agent vérifie ensuite les noms par le MCP. S'ils diffèrent,
> il faut choisir entre recopier les valeurs sous les bons noms et modifier le
> code, et ce choix revient au propriétaire.

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

- **Durée d'une fonction.** Avec Fluid compute, actif par défaut sur un
  nouveau projet, la durée est de **300 s par défaut et au maximum** en Hobby
  (documentation Vercel, *Configuring Maximum Duration*, relue le 15 octobre
  2026). La transaction de `validate`
  (`app/api/admin/inbox/[id]/validate/route.ts`, `timeout: 60000`) tient
  largement. Aucune route ne déclare `maxDuration`, et aucune n'en a besoin.
  Ne pas désactiver Fluid compute (Settings → Functions) : sans lui, la durée
  d'une fonction Hobby est bien plus courte.
- **Région des fonctions.** Par défaut, un nouveau projet exécute ses
  fonctions à Washington (`iad1`), alors que Neon est à Londres. **Recommandé :
  Settings → Functions → Function Regions → London (`lhr1`).** Hobby autorise
  une seule région. Sans ce réglage, chaque requête Prisma traverse
  l'Atlantique. C'est un réglage du projet, sans `vercel.json`.
- **Aucune tâche planifiée Vercel n'est nécessaire.** Le dépôt n'a ni
  `vercel.json` ni `vercel.ts`. Plus rien ne tourne sur un calendrier : les
  passes dues partent sur demande depuis le poste, et les contributions sont
  traitées par le backend local.
- **Usage non commercial**, accepté par le propriétaire.

---

## 7. En-têtes de sécurité

Ils sont posés par `next.config.ts` sur `/:path*`. Le mécanisme `headers()` de
Next fonctionne nativement sur Vercel, sans réglage. `'unsafe-eval'` est
absent de la CSP en production (vérifié sur un build de production).

Deux points à surveiller après le premier déploiement :

1. **`Strict-Transport-Security` contient `preload`.** Cette directive engage
   le domaine vers la liste de préchargement HSTS des navigateurs, et en
   sortir prend des mois. À garder seulement si le domaine et **tous ses
   sous-domaines** resteront en HTTPS. Dans le doute, retirer `preload` de
   `next.config.ts` avant le premier déploiement public : ce serait une
   modification de code, à décider par le propriétaire.
2. **La console du navigateur** sur `/admin` et `/contribute` ne doit montrer
   aucune violation `Content-Security-Policy`. `'unsafe-inline'` reste sur
   `script-src` : la CSP à nonce est un chantier ouvert.

---

## 8. Décisions à prendre avant le premier déploiement

### 8.1. La branche de production

Vercel déploie en production la branche par défaut du dépôt, `main`. Or
`origin/main` est resté à `e4c09cf` (2 septembre 2026), **46 commits derrière
`localpython`** (relevé du 15 octobre 2026). Il ne contient ni le plan
backend-local ni les corrections de l'étape 7.

- **(A, recommandée)** fusionner `localpython` dans `main` par une pull
  request, CI verte, avant de créer le projet. `main` reste la branche de
  production, comme Vercel l'attend.
- (B) garder `main` en l'état et régler la production sur `localpython`
  (Settings → Environments → Production → Branch Tracking).

### 8.2. Les préversions

Chaque push sur une autre branche que la production crée un déploiement de
préversion. Son build exige `DATABASE_URL` (`prisma.config.ts` lève sans elle)
et, une fois la base connectée, la préversion lit et écrit la base de
production.

- **(A, recommandée)** connecter la base Neon à l'environnement
  **Production seulement**, et régler Settings → Build and Deployment →
  Ignored Build Step sur **« Only build production »**. Un build ainsi annulé
  compte quand même dans le quota de déploiements. La branche Neon `dev`
  existe depuis le 15 octobre 2026, mais elle sert aux essais du poste : la
  relier aux préversions serait une décision à part.
- (B) connecter aussi Preview, avec *Preview Branching* : chaque préversion a
  sa branche Neon, copie isolée de la production. Il faut alors surveiller le
  nombre de branches permis par l'offre gratuite de Neon et leur nettoyage.

---

## 9. Ordre des opérations

1. **Décisions du §8**, tranchées par le propriétaire.
2. **Contrôles locaux.** CI verte sur le commit à déployer ;
   `npm run db:status` → aucune migration en attente (§3) ; smoke local vert
   (joué le 15 octobre 2026 contre `npm run dev`).
3. **Upstash** : créer la base, garder les deux valeurs (§5).
4. **Git** : fusionner `localpython` dans `main` (si 8.1 A).
5. **Créer le projet Vercel** : Add New → Project → importer
   `Anton1P/veille-concurenciel`, préréglage Next.js, racine du dépôt. Le
   premier déploiement, lancé à l'import, **échouera faute de `DATABASE_URL`**
   (`prisma.config.ts`). C'est attendu : ne rien saisir à la main pour le
   contourner.
6. **Relier la base** : Storage → `vc-bdd` → Connect Project, environnements
   selon le §8.2, sans préfixe (§2).
7. **Variables** (§1) : `NEXTAUTH_SECRET` (neuve, *Sensitive*),
   `NEXTAUTH_URL` (Production), `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN` (*Sensitive*), `CONTRIBUTION_ALLOWED_DOMAINS`.
   **Aucune variable du §1.3.**
8. **Réglages** : région `lhr1`, Fluid compute actif, Node 24.x, Ignored Build
   Step selon le §8.2.
9. **Redéployer** la production (Deployments → … → Redeploy) : le build doit
   passer.
10. **Donner à l'agent le nom du projet** : il note le nom et l'id `prj_…`
    dans `CLAUDE.md`, puis vérifie par le MCP Vercel (projet, déploiement,
    noms des variables). Pour les journaux d'exécution (`get_runtime_logs`),
    le propriétaire doit d'abord se reconnecter par `/mcp` en accordant la
    portée `anton1ps-projects` : sans elle, tout appel avec `teamId` rend 403.
11. **Vérifications du §10.**
12. **Mots de passe** des deux comptes, s'ils ont servi en développement
    (§3.3).

---

## 10. Vérifications après le premier déploiement

| # | Contrôle | Attendu |
|---|---|---|
| 1 | Journaux d'exécution Vercel | **aucune** ligne `[rate-limit] Aucun magasin partagé configuré`, aucune `[next-auth][error][NO_SECRET]` |
| 2 | Variables, par le MCP (noms seulement) | `DATABASE_URL` (intégration), `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` ; aucune du §1.3 |
| 3 | `/`, `/contribute`, `/api-docs`, une fiche école et un programme | 200, pages rendues (le smoke local refuse les adresses distantes : contrôle à la main) |
| 4 | `/admin` sans session | redirection vers `/admin/login` |
| 5 | 6 tentatives de connexion erronées d'affilée | la 6ᵉ renvoie **429** |
| 6 | `curl -I https://<domaine>/admin/login` | les 6 en-têtes de sécurité (§7) |
| 7 | Connexion ADMIN, puis `/admin/cron` | « **Pilotage depuis le poste local** » **immédiatement**, sans nouvel essai ; historique des jobs lu en base ; ni « Simuler », ni « Lancer », ni recherche ciblée |
| 8 | `GET /api/admin/pipeline-status` en session | **503**, `code: "BACKEND_LOCAL_ONLY"`, sans attente |
| 9 | `/admin/inbox` | la liste ; le bandeau des contributions `Pending_AI` s'il y en a |
| 10 | Contribution avec une URL hors du domaine de l'école (et hors `CONTRIBUTION_ALLOWED_DOMAINS`) | **400**, message explicite |
| 11 | ~65 appels rapides sur `/api/v1/schools` | **429** au-delà de 60 par minute |
| 12 | Console du navigateur sur `/admin` et `/contribute` | aucune violation CSP |
| 13 | Résumé du déploiement | fonctions en `lhr1` |

---

## 11. Ce qui est déjà prêt — à ne pas refaire

- ✅ `dotenv` est une dépendance de production : `npm ci --omit=dev` ne casse
  pas le démarrage.
- ✅ Il n'y a aucun mot de passe par défaut, et le seed exige
  `SEED_ADMIN_PASSWORD`.
- ✅ La limitation de débit couvre `/api/auth/callback/credentials`,
  `/api/contribute` et `/api/v1`, et s'appuie sur l'IP de plateforme.
- ✅ Les en-têtes de sécurité sont posés et vérifiés sur un build de
  production.
- ✅ Chaque route admin choisit explicitement `guardAuth` ou `guardAdmin`.
- ✅ Les migrations reconstruisent une base vierge à l'identique du schéma, et
  `npm run db:migrate` les applique en 443 depuis le poste.
- ✅ Le site en ligne n'attend aucun backend : sans `FASTAPI_URL`, réponse
  immédiate `BACKEND_LOCAL_ONLY` (étape 5).
- ✅ Aucun cron ne paie Research : les passes dues partent sur demande, depuis
  le poste (étape 3).
- ✅ Le build passe sans base et sans autre variable que `DATABASE_URL`
  (15 octobre 2026).
- ✅ Le smoke local est vert contre `npm run dev` (15 octobre 2026) : 5 pages
  et 15 routes de l'API v1.
- ✅ La page publique `/api-docs` décrit l'API réelle, et son URL d'exemple
  vise l'adresse du site (15 octobre 2026).

---

## 12. Chantiers ouverts

1. ~~Les exemples de `/api-docs` sont fictifs~~ : **réalignés le 15 octobre
   2026**, sur décision du propriétaire, et tenus par `test/api-docs.test.ts`
   (`architecture.md` §7.3). Le titre des fiches ne porte plus deux fois
   « — EduData France ».
2. **Décision 10 de l'étape 7** : un JSON mal formé donne 500 au lieu de 400
   sur le CRUD admin et `create-programs`. Rien n'est écrit dans ce cas.
   Consigné et accepté.
3. **CSP à nonce**, pour retirer `'unsafe-inline'` de `script-src`.
4. **Avertissements ESLint** : 112 au 15 octobre 2026.
5. **Vulnérabilités npm hautes** tirées par la CLI Prisma : risque accepté,
   suivi dans [`architecture.md`](../architecture/architecture.md),
   *Sécurité des dépendances*.
6. **`preload` de HSTS** : à confirmer avant le premier déploiement public
   (§7).

---

## 13. Base de CI éphémère — à faire juste avant le déploiement

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
