# Veille Concurrentiel (dépôt appVC)

**Gestionnaire de contenu** des données sur les écoles françaises : campus,
programmes, tarifs, classements, capacités d'accueil, accréditations et
statistiques. Des collègues de l'équipe (e-mails `@em-normandie.fr`) consultent
les données, des gestionnaires les tiennent à jour, des admins gèrent les
accès.

**Réorientation du 16 octobre 2026** (réunion de l'équipe) : le site doit
devenir utilisable en ligne, derrière une connexion obligatoire, avec trois
rôles. **La recherche IA est gelée** : le pipeline Tavily + Gemini et le
backend FastAPI restent tels quels, réservés à l'admin, sans nouveau
développement ni recette.

- **Next.js 16 sur Vercel** (offre Hobby) : site, API v1 et back-office de
  gestion de contenu. Il ne dépend pas du backend Python, sauf trois routes IA.
- **Base Neon** partagée avec le backend gelé.
- **Le backend FastAPI (Python)** se lance à la main sur le poste de l'admin,
  pour l'IA seulement (décision du 14 octobre 2026).
- Pas encore déployé.

## Documents de référence

[`docs/README.md`](docs/README.md) range toute la documentation en deux
parties : gestion de contenu, IA gelée.

| Document | Rôle |
|---|---|
| [docs/features/gestion-contenu.md](docs/features/gestion-contenu.md) | **le plan en cours** : décisions (§2), pièges (§4), étapes (§5), journal (§9) |
| [docs/architecture/gestion-contenu.md](docs/architecture/gestion-contenu.md) | **l'état réel du code** du gestionnaire de contenu : rôles, gardes, écrans, routes, tables, styles, tests |
| [README.md](README.md) | démarrage, variables, commandes, points de sécurité |
| [docs/architecture/bdd.md](docs/architecture/bdd.md) · [API-rest.md](docs/architecture/API-rest.md) | schéma de la base (12 migrations) · API v1 (15 routes, session exigée) |
| [docs/memory/memory-deploiement-vercel.md](docs/memory/memory-deploiement-vercel.md) | mise en ligne sur Vercel |
| [docs/cahier-des-charges-school-pipeline.md](docs/cahier-des-charges-school-pipeline.md) | exigences d'origine (l'en-tête renvoie au plan d'évolution) |
| [docs/architecture/architecture.md](docs/architecture/architecture.md) | référence technique v2.1, centrée sur le pipeline IA : pour les questions sur l'IA, la sécurité (§10) et l'outillage (§10 bis) |
| [docs/features/backend-local.md](docs/features/backend-local.md) | dernier chantier IA, **gelé** le 16 octobre ; son journal (§11) tient l'historique |
| [docs/edgecase.md](docs/edgecase.md) | cas limites et leurs parades |

## Phase en cours

Chantier « gestionnaire de contenu en ligne »
([docs/features/gestion-contenu.md](docs/features/gestion-contenu.md)), sur la
branche `gestion` :

- plan rédigé le 16 octobre 2026 à partir du doc « Plan d'évolution – School
  Data Pipeline » du propriétaire ; décisions G1 à G9 prises le même jour
  (trois rôles `USER`, `GESTIONNAIRE`, `ADMIN` ; liste blanche d'e-mails sans
  envoi d'e-mail ; API v1 derrière la connexion ; production = `main`
  rattrapée sur `gestion` ; Tailwind et refonte en deux temps ; IA réservée à
  l'admin) ;
- étape 0 (recentrage : branche, documentation) faite le 16 octobre et
  validée (le propriétaire demande le commit, le push et le prompt de
  l'étape 1) ;
- étape 1 (trois rôles, gardes, connexion obligatoire) faite le 16 octobre et
  validée (le propriétaire demande le commit, le push et le prompt de
  l'étape 2) : décisions D1 (rôle relu en base), D2
  (`/contribute` retirée), D18 (l'écran des comptes crée des `GESTIONNAIRE`),
  D19 (créations et suppressions du contenu au gestionnaire) ; migration
  `20261016120000_three_roles` appliquée sur la branche Neon `dev`, puis sur
  `main` le 19 octobre (étape 3) ; `npm run smoke` adapté et joué (vert) avec
  l'accord du propriétaire ;
- étape 2 (liste blanche, première connexion, écran des rôles) faite le
  16 octobre et validée (le propriétaire demande le commit, le push et le
  prompt de l'étape 3) : décisions D3
  (l'ancien identifiant ne vaut que pour un compte sans adresse), D4 (remise
  en première connexion, plus de mot de passe fixé pour un tiers), D5
  (domaine `@em-normandie.fr` imposé), D6 (nom affiché à la première
  connexion), D20 (un compte qui n'est plus actif perd sa session ; la lecture
  reste possible jusqu'à 8 h), D21 (un compte actif se désactive au lieu
  d'être supprimé) ; migration `20261016150000_whitelist_accounts` appliquée
  sur la branche Neon `dev`, puis sur `main` le 19 octobre (étape 3) ; smoke
  adapté et vert (la phase connectée, rejouée au début de l'étape 3) ;
- en cours : étape 3 (mise en ligne). Faits : smoke connecté vert ; décisions
  D7 (Hobby gardé, en connaissance de cause), D22 (préversions : base reliée
  à Production seulement), D23 (`preload` de HSTS gardé) ; les deux
  migrations sur la branche Neon `main` le 19 octobre (12/12) ; mot de passe
  de `neondb_owner` changé par le propriétaire sur `main` et sur `dev` le
  19 octobre, secrets GitHub à jour. Restent : Upstash, fusion de `gestion`
  dans `main`, projet Vercel, vérifications après déploiement, comptes.

L'étape en cours se lit dans le journal du plan (§9).

## Partie IA gelée

État au gel (16 octobre 2026), détail dans le journal de
[`backend-local.md`](docs/features/backend-local.md) (§11) :

- étapes 0 à 8 du plan backend-local faites et validées : backend local,
  `DB_DRIVER=neon-ws`, plus de cron, passes dues sur demande
  (`POST /internal/run-due-passes`), `/admin/cron` en trois états,
  `npm run local`, tests des parties non couvertes, préparation de Vercel ;
- étape 9 (vérification de bout en bout) jouée et validée en l'état le
  15 octobre, **case non cochée** ; tâches C1 à C4 (crowdsourcing par la
  cascade Gemini) et « trois sources par ticket » poussées (`12b6bb3`,
  `423631e`) ; la recette de bout en bout qui devait cocher l'étape 9 est
  **abandonnée** par la réorientation ;
- les règles de dépense (règle 7) restent en vigueur : le code IA est
  toujours là, et lancer le backend paie toujours.

## Règles pour tout agent

1. **Avant toute action**, lire dans le plan en cours
   ([gestion-contenu.md](docs/features/gestion-contenu.md)) le journal (§9),
   le mode d'emploi (§0), les pièges (§4) et la section de l'étape en cours,
   puis [architecture/gestion-contenu.md](docs/architecture/gestion-contenu.md).
   En fin de session, compléter le journal : ce qui est fait, ce qui reste, les
   surprises, les écarts au plan et leur raison.
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
5. **Un test qui échoue** ne se désactive pas et ne s'affaiblit pas. Quand le
   propriétaire change une règle, l'attendu du test change avec elle, et le
   journal le dit (plan §0).
6. **En fin d'étape** :
   - `npm test`, `npm run test:ts`, `npm run typecheck`, `npm run lint` ;
   - mettre à jour les docs de contexte pour qu'elles décrivent ce que le code
     fait réellement (§8 du plan), à commencer par
     `docs/architecture/gestion-contenu.md` ;
   - faire un compte rendu.
7. **Dépenses réelles.** Aucun appel payant (Tavily, Gemini, Gemma) sans accord
   explicite du propriétaire, et les tests ne touchent jamais le réseau.
   - Une passe réelle ne part que par `POST /internal/run-due-passes` avec
     `dry_run: false`, et seulement avec l'accord du propriétaire. La
     simulation (`dry_run: true`) ne paie rien.
   - Lancer le backend suffit pourtant à dépenser : le traitement des
     contributions part dès le démarrage et paie Tavily, Gemini (et Gemma en
     dernier recours) s'il trouve des tickets `Pending_AI`. Le démarrage écrit aussi dans la base (reprise
     et purge des jobs). Pas de `uvicorn`, `npm run backend` ni
     `npm run local` sans l'accord du propriétaire.
   - Rien de nouveau ne doit créer de ticket `Pending_AI` (plan, piège 6).
8. **Base de données.** Jamais `prisma db push`, `prisma migrate dev` ni
   `prisma migrate reset`. Jamais de modification d'un `migration.sql` déjà
   appliqué, même un commentaire : son empreinte change. Jamais
   `prisma db seed` sur la base partagée, dont la branche `main` est aussi la
   production Vercel. Une nouvelle migration s'écrit à la main, se joue à
   blanc, puis sur la branche Neon `dev`, avec l'accord du propriétaire à
   chaque fois (plan §0).
9. **Sécurité** (README) :
   - connexion obligatoire sur tout le site (`proxy.ts`), sauf la page de
     connexion, la première connexion (`/admin/first-login`,
     `POST /api/first-login`) et `/api/auth/*` ; toute route posée sous
     `/api/auth/` devient publique d'office ; le proxy ne regarde que la
     session, jamais le rôle ; connexion et première connexion partagent un
     seul plafond ;
   - chaque route admin attend une seule garde de `lib/auth.ts` :
     `guardSignedIn` (toute session), `guardManager` (gestionnaire ou admin)
     ou `guardAdmin` ; le niveau de chaque route est dans
     `test/helpers/access-policy.ts` et
     `docs/architecture/gestion-contenu.md` §4 ; l'IA (inbox comprise) et les
     comptes sont en `guardAdmin` ; les écrans `/admin` passent par
     `requirePage` ; le rôle est relu en base à chaque requête (D1), jamais
     pris dans le jeton ; un compte qui n'est pas actif, ou dont la version
     de session a changé, n'a plus de session (D20) ; ce que chacun fait pour
     soi (« Mon compte ») est en `guardSignedIn`, sans identifiant dans la
     route ; aucune opération ne laisse zéro admin actif
     (`lib/account-admin.ts`) ;
   - tout contenu externe injecté dans un prompt passe par `wrap_source()` ;
   - `user_text` n'atteint jamais un modèle d'IA ;
   - `lib/rate-limit.ts` est la seule limitation de débit.
10. **Partie IA gelée.** Ne modifier ni `backend/`, ni les routes et écrans IA,
    sauf ce qu'une étape du plan demande explicitement (plan §6). Les tests
    Python restent verts : le backend gelé partage la base, et une colonne
    renommée ou rendue obligatoire le casse.

## Modèle

Tout le projet se fait avec **Opus 5.5 en effort extra high** : réflexion,
architecture, code et revue. Si la session tourne sur un autre modèle ou un autre
niveau d'effort, le signaler à l'utilisateur en début de session. Une exception
pour la reprise graphique mécanique (étape 9) reste à décider par le
propriétaire (plan, D17).

## Conventions

- Échanges et documentation en français.
- Code en anglais (variables, fonctions, fichiers) ; commentaires et docstrings
  en français, comme dans le code existant. Messages de commit en français, au
  format du dépôt : `feat(auth): …`, `fix(admin): …`.
- Textes de l'interface en français, avec vouvoiement.
- Le poste est sous Windows (Git Bash et PowerShell). L'interpréteur du backend
  est `backend/.venv/Scripts/python`, et les scripts doivent tourner sous
  Windows.
- **Secrets** : `.env.local`, `.env.development.local` et `backend/.env`
  appartiennent au propriétaire. Ne jamais les lire, les afficher, les modifier
  ni les committer. La liste des variables est dans `.env.example`.
- Pas de commit ni de push sans demande explicite. Le propriétaire indique la
  branche de travail : aujourd'hui `gestion`, créée depuis `localpython`
  (`423631e`) le 16 octobre 2026. `localpython` est gardée en l'état (dernier
  état de la partie IA).
- Next.js 16 : lire `node_modules/next/dist/docs/` avant de toucher au front
  (voir le bloc en fin de fichier). `proxy.ts` tient lieu de middleware.
- Styles : `app/globals.css` aujourd'hui ; Tailwind CSS v4 à partir de
  l'étape 4 du plan, sans preflight jusqu'à l'étape 9 (plan, piège 10).

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
- branche `main`, id `br-bitter-cloud-ab3c0wop`, endpoint
  `ep-twilight-forest-ab9qjkm7` : c'est aussi la **production Vercel** ;
- branche `dev`, id `br-rapid-bird-abck4fdr`, endpoint
  `ep-falling-breeze-abibnpc4`, créée depuis `main` le 15 octobre 2026 :
  essais, vérifications et migrations à blanc. **Cible par défaut des
  lectures**. Le poste vise `dev` depuis le 15 octobre 2026 ; bascule :
  `docs/testing/manual_testing_cron.md` §1.3 ;
- région `aws-eu-west-2`.

Passer `project_id` **et** `branch_id` à chaque appel. Les autres projets que le
MCP peut voir appartiennent à d'autres applications : n'y faire aucun appel.
C'est le cas de `neon-cyclamen-river` et de tout projet d'un autre compte.

| | Outils |
|---|---|
| **Permis sans demander** (lectures) | `run_sql` limité à des `SELECT` ; `get_database_tables`, `describe_table_schema`, `describe_project`, `list_branches`, `list_postgres_endpoints` |
| **Avec l'accord du propriétaire, à chaque fois** | toute écriture (`run_sql` ou `run_sql_transaction` qui modifie, `prepare_database_migration`, `complete_database_migration`) ; tout `delete_*` ; `create_branch`, `reset_from_parent`, `restore_snapshot` ; tout changement de réglage |
| **Jamais** | `get_connection_string`, `create_credential`, `rotate_credential`, `revoke_credential`, `reset_postgres_role_password` : ils rendent ou changent des secrets |

Le MCP sert à l'agent : il ne remplace pas la connexion de l'application, et
les migrations ne passent pas par lui.

## MCP Vercel

Branché le 14 octobre 2026 : serveur `vercel` de `.mcp.json`
(`https://mcp.vercel.com`), connexion par `/mcp`. Il sert à l'agent pour lire
l'état du déploiement ; il ne déploie pas à la place du propriétaire.

- **Compte** : offre Hobby, portée `anton1ps-projects`
  (`team_Q43uu5C1HjU5A00faL7P3qXG`). C'est le compte qui gère l'organisation
  Neon de la base.
- **Le projet Vercel de l'application n'existe pas encore.** Le créer revient
  au propriétaire, à l'étape 3 du plan (après la connexion obligatoire ;
  procédure dans
  [docs/memory/memory-deploiement-vercel.md](docs/memory/memory-deploiement-vercel.md)).
  Une fois créé, noter ici son nom et son id `prj_…`, puis ne cibler que lui.
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
| `npm run dev` | Next.js sur http://localhost:3000 (back-office : `/admin`) |
| `npm test` | tests Python (pytest), avec le `python` du `PATH` comme la CI, et non `backend/.venv` (décision du 14/10/2026) ; couvrent le backend gelé |
| `npm run test:ts` | tests TypeScript (`node --test`), dont les routes de `test/api/` (banc : `test/helpers/`, requêtes relues contre le schéma Prisma) ; en CI, job `ts-tests` |
| `npm run typecheck` / `npm run lint` | types / ESLint (les avertissements sont la dette connue) |
| `npm run build` | `prisma generate` puis `next build` |
| `npm run smoke` | smoke local contre `npm run dev` : le mur sans session (pages renvoyées vers la connexion, `/api/schools` et 15 `GET /api/v1/*` en 401), puis, si `APPVC_ADMIN_PASSWORD` et `APPVC_ADMIN_EMAIL` (ou, tant que le compte n'a pas d'adresse, `APPVC_ADMIN_USERNAME`) sont posées, les pages et l'API connecté. Lecture seule. Lit la base visée : **accord du propriétaire requis**. Pas en CI |
| `npm run db:status` | état des migrations, en lecture seule : CLI Prisma sans `DB_DRIVER`, WebSocket avec `DB_DRIVER=neon-ws` |
| `npm run db:migrate` / `db:migrate:dry` | applique les migrations en attente / passe à blanc terminée par `ROLLBACK` (`neon-ws` seulement). Jamais sans l'accord du propriétaire |
| `npx prisma migrate status` / `deploy` | la CLI Prisma directe : exige le port 5432, fermé sur le réseau de l'établissement |
| `npm run local` | **IA** : backend FastAPI dans sa propre fenêtre, puis Next.js (`scripts/start-local.ps1`). **Lance le backend : accord du propriétaire requis (règle 7)** |
| `npm run backend` | **IA** : backend seul, `uvicorn` sur `127.0.0.1:8000`, sans `--reload` ; jamais `--host 0.0.0.0`. Même règle 7 |

@AGENTS.md
