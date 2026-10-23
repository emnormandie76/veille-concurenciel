# Veille Concurrentiel (dépôt appVC)

**Gestionnaire de contenu** des données sur les écoles françaises : campus,
programmes, tarifs, classements, capacités d'accueil, accréditations,
statistiques et admissions. Des collègues de l'équipe (e-mails
`@em-normandie.fr`) consultent les données, des gestionnaires les tiennent à
jour, des admins gèrent les accès. Le site est en ligne, derrière une
connexion obligatoire, avec trois rôles. **La recherche IA est gelée** (depuis
le 16 octobre 2026) : le pipeline Tavily + Gemini et le backend FastAPI
restent tels quels, réservés à l'admin, sans nouveau développement ni recette.

- **Next.js 16 sur Vercel** (offre Hobby) : site, API v1 et back-office de
  gestion de contenu, inbox comprise. Il ne joint aucun backend : la console
  IA (`/admin/cron`), ses routes et le backend vivent sur la branche `local`
  (D100, D101).
- **Base Neon** partagée avec le backend gelé.
- **Le backend FastAPI (Python)** se lance à la main sur le poste de l'admin,
  pour l'IA seulement, depuis la branche `local`.
- **En ligne** : <https://app-vc-emn.vercel.app>, sur les comptes de l'école
  (dépôt GitHub `emnormandie76/veille-concurenciel`, Vercel et Neon de
  l'école ; `Anton1P` ne fait que pousser : les commits sont signés au nom
  d'`emnormandie76` par le réglage Git local du dépôt, sans quoi Vercel bloque
  le déploiement, offre Hobby).

## Documents de référence

[`docs/README.md`](docs/README.md) est l'index de la documentation.

| Document | Rôle |
|---|---|
| [docs/features/gestion-contenu.md](docs/features/gestion-contenu.md) | **le plan** : décisions (§2), pièges (§4), étapes (§5), journal (§9). Le code cite ses décisions (G1 à G9, D1 à D123) |
| [docs/architecture/gestion-contenu.md](docs/architecture/gestion-contenu.md) | **l'état réel du code** : rôles, gardes, écrans, routes, tables, styles, tests, sécurité (§8), outillage et CI (§9) |
| [docs/architecture/charte-graphique.md](docs/architecture/charte-graphique.md) | **la charte graphique** : jetons, contrastes, polices, composants, gabarits, accessibilité, mise en œuvre |
| [README.md](README.md) | démarrage, variables, commandes, points de sécurité |
| [docs/architecture/bdd.md](docs/architecture/bdd.md) · [API-rest.md](docs/architecture/API-rest.md) | schéma de la base (16 migrations), migrations et leur lanceur · API v1 (15 routes, session exigée) |
| [docs/memory/memory-deploiement-vercel.md](docs/memory/memory-deploiement-vercel.md) | la production sur Vercel, la bascule du poste entre les branches Neon (§2.1), livrer une version (§3.2) |
| [docs/edgecase.md](docs/edgecase.md) | cas limites du site et leurs parades |
| [docs/guide/](docs/guide/) | les guides Word, un par rôle ; sur le site, « Aide » (`/help`, texte dans `app/help/guides.tsx`) : deux textes à tenir ensemble (D112) |

Les documents de la partie IA (référence technique, plan gelé
`backend-local.md` et son journal, fiches de test) sont sur la branche
`local` : `git show local:<chemin>`, sans changer de branche.

## Phase en cours

Chantier « gestionnaire de contenu en ligne »
([docs/features/gestion-contenu.md](docs/features/gestion-contenu.md)), sur la
branche `gestion` :

- **étapes 0 à 13 faites, validées et en production** (16 au 22 octobre
  2026) : trois rôles et connexion obligatoire, liste blanche, mise en ligne,
  charte graphique, provenance de chaque donnée, signalement, journal des
  lancements de l'IA, admissions, reprise graphique de tous les écrans, deux
  corrections d'interface, l'IA séparée sur la branche `local`, le tri des
  branches, le nettoyage du contexte ;
- **étape 14, la dernière, faite et validée le 23 octobre**, puis mise en
  production : le guide utilisateur, sur le site (« Aide », `/help`, à
  chacun le guide de son rôle) et en Word (`docs/guide/`, un par rôle) ;
- **après la livraison** (23 octobre) : `next` 16.4.2 (un avis critique),
  laissé hors de `local` (D116) ; le plafond de la connexion ne compte plus
  que les échecs (D117) ;
- **étape 15, en cours** : des finitions (D118 à D123) : le nom « Veille
  concurrentielle », le JSON mal formé en 400, `/api/schools`,
  `eslint-config-next`, la base de CI éphémère, la CSP à nonce ; livrée en
  une fois avec D117 ;
- **ensuite** : D15 (les événements des écoles) reste ouverte, en attente
  de l'équipe.

L'étape en cours se lit dans le journal du plan (§9).

## Partie IA gelée

Le code IA (le backend, ses tests Python, la console `/admin/cron` et ses
routes, `npm run local`, `npm run backend`) vit sur la branche **`local`**, un
instantané de `gestion` à la fin de l'étape 10 (`e4ba0c5`) ; `gestion` et
`main` n'en gardent que l'inbox. On ne fusionne jamais `gestion` dans `local`
(le retrait s'y appliquerait) : un correctif s'y reporte par `cherry-pick`.
Son état au gel et son histoire sont dans les documents de `local`. Les règles
de dépense (règle 7) restent en vigueur : lancer le backend paie toujours.

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
4. **Ne pas s'écarter** du plan ni de l'architecture de sa propre initiative.
   En cas de doute ou de contradiction, exposer le problème avec deux options
   et une recommandation, puis consigner la décision au journal.
5. **Un test qui échoue** ne se désactive pas et ne s'affaiblit pas. Quand le
   propriétaire change une règle, l'attendu du test change avec elle, et le
   journal le dit (plan §0).
6. **En fin d'étape** :
   - `npm test`, `npm run test:ts`, `npm run typecheck`, `npm run lint`
     (sur `gestion`, `npm test` lance les tests TypeScript, D105 ; sur
     `local`, les tests Python) ;
   - mettre à jour les docs de contexte pour qu'elles décrivent ce que le code
     fait réellement (§8 du plan), à commencer par
     `docs/architecture/gestion-contenu.md` ;
   - faire un compte rendu.
7. **Dépenses réelles.** Aucun appel payant (Tavily, Gemini, Gemma) sans accord
   explicite du propriétaire, et les tests ne touchent jamais le réseau.
   - Sur `gestion` et `main`, aucune commande ne peut dépenser : le backend et
     les commandes qui le lancent n'existent que sur `local`
     (`test/no-ai-backend.test.ts`).
   - Sur `local`, une passe réelle ne part que par
     `POST /internal/run-due-passes` avec `dry_run: false`, et seulement avec
     l'accord du propriétaire ; la simulation (`dry_run: true`) ne paie rien.
     Lancer le backend suffit pourtant à dépenser : le traitement des
     contributions part dès le démarrage et paie Tavily, Gemini (et Gemma en
     dernier recours) s'il trouve des tickets `Pending_AI`. Le démarrage écrit
     aussi dans la base (reprise et purge des jobs). Pas de `uvicorn`,
     `npm run backend` ni `npm run local` sans l'accord du propriétaire.
   - Rien de nouveau ne doit créer de ticket `Pending_AI` (plan, piège 6).
8. **Base de données.** Jamais `prisma db push`, `prisma migrate dev` ni
   `prisma migrate reset`. Jamais de modification d'un `migration.sql` déjà
   appliqué, même un commentaire : son empreinte change. Jamais
   `prisma db seed` sur la base partagée, dont la branche `main` est aussi la
   production Vercel. Une nouvelle migration s'écrit à la main, se joue à
   blanc, puis sur la branche Neon `dev`, avec l'accord du propriétaire à
   chaque fois ([bdd.md](docs/architecture/bdd.md) §4).
9. **Sécurité** (README) :
   - connexion obligatoire sur tout le site (`proxy.ts`), sauf la page de
     connexion, la première connexion (`/admin/first-login`,
     `POST /api/first-login`) et `/api/auth/*` ; toute route posée sous
     `/api/auth/` devient publique d'office ; le proxy ne regarde que la
     session, jamais le rôle ; connexion et première connexion partagent
     leurs compteurs d'échecs (`lib/login-attempts.ts`, D117 : 5 par compte,
     20 par IP, 15 minutes ; une réussite ne compte jamais) ;
   - chaque route admin attend une seule garde de `lib/auth.ts` :
     `guardSignedIn` (toute session), `guardManager` (gestionnaire ou admin)
     ou `guardAdmin` ; le niveau de chaque route est dans
     `test/helpers/access-policy.ts` et
     `docs/architecture/gestion-contenu.md` §4 ; l'IA (inbox comprise) et les
     comptes sont en `guardAdmin` ; les écrans `/admin` passent par
     `requirePage` ; le rôle est relu en base à chaque requête (D1), jamais
     pris dans le jeton ; un compte qui n'est pas actif, ou dont la version
     de session a changé, n'a plus de session (D20) ; ce que chacun fait pour
     soi (« Mon compte ») et l'envoi d'un signalement sont en
     `guardSignedIn`, sans identifiant dans la route, l'auteur pris dans la
     session ; aucune opération ne laisse zéro admin actif
     (`lib/account-admin.ts`) ;
   - tout contenu externe injecté dans un prompt passe par `wrap_source()`
     (backend, branche `local`) ;
   - `user_text` n'atteint jamais un modèle d'IA (idem) ;
   - `lib/rate-limit.ts` est la seule limitation de débit.
10. **Partie IA gelée.** Ne modifier ni `backend/`, ni les routes et écrans IA,
    sauf ce qu'une étape du plan demande explicitement (plan §6). Ils vivent
    sur la branche `local` (D100, D101) : rien n'y change sans demande,
    jamais de fusion de `gestion` dans `local`, un correctif s'y reporte par
    `cherry-pick`. Sur `gestion`, l'inbox reste de l'IA gelée. Le backend de
    `local` partage la base : une colonne renommée ou rendue obligatoire le
    casse, et ses tests Python, sur `local`, ne le disent que si on les y
    lance ; toute colonne ajoutée à `PipelineJob` ou `ContributionInbox`
    accepte le vide.

## Modèle

Tout le projet se fait avec **Opus 5.5 en effort extra high** : réflexion,
architecture, code et revue (D17). Si la session tourne sur un autre modèle
ou un autre niveau d'effort, le signaler à l'utilisateur en début de session.

## Conventions

- Échanges et documentation en français.
- Code en anglais (variables, fonctions, fichiers) ; commentaires et docstrings
  en français, comme dans le code existant. Messages de commit en français, au
  format du dépôt : `feat(auth): …`, `fix(admin): …`.
- Textes de l'interface en français, avec vouvoiement.
- Le poste est sous Windows (Git Bash et PowerShell). L'interpréteur du backend
  (branche `local`) est `backend/.venv/Scripts/python`, et les scripts
  doivent tourner sous Windows.
- **Secrets** : `.env.local`, `.env.development.local` et `backend/.env`
  appartiennent au propriétaire. Ne jamais les lire, les afficher, les modifier
  ni les committer. La liste des variables est dans `.env.example`.
- **Branches.** Pas de commit ni de push sans demande explicite. Le dépôt ne
  garde que trois branches, sur le poste comme sur `origin` (D102) : `main`
  (la production, avancée sur `gestion` par avance rapide), `gestion` (le
  travail, que le propriétaire indique) et `local` (la partie IA). Le remote
  `anton1p` (`Anton1P/veille-concurenciel`) est une sauvegarde figée : aucune
  commande vers lui ; `git fetch origin`, jamais `git fetch --all`, qui y
  reste bloqué (il demande des identifiants). Pousser :
  `git -c credential.username=Anton1P push origin <branche>`.
- Next.js 16 : lire `node_modules/next/dist/docs/` avant de toucher au front
  (voir le bloc en fin de fichier). `proxy.ts` tient lieu de middleware.
- Styles : la charte graphique
  ([`docs/architecture/charte-graphique.md`](docs/architecture/charte-graphique.md)),
  seule (D96, D97) : Tailwind CSS v4 entier, preflight compris
  (`app/globals.css` : l'import de Tailwind, la charte, et les `@source`
  `app/` et `components/`, rien d'autre) ; jetons et base du document dans
  `app/charte.css`, composants dans `components/ui/`, gabarits dans
  `components/layout/`, cadre du back-office dans `app/admin/layout.tsx` et
  `SidebarClient.tsx`. Tout écran s'y construit, dans son gabarit. Pas d'autre
  feuille de style, ni de bloc `styled-jsx` ou `<style>`, ni de couleur
  littérale, ni de `style` en ligne, ni d'émoji (D56) ; une classe écrite en
  clair est un utilitaire de la charte (test). Regarder un écran nouveau à
  1 440 et à 390 px.

## Réseau du poste

Le réseau de l'établissement ne laisse sortir que les ports 80 et 443. Le port
5432 de Neon est fermé.

| Qui se connecte à Neon | État |
|---|---|
| Next.js (Prisma + `@neondatabase/serverless`, `lib/prisma.ts`) | marche, en WebSocket sur 443, sans lire `DB_DRIVER` |
| Migrations | CLI Prisma bloquée (5432). Avec `DB_DRIVER=neon-ws` dans `.env.development.local`, `npm run db:status` et `npm run db:migrate` passent en WebSocket (`scripts/db-migrate.ts`, [bdd.md](docs/architecture/bdd.md) §4) |
| Backend Python (psycopg2), branche `local` | avec `DB_DRIVER=neon-ws` dans `backend/.env`, passe par le pont local `backend/neon_ws_bridge.py` (`127.0.0.1` → `wss://<hôte>/v2`). Sans la variable : 5432, donc bloqué |

## MCP Neon

Autorisé, sur le **projet de l'application uniquement**. La base appartient au
compte de l'école ; le MCP est connecté à ce compte :

- projet `vc-bdd`, id `noisy-credit-34683167`, dans l'organisation
  `org-long-unit-38729916` (« Vercel: EM-Normandie », gérée par le Vercel de
  l'école, compte `emnormandie76`) ; Postgres 18 ;
- branche `main`, id `br-late-water-za82d15h`, endpoint
  `ep-super-rain-zas6jyy2` : c'est aussi la **production Vercel** ;
- branche `dev`, id `br-odd-cloud-zao7fqra`, endpoint
  `ep-proud-lab-za705j3u` : essais, vérifications et migrations à blanc.
  **Cible par défaut des lectures**. Le poste vise `dev` ; bascule :
  [mémo Vercel](docs/memory/memory-deploiement-vercel.md) §2.1 ;
- région `aws-eu-west-2` (endpoints en `c-2.eu-west-2.aws.neon.tech`).

Passer `project_id` **et** `branch_id` à chaque appel. Les autres projets que le
MCP peut voir appartiennent à d'autres applications : n'y faire aucun appel.
C'est le cas de `neon-bisque-pillar` (`gentle-thunder-89807010`) et de tout
projet d'un autre compte.

**L'ancienne base** (projet `lucky-cell-29057691`, organisation
`org-lively-cell-45152555`, gérée par le Vercel personnel d'`Anton1P` ;
branches `main` `ep-twilight-forest-ab9qjkm7` et `dev`
`ep-falling-breeze-abibnpc4`) reste en **sauvegarde figée** : plus rien n'y
écrit, et le MCP ne la voit plus.

| | Outils |
|---|---|
| **Permis sans demander** (lectures) | `run_sql` limité à des `SELECT` ; `get_database_tables`, `describe_table_schema`, `describe_project`, `list_branches`, `list_postgres_endpoints` |
| **Avec l'accord du propriétaire, à chaque fois** | toute écriture (`run_sql` ou `run_sql_transaction` qui modifie, `prepare_database_migration`, `complete_database_migration`) ; tout `delete_*` ; `create_branch`, `reset_from_parent`, `restore_snapshot` ; tout changement de réglage |
| **Jamais** | `get_connection_string`, `create_credential`, `rotate_credential`, `revoke_credential`, `reset_postgres_role_password` : ils rendent ou changent des secrets |

Le MCP sert à l'agent : il ne remplace pas la connexion de l'application, et
les migrations ne passent pas par lui.

## MCP Vercel

Serveur `vercel` de `.mcp.json` (`https://mcp.vercel.com`), connexion par
`/mcp`. Il sert à l'agent pour lire l'état du déploiement ; il ne déploie pas
à la place du propriétaire.

- **Compte** : celui de l'école, créé avec le GitHub `emnormandie76`
  (utilisateur `BjIsUlzdkbYaOS6dBuc8YQpm`), offre Hobby, équipe
  `team_hWcs8vjorV4Dp3j3YhN7HL1w`. C'est le compte qui gère l'organisation
  Neon de la base.
- **Projet de l'application** : `app-vc`, id
  `prj_x0D6x90ihnJnc86piYtt9fJXfNLM` (le seul site Next.js, sans le backend) ;
  équipe `em-normandie1`. **Adresse du site : `https://app-vc-emn.vercel.app`**,
  le domaine principal (c'est la valeur de `NEXTAUTH_URL`) ; l'adresse
  attribuée à la création, `https://app-vc-taupe.vercel.app`, y renvoie en 307.
  **Ne cibler que lui.** Procédure :
  [docs/memory/memory-deploiement-vercel.md](docs/memory/memory-deploiement-vercel.md).
- Le projet `les-petits-pronos-de-la-promo`
  (`prj_yEjDnV9JJXXsVhHnyk6DZcrssT2Z`) appartient à une autre application :
  n'y faire aucun appel.
- **Portée de la connexion** : les appels **sans** `teamId` passent ; tout
  appel **avec** `teamId` rend 403 (« scope em-normandie1 »). Les outils qui
  exigent `teamId`, comme `get_runtime_logs`, échoueront tant que le
  propriétaire ne se sera pas reconnecté par `/mcp` en accordant la portée de
  l'équipe `em-normandie1`.

| | Outils |
|---|---|
| **Permis sans demander** (lectures, sur le projet de l'application) | `list_projects`, `get_project`, `list_deployments`, `get_deployment`, `list_deployment_events`, `get_runtime_logs`, `get_runtime_errors`, `list_project_domains`, `filter_project_envs` **sans** `decrypt` (noms des variables seulement), `search_vercel_documentation` |
| **Avec l'accord du propriétaire, à chaque fois** | tout ce qui crée, modifie ou supprime : `create_project`, `update_project`, `create_deployment`, `cancel_deployment`, `request_promote`, `request_rollback`, `pause_project`, domaines, pare-feu, routes, redirections |
| **Jamais** | écrire une variable (`create_project_env`, `edit_project_env`) : les variables reviennent au propriétaire (règle 3), et `DB_DRIVER` ne se pose jamais sur Vercel ; lire une valeur (`get_project_env`, `get_shared_env_var`, `decrypt=true`) ; créer un jeton ou une clé (`create_edge_config_token`, `create_sdk_key`, `create_kms_*`) ; tout achat ou changement d'offre (`buy_domain`, `create_or_transfer_domain`) |

## MCP GitHub

Serveur `github` de `.mcp.json` (`https://api.githubcopilot.com/mcp/`,
outils `actions` et `repos`), authentifié par la variable Windows
`GITHUB_MCP_PAT` du propriétaire : un jeton *fine-grained* du compte
**`emnormandie76`**, limité au dépôt `emnormandie76/veille-concurenciel` :
Actions en lecture et écriture (lire la CI, relancer un run), Contents en
lecture seule. Il ne voit pas les dépôts d'`Anton1P`. Permis sans demander :
lire les runs, les jobs et leurs journaux. Relancer ou annuler un run : avec
l'accord du propriétaire. Le code ne passe jamais par le MCP : commits et push
par `git`.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Next.js sur http://localhost:3000 (back-office : `/admin`) |
| `npm test` | les tests TypeScript, comme `npm run test:ts` (D105). Sur la branche `local` : les tests Python (pytest), avec le `python` du `PATH`, et non `backend/.venv` |
| `npm run test:ts` | tests TypeScript (`node --test`), dont les routes de `test/api/` (banc : `test/helpers/`, requêtes relues contre le schéma Prisma) ; en CI, job `ts-tests` |
| `npm run typecheck` / `npm run lint` | types / ESLint (les avertissements sont la dette connue) |
| `npm run build` | `prisma generate` puis `next build` |
| `npm run smoke` | smoke local contre `npm run dev` : le mur sans session (pages renvoyées vers la connexion, `/api/schools` et 15 `GET /api/v1/*` en 401), puis, si `APPVC_ADMIN_PASSWORD` et `APPVC_ADMIN_EMAIL` (ou, tant que le compte n'a pas d'adresse, `APPVC_ADMIN_USERNAME`) sont posées, les pages et l'API connecté. Lecture seule. Lit la base visée : **accord du propriétaire requis**. Pas en CI |
| `npm run db:status` | état des migrations, en lecture seule : CLI Prisma sans `DB_DRIVER`, WebSocket avec `DB_DRIVER=neon-ws` |
| `npm run db:migrate` / `db:migrate:dry` | applique les migrations en attente / passe à blanc terminée par `ROLLBACK` (`neon-ws` seulement). Jamais sans l'accord du propriétaire |
| `npx prisma migrate status` / `deploy` | la CLI Prisma directe : exige le port 5432, fermé sur le réseau de l'établissement |
| `npm run local` / `npm run backend` | **branche `local` seulement** (IA) : le backend FastAPI dans sa propre fenêtre puis Next.js (`scripts/start-local.ps1`) / le backend seul (`uvicorn` sur `127.0.0.1:8000`, sans `--reload`, jamais `--host 0.0.0.0`). **Lancent le backend : accord du propriétaire requis (règle 7)** |

@AGENTS.md
