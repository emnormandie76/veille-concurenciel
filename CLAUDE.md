# Veille Concurrentiel (dépôt appVC)

Plateforme qui collecte, vérifie et publie des données sur les écoles
françaises : campus, programmes, tarifs, classements, capacités d'accueil,
accréditations et statistiques.

Les données arrivent par deux voies :
- **le pipeline IA** : Tavily Research rédige un rapport, puis une cascade
  Gemini le structure ;
- **les contributions du public**, extraites par Gemma.

Tout passe par une zone tampon, l'inbox. **Rien n'entre en production sans
validation humaine.**

- **Cible** : ~30 écoles, ~10 000 crédits Tavily par mois, Phase 1 et Phase 2
  deux fois par an pour chaque école.
- **Next.js 16 sur Vercel**, en offre Hobby gratuite : site public, API v1 et
  back-office. La base Neon est partagée avec le backend.
- **Le backend FastAPI (Python) n'est plus hébergé** : il se lance à la main
  sur le poste de l'admin (décision du 14 octobre 2026).
- Pas encore déployé.

## Documents de référence

| Document | Rôle |
|---|---|
| [README.md](README.md) | démarrage, variables, commandes, points de sécurité |
| [docs/cahier-des-charges-school-pipeline.md](docs/cahier-des-charges-school-pipeline.md) | exigences : le **quoi** |
| [docs/architecture/architecture.md](docs/architecture/architecture.md) | référence technique (v2.1 du 12/10/2026) : le **comment** |
| [docs/architecture/bdd.md](docs/architecture/bdd.md) · [API-rest.md](docs/architecture/API-rest.md) | schéma de la base (10 migrations) · API publique v1 (15 routes) |
| [docs/features/backend-local.md](docs/features/backend-local.md) | **chantier en cours** : backend local, réseau, tests. Son journal (§11) tient l'avancement |
| `docs/features/` (autres fiches) | plans de chantiers terminés, historiques |
| [docs/memory/](docs/memory/) | ce qui n'est pas terminé : déploiement Vercel, rétention des tickets |
| [docs/testing/](docs/testing/) | tests manuels, simulations sans crédit (`pipeline_simulation.md`) |
| [docs/edgecase.md](docs/edgecase.md) | cas limites et leurs parades |

## Phase en cours

Chantier « backend local sur demande »
([docs/features/backend-local.md](docs/features/backend-local.md)) :

- plan rédigé le 14 octobre 2026 ;
- étape 0 terminée le même jour : sonde du pont réussie, relevés de départ faits
  (291 tests Python, 43 tests TypeScript), décisions D1 à D7 retenues telles que
  recommandées ;
- plan validé par le propriétaire ; étape 1 (filet de tests et CI) terminée :
  job `ts-tests` vert en CI (50 tests) ;
- étape 2 (réseau, `DB_DRIVER=neon-ws`) faite le 14 octobre : pont Python,
  `npm run db:status` / `db:migrate`, 319 tests Python et 68 TypeScript ;
  vérifiée sur la base en lecture seule, commit `02da0d7`, CI verte, validée
  par le propriétaire ;
- hors plan, le 14 octobre : `next` et `eslint-config-next` montés en 16.3.8
  pour lever un avis critique qui faisait échouer le job `validate` ; tests,
  build et contrôles manuels rejoués (`architecture.md` §10 bis) ;
- étape 3 (plus de cron, passes dues sur demande, démarrage qui ne ment plus :
  F3, F4, F8, F9) codée le 14 octobre : `POST /internal/run-due-passes`,
  `startup_errors`, synchro `/usage` bloquante ; 362 tests Python et 68
  TypeScript. Aucune vérification réelle (ni `uvicorn`, ni appel de la route).
  Commit `6f82c2e`, CI verte, validée par le propriétaire ;
- étape 4 (une Phase 2 qui dit la vérité : F1, règle D2) codée le 14 octobre :
  une Phase 2 dont une cible a échoué rend `success: False`, avec `outcomes`,
  `unchanged` et `failed_targets` ; 379 tests Python et 68 TypeScript. Commit
  `df8730e`, CI verte ; le propriétaire a confié l'étape 5 ;
- étape 5 (un site en ligne sans backend : F5) codée le 14 octobre : sans
  `FASTAPI_URL`, les routes de relais répondent 503 `BACKEND_LOCAL_ONLY` sans
  appel ; `POST /api/admin/run-due-passes` (ADMIN) et
  `GET /api/admin/pipeline-jobs` (historique en base) ; `/admin/cron` en trois
  états, avec « Simuler » et « Lancer » ; bandeau `Pending_AI` dans l'inbox ;
  379 tests Python et 122 TypeScript. Vérifiée dans Chromium contre un faux
  backend et une base morte (ni vrai backend, ni Neon). Commit `16ee824`, CI
  verte, validée par le propriétaire ;
- étape 6 (le lanceur local) codée le 14 octobre sur le poste : `npm run local`
  (`scripts/start-local.ps1`) et `npm run backend` ; l'écran cite
  `npm run local` ; 379 tests Python et 128 TypeScript. Avec l'accord du
  propriétaire, vrai `npm run local` joué de bout en bout et `/admin/cron`
  suivi dans Chromium : prêt, « Simuler », refus d'un second lancement,
  « non lancé », relance sans second Next.js. Aucun ticket ni job en plus en
  base. Validée par le propriétaire ;
- étape 7 (tests des parties non couvertes : P0, P1, P2, F2 et F6) codée les
  14 et 15 octobre : F2 et F6 corrigés ; quatorze décisions du propriétaire
  sur des défauts révélés par les tests (option recommandée à chaque fois) :
  treize corrections, un défaut consigné (JSON mal formé → 500 sur le CRUD
  admin).
  Banc : chaque requête du faux Prisma relue contre le vrai schéma
  (`test/helpers/prisma-schema.ts`) ; smoke `npm run smoke`
  (`scripts/smoke-local.ts`), **pas encore joué contre `npm run dev`** (il lit
  la base partagée : accord du propriétaire). 570 tests Python et 482
  TypeScript, verts aussi sous garde réseau (0 tentative). Commit `dae8fd6` ;
  sa CI a révélé un test qui dépendait de l'heure (quota journalier Gemini),
  horloge figée sur décision du propriétaire (commit suivant) : 571 tests
  Python. Le 15 octobre, le
  propriétaire demande le commit, le push et le prompt de l'étape 8 : étape 7
  tenue pour validée ;
- étape 8 (préparer Vercel) faite le 15 octobre, sans rien déployer : CI de
  `6315a95` verte ; variables inventoriées, aucun écart ; build vert avec une
  `DATABASE_URL` morte pour seule variable ; Hobby : 300 s par fonction,
  aucune tâche planifiée ; smoke joué contre `npm run dev` avec l'accord du
  propriétaire, vert après correction de sa règle 404 (décision du
  propriétaire) ; 571 tests Python et 483 TypeScript.
  [`memory-deploiement-vercel.md`](docs/memory/memory-deploiement-vercel.md)
  réécrit : variables, intégration Neon, Upstash, décisions 8.1 (branche de
  production : `main` a 46 commits de retard) et 8.2 (préversions), ordre des
  opérations. Le 15 octobre, le propriétaire demande le commit, le push et le
  prompt de l'étape 9 : étape 8 tenue pour validée. Le projet Vercel reste à
  créer par lui (mémo §8 et §9), de préférence après l'étape 9 ;
- hors plan, le 15 octobre, à la demande du propriétaire : `/api-docs` aligné
  sur les réponses réelles (`test/api-docs.test.ts`) et titre des fiches sans
  « — EduData France » en double (`test/page-titles.test.ts`) ; 571 tests
  Python et 491 TypeScript ;
- prochaine : étape 9 (vérification de bout en bout, sur la
  branche Neon `dev` de D7).

L'étape en cours se lit dans le journal du plan (§11).

## Règles pour tout agent

1. **Avant toute action**, lire dans le plan en cours le journal (§11), le
   mode d'emploi (§0) et la section de l'étape en cours, puis les sections
   d'`architecture.md` qu'elle cite. En fin de session, compléter le journal :
   ce qui est fait, ce qui reste, les surprises, les écarts au plan et leur
   raison.
2. **Une étape à la fois.** Ne pas commencer la suivante tant que les cases de
   l'étape ne sont pas cochées, que les tests ne sont pas verts **et** que le
   propriétaire n'a pas validé.
3. **Ce qui revient au propriétaire** : variables d'environnement, `DB_DRIVER`,
   variables Vercel, branche Neon, déploiement. S'arrêter, le guider pas à pas
   sans jamais lui demander de secret dans le chat, vérifier, puis consigner au
   journal.
4. **Ne pas s'écarter** du plan, de l'architecture ni du cahier des charges de
   sa propre initiative. En cas de doute ou de contradiction, exposer le
   problème avec deux options et une recommandation, puis consigner la décision
   au journal.
5. **Un test qui échoue** ne se désactive pas et ne s'affaiblit pas.
6. **En fin d'étape** :
   - `npm test`, `npm run test:ts`, `npm run typecheck`, `npm run lint` ;
   - mettre à jour les docs de contexte pour qu'elles décrivent ce que le code
     fait réellement (§10 du plan) ;
   - faire un compte rendu.
7. **Dépenses réelles.** Aucun appel payant (Tavily, Gemini, Gemma) sans accord
   explicite du propriétaire, et les tests ne touchent jamais le réseau.
   - Plus aucun cron ne paie Research (étape 3). Une passe réelle ne part que
     par `POST /internal/run-due-passes` avec `dry_run: false`, et seulement
     avec l'accord du propriétaire. La simulation (`dry_run: true`) ne paie
     rien.
   - Lancer le backend suffit pourtant à dépenser : le traitement des
     contributions part dès le démarrage et paie Tavily et Gemma s'il trouve
     des tickets `Pending_AI`. Le démarrage écrit aussi dans la base (reprise
     et purge des jobs). Pas de `uvicorn`, `npm run backend` ni
     `npm run local` sans l'accord du propriétaire.
8. **Base de données.** Jamais `prisma db push`, `prisma migrate dev` ni
   `prisma migrate reset`. Jamais de modification d'un `migration.sql` déjà
   appliqué, même un commentaire : son empreinte change. Jamais
   `prisma db seed` sur la base partagée, dont la branche `main` est aussi la
   production Vercel.
9. **Sécurité** (README) :
   - chaque route admin choisit `guardAuth` ou `guardAdmin` ;
   - tout contenu externe injecté dans un prompt passe par `wrap_source()` ;
   - `user_text` n'atteint jamais un modèle d'IA ;
   - `lib/rate-limit.ts` est la seule limitation de débit.

## Modèle

Tout le projet se fait avec **Opus 5.5 en effort extra high** : réflexion,
architecture, code et revue. Si la session tourne sur un autre modèle ou un autre
niveau d'effort, le signaler à l'utilisateur en début de session.

## Conventions

- Échanges et documentation en français.
- Code en anglais (variables, fonctions, fichiers) ; commentaires et docstrings
  en français, comme dans le code existant. Messages de commit en français, au
  format du dépôt : `feat(scheduler): …`, `fix(phase1): …`.
- Textes de l'interface en français, avec vouvoiement.
- Le poste est sous Windows (Git Bash et PowerShell). L'interpréteur du backend
  est `backend/.venv/Scripts/python`, et les scripts doivent tourner sous
  Windows.
- **Secrets** : `.env.local`, `.env.development.local` et `backend/.env`
  appartiennent au propriétaire. Ne jamais les lire, les afficher, les modifier
  ni les committer. La liste des variables est dans `.env.example`.
- Pas de commit ni de push sans demande explicite. Le propriétaire indique la
  branche de travail (aujourd'hui `localpython`, créée depuis `newresearch` le
  14 octobre 2026).
- Next.js 16 : lire `node_modules/next/dist/docs/` avant de toucher au front
  (voir le bloc en fin de fichier). `proxy.ts` tient lieu de middleware.

## Réseau du poste

Le réseau de l'établissement ne laisse sortir que les ports 80 et 443. Le port
5432 de Neon est fermé.

| Qui se connecte à Neon | État |
|---|---|
| Next.js (Prisma + `@neondatabase/serverless`, `lib/prisma.ts`) | marche, en WebSocket sur 443, sans lire `DB_DRIVER` |
| Migrations | CLI Prisma bloquée (5432). Avec `DB_DRIVER=neon-ws` dans `.env.development.local` (posée le 14/10/2026), `npm run db:status` et `npm run db:migrate` passent en WebSocket (`scripts/db-migrate.ts`) ; `db:status` vérifié le 14/10/2026 |
| Backend Python (psycopg2) | avec `DB_DRIVER=neon-ws` dans `backend/.env` (posée le 14/10/2026), passe par le pont local `backend/neon_ws_bridge.py` (`127.0.0.1` → `wss://<hôte>/v2`) ; `get_pool()` vérifié le 14/10/2026. Sans la variable : 5432, donc bloqué |

## MCP Neon

Autorisé, sur le **projet de l'application uniquement** :

- projet `vc-bdd`, id `lucky-cell-29057691`, dans l'organisation
  `org-lively-cell-45152555` (gérée par Vercel) ;
- branche `main`, id `br-bitter-cloud-ab3c0wop` : c'est aussi la **production
  Vercel** ;
- endpoint `ep-twilight-forest-ab9qjkm7`, en région `aws-eu-west-2`.

Passer `project_id` **et** `branch_id` à chaque appel. Les autres projets que le
MCP peut voir appartiennent à d'autres applications : n'y faire aucun appel.
C'est le cas de `neon-cyclamen-river` et de tout projet d'un autre compte.

| | Outils |
|---|---|
| **Permis sans demander** (lectures) | `run_sql` limité à des `SELECT` ; `get_database_tables`, `describe_table_schema`, `describe_project`, `list_branches`, `list_postgres_endpoints` |
| **Avec l'accord du propriétaire, à chaque fois** | toute écriture (`run_sql` ou `run_sql_transaction` qui modifie, `prepare_database_migration`, `complete_database_migration`) ; tout `delete_*` ; `create_branch`, `reset_from_parent`, `restore_snapshot` ; tout changement de réglage |
| **Jamais** | `get_connection_string`, `create_credential`, `rotate_credential`, `revoke_credential`, `reset_postgres_role_password` : ils rendent ou changent des secrets |

Le MCP sert à l'agent : il ne remplace pas la connexion de l'application, et
les migrations ne passent pas par lui. Si une branche `dev` est créée (décision
D7 du plan), ajouter ici son id et en faire la cible par défaut des lectures.

## MCP Vercel

Branché le 14 octobre 2026 : serveur `vercel` de `.mcp.json`
(`https://mcp.vercel.com`), connexion par `/mcp`. Il sert à l'agent pour lire
l'état du déploiement ; il ne déploie pas à la place du propriétaire.

- **Compte** : offre Hobby, portée `anton1ps-projects`
  (`team_Q43uu5C1HjU5A00faL7P3qXG`). C'est le compte qui gère l'organisation
  Neon de la base.
- **Le projet Vercel de l'application n'existe pas encore.** Le créer revient
  au propriétaire (règle 3 ; procédure dans
  [docs/memory/memory-deploiement-vercel.md](docs/memory/memory-deploiement-vercel.md)
  et étape 8 du plan). Une fois créé, noter ici son nom et son id `prj_…`, puis
  ne cibler que lui.
- Les projets visibles aujourd'hui, `genshincraft` et
  `genshin-gatcha-calculator-proba`, appartiennent à d'autres applications :
  n'y faire aucun appel.
- **Portée de la connexion** (relevé du 14/10/2026) : les appels **sans**
  `teamId` passent ; tout appel **avec** `teamId` rend 403. Les outils qui
  exigent `teamId`, comme `get_runtime_logs`, échoueront tant que le
  propriétaire ne se sera pas reconnecté par `/mcp` en accordant la portée
  `anton1ps-projects`.

| | Outils |
|---|---|
| **Permis sans demander** (lectures, sur le projet de l'application) | `list_projects`, `get_project`, `list_deployments`, `get_deployment`, `list_deployment_events`, `get_runtime_logs`, `get_runtime_errors`, `list_project_domains`, `filter_project_envs` **sans** `decrypt` (noms des variables seulement), `search_vercel_documentation` |
| **Avec l'accord du propriétaire, à chaque fois** | tout ce qui crée, modifie ou supprime : `create_project`, `update_project`, `create_deployment`, `cancel_deployment`, `request_promote`, `request_rollback`, `pause_project`, domaines, pare-feu, routes, redirections |
| **Jamais** | écrire une variable (`create_project_env`, `edit_project_env`) : les variables reviennent au propriétaire (règle 3), et `DB_DRIVER` ne se pose jamais sur Vercel ; lire une valeur (`get_project_env`, `get_shared_env_var`, `decrypt=true`) ; créer un jeton ou une clé (`create_edge_config_token`, `create_sdk_key`, `create_kms_*`) ; tout achat ou changement d'offre (`buy_domain`, `create_or_transfer_domain`) |

## Commandes

| Commande | Rôle |
|---|---|
| `npm run local` | backend FastAPI dans sa propre fenêtre, puis Next.js (`scripts/start-local.ps1`) ; refuse si le port 8000 est pris, ne relance pas Next.js s'il tourne. **Lance le backend : accord du propriétaire requis (règle 7)** |
| `npm run backend` | backend seul, dans le terminal courant : `uvicorn` sur `127.0.0.1:8000`, sans `--reload` ; jamais `--host 0.0.0.0`. Même règle 7 |
| `npm run dev` | Next.js sur http://localhost:3000 (back-office : `/admin`) |
| `npm run smoke` | smoke local contre `npm run dev` : pages publiques et 15 `GET /api/v1/*`, lecture seule. Lit la base partagée (aussi la production) : **accord du propriétaire requis**. Pas en CI |
| `npm test` | tests Python (pytest), avec le `python` du `PATH` comme la CI, et non `backend/.venv` (décision du 14/10/2026) |
| `npm run test:ts` | tests TypeScript (`node --test`), dont les routes de `test/api/` (banc : `test/helpers/`, requêtes relues contre le schéma Prisma) ; en CI, job `ts-tests` |
| `npm run typecheck` / `npm run lint` | types / ESLint (les avertissements sont la dette connue) |
| `npm run build` | `prisma generate` puis `next build` |
| `npm run db:status` | état des migrations, en lecture seule : CLI Prisma sans `DB_DRIVER`, WebSocket avec `DB_DRIVER=neon-ws` |
| `npm run db:migrate` / `db:migrate:dry` | applique les migrations en attente / passe à blanc terminée par `ROLLBACK` (`neon-ws` seulement). Jamais sans l'accord du propriétaire : la base partagée est aussi la production |
| `npx prisma migrate status` / `deploy` | la CLI Prisma directe : exige le port 5432, fermé sur le réseau de l'établissement |

@AGENTS.md
