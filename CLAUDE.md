# Veille Concurrentiel (dépôt appVC) — branche `local`

**Gestionnaire de contenu** des données sur les écoles françaises : campus,
programmes, tarifs, classements, capacités d'accueil, accréditations,
statistiques et admissions. Des collègues de l'équipe (e-mails
`@em-normandie.fr`) consultent les données, des gestionnaires les tiennent à
jour, des admins gèrent les accès. **La recherche IA est gelée** (depuis le
16 octobre 2026) : le pipeline Tavily + Gemini et le backend FastAPI restent
tels quels, réservés à l'admin, sans nouveau développement ni recette.

**Cette branche, `local`, est la branche de l'IA.** C'est un instantané de
`gestion` à la fin de l'étape 10 du plan (`e4ba0c5`, 21 octobre 2026) qui
garde ce que `gestion` et `main` ont retiré à l'étape 11 (D100, D101) : le
backend Python, ses tests, la console `/admin/cron` et ses routes,
`npm run local` et `npm run backend`. Elle se lance sur le poste de l'admin ;
Vercel ne la construit pas.

- **Next.js 16** : site, API v1, back-office, inbox et console IA ; le site en
  ligne, lui, vient de `main`, sans la console.
- **Base Neon** partagée avec le site en ligne : un essai sur `main` se voit
  en production.
- **Le backend FastAPI (Python)** se lance à la main sur le poste
  (`npm run local`) ; **le lancer peut payer** (règle 7).
- **En ligne** : <https://app-vc-emn.vercel.app>, depuis `main`, sur les
  comptes de l'école (dépôt GitHub `emnormandie76/veille-concurenciel`, Vercel
  et Neon de l'école ; `Anton1P` ne fait que pousser : les commits sont signés
  au nom d'`emnormandie76` par le réglage Git local du dépôt).

## Documents de référence

[`docs/README.md`](docs/README.md) est l'index de la documentation de cette
branche.

| Document | Rôle |
|---|---|
| le plan, `docs/features/gestion-contenu.md` **de la branche `gestion`** | le chantier du gestionnaire de contenu : décisions (G1 à G9, D1 à D107, que le code cite), pièges, étapes, journal. Le lire sans changer de branche : `git show gestion:docs/features/gestion-contenu.md` |
| [docs/architecture/architecture.md](docs/architecture/architecture.md) | **la référence technique de l'IA** : pipeline Tavily + Gemini, Phases 1 et 2, crowdsourcing, sécurité (§10), outillage (§10 bis) |
| [docs/features/backend-local.md](docs/features/backend-local.md) | le dernier chantier IA, **gelé** le 16 octobre ; son journal (§11) tient l'historique |
| [docs/testing/manual_testing_cron.md](docs/testing/manual_testing_cron.md) · [pipeline_simulation.md](docs/testing/pipeline_simulation.md) | tester la console et le backend ; simuler sans crédit |
| [docs/tutoriel-demo.md](docs/tutoriel-demo.md) | préparer et dérouler une démonstration de l'IA |
| [docs/architecture/gestion-contenu.md](docs/architecture/gestion-contenu.md) | l'état du code du gestionnaire de contenu sur cette branche (celui de l'étape 10, console comprise) |
| [docs/architecture/charte-graphique.md](docs/architecture/charte-graphique.md) · [bdd.md](docs/architecture/bdd.md) · [API-rest.md](docs/architecture/API-rest.md) | la charte graphique · le schéma de la base · l'API v1 |
| [README.md](README.md) | démarrage (backend compris), variables, commandes, points de sécurité |
| [docs/edgecase.md](docs/edgecase.md) | cas limites et leurs parades, IA comprise |

La production (Vercel, variables, livrer une version) se décrit et se mène
depuis `gestion` : `git show gestion:docs/memory/memory-deploiement-vercel.md`.

## Cette branche

- **On ne fusionne jamais `gestion` dans `local`** : le retrait de l'étape 11
  s'y appliquerait. Un correctif s'y reporte par `cherry-pick`, et seulement
  à la demande du propriétaire.
- Rien n'y change sans demande (règle 10) ; l'étape 13 du plan (le nettoyage
  du contexte) n'y a touché que les documents.
- Elle sert à lancer l'IA sur le poste : `npm run local`, avec l'accord du
  propriétaire, après avoir regardé l'inbox et la branche Neon que vise le
  poste.

## Partie IA gelée

État au gel (16 octobre 2026), détail dans le journal de
[`backend-local.md`](docs/features/backend-local.md) (§11) :

- étapes 0 à 8 du plan backend-local faites et validées : backend local,
  `DB_DRIVER=neon-ws`, plus de cron, passes dues sur demande
  (`POST /internal/run-due-passes`), `/admin/cron` en trois états,
  `npm run local`, tests des parties non couvertes ;
- étape 9 (vérification de bout en bout) jouée et validée en l'état le
  15 octobre, **case non cochée** ; tâches C1 à C4 (crowdsourcing par la
  cascade Gemini) et « trois sources par ticket » poussées ; la recette de
  bout en bout est **abandonnée** par la réorientation ;
- les règles de dépense (règle 7) restent en vigueur : le code IA est là, et
  lancer le backend paie toujours.

## Règles pour tout agent

1. **Avant toute action**, lire le plan du chantier (sur `gestion`, ci-dessus :
   le mode d'emploi §0, les pièges §4, le journal §9) ; pour l'IA,
   [backend-local.md](docs/features/backend-local.md) (§11) et
   [architecture.md](docs/architecture/architecture.md). En fin de session,
   compléter le journal du plan, sur `gestion`.
2. **Une étape à la fois.** Ne pas commencer la suivante tant que les cases de
   l'étape ne sont pas cochées, que les tests ne sont pas verts **et** que le
   propriétaire n'a pas validé.
3. **Ce qui revient au propriétaire** : variables d'environnement, `DB_DRIVER`,
   variables Vercel, branche Neon, déploiement. S'arrêter, le guider pas à pas
   sans jamais lui demander de secret dans le chat, vérifier, puis consigner au
   journal.
4. **Ne pas s'écarter** du plan, de l'architecture ni du cahier des charges de
   sa propre initiative. En cas de doute ou de contradiction, exposer le
   problème avec deux options et une recommandation, puis consigner la
   décision au journal.
5. **Un test qui échoue** ne se désactive pas et ne s'affaiblit pas. Quand le
   propriétaire change une règle, l'attendu du test change avec elle, et le
   journal le dit.
6. **En fin d'étape** : `npm test` (les tests Python, sur cette branche),
   `npm run test:ts`, `npm run typecheck`, `npm run lint` ; mettre à jour les
   docs de contexte ; faire un compte rendu.
7. **Dépenses réelles.** Aucun appel payant (Tavily, Gemini, Gemma) sans accord
   explicite du propriétaire, et les tests ne touchent jamais le réseau.
   - Une passe réelle ne part que par `POST /internal/run-due-passes` avec
     `dry_run: false`, et seulement avec l'accord du propriétaire. La
     simulation (`dry_run: true`) ne paie rien.
   - Lancer le backend suffit pourtant à dépenser : le traitement des
     contributions part dès le démarrage et paie Tavily, Gemini (et Gemma en
     dernier recours) s'il trouve des tickets `Pending_AI`. Le démarrage écrit
     aussi dans la base (reprise et purge des jobs). Pas de `uvicorn`,
     `npm run backend` ni `npm run local` sans l'accord du propriétaire.
   - Rien de nouveau ne doit créer de ticket `Pending_AI` (plan, piège 6).
8. **Base de données.** Jamais `prisma db push`, `prisma migrate dev` ni
   `prisma migrate reset`. Jamais de modification d'un `migration.sql` déjà
   appliqué, même un commentaire : son empreinte change. Jamais
   `prisma db seed` sur la base partagée, dont la branche `main` est aussi la
   production Vercel. Une migration se fait sur `gestion`, jamais ici.
9. **Sécurité** (README) :
   - connexion obligatoire sur tout le site (`proxy.ts`), sauf la page de
     connexion, la première connexion (`/admin/first-login`,
     `POST /api/first-login`) et `/api/auth/*` ; le proxy ne regarde que la
     session, jamais le rôle ;
   - chaque route admin attend une seule garde de `lib/auth.ts` :
     `guardSignedIn`, `guardManager` ou `guardAdmin` ; l'IA (inbox et console
     comprises) et les comptes sont en `guardAdmin` ; le rôle est relu en base
     à chaque requête (D1) ;
   - tout contenu externe injecté dans un prompt passe par `wrap_source()`
     (`backend/ai/gemma_client.py`) ;
   - `user_text` n'atteint jamais un modèle d'IA ;
   - `lib/rate-limit.ts` est la seule limitation de débit.
10. **Partie IA gelée.** Ne modifier ni `backend/`, ni les routes et écrans IA,
    sauf ce qu'une étape du plan demande explicitement. Le backend partage la
    base : une colonne renommée ou rendue obligatoire le casse, et ses tests
    Python ne le disent que si on les lance ; toute colonne ajoutée à
    `PipelineJob` ou `ContributionInbox` accepte le vide.

## Modèle

Tout le projet se fait avec **Opus 5.5 en effort extra high** (D17) ; l'étape
13 du plan, en effort maximal (D103). Si la session tourne sur un autre modèle
ou un autre niveau d'effort, le signaler à l'utilisateur en début de session.

## Conventions

- Échanges et documentation en français.
- Code en anglais (variables, fonctions, fichiers) ; commentaires et docstrings
  en français, comme dans le code existant. Messages de commit en français, au
  format du dépôt : `feat(auth): …`, `fix(admin): …`.
- Textes de l'interface en français, avec vouvoiement.
- Le poste est sous Windows (Git Bash et PowerShell). L'interpréteur du
  backend est `backend/.venv/Scripts/python`, et les scripts doivent tourner
  sous Windows.
- **Secrets** : `.env.local`, `.env.development.local` et `backend/.env`
  appartiennent au propriétaire. Ne jamais les lire, les afficher, les modifier
  ni les committer. La liste des variables est dans `.env.example`.
- **Branches.** Pas de commit ni de push sans demande explicite. Le dépôt ne
  garde que trois branches, sur le poste comme sur `origin` (D102) : `main`
  (la production), `gestion` (le travail) et `local` (cette branche). Le
  remote `anton1p` (`Anton1P/veille-concurenciel`) est une sauvegarde figée :
  aucune commande vers lui ; `git fetch origin`, jamais `git fetch --all`.
  Pousser : `git -c credential.username=Anton1P push origin local`.
- Next.js 16 : lire `node_modules/next/dist/docs/` avant de toucher au front.
  `proxy.ts` tient lieu de middleware.
- Styles : la charte graphique
  ([`docs/architecture/charte-graphique.md`](docs/architecture/charte-graphique.md)),
  seule ; ni autre feuille de style, ni `style` en ligne, ni couleur
  littérale, ni émoji.

## Réseau du poste

Le réseau de l'établissement ne laisse sortir que les ports 80 et 443. Le port
5432 de Neon est fermé.

| Qui se connecte à Neon | État |
|---|---|
| Next.js (Prisma + `@neondatabase/serverless`, `lib/prisma.ts`) | marche, en WebSocket sur 443, sans lire `DB_DRIVER` |
| Migrations | CLI Prisma bloquée (5432). Avec `DB_DRIVER=neon-ws` dans `.env.development.local`, `npm run db:status` et `npm run db:migrate` passent en WebSocket (`scripts/db-migrate.ts`) |
| Backend Python (psycopg2) | avec `DB_DRIVER=neon-ws` dans `backend/.env`, passe par le pont local `backend/neon_ws_bridge.py` (`127.0.0.1` → `wss://<hôte>/v2`). Sans la variable : 5432, donc bloqué |

## MCP Neon

Autorisé, sur le **projet de l'application uniquement** : projet `vc-bdd`, id
`noisy-credit-34683167`, organisation `org-long-unit-38729916` (« Vercel:
EM-Normandie ») ; branche `main` (`br-late-water-za82d15h`, endpoint
`ep-super-rain-zas6jyy2`), qui est aussi la **production Vercel** ; branche
`dev` (`br-odd-cloud-zao7fqra`, endpoint `ep-proud-lab-za705j3u`), essais et
**cible par défaut des lectures**. Le poste vise `dev` ; bascule :
[`docs/testing/manual_testing_cron.md`](docs/testing/manual_testing_cron.md)
§1.3. Passer `project_id` **et** `branch_id` à chaque appel ; aucun appel aux
autres projets (`neon-bisque-pillar`, et tout projet d'un autre compte).
L'ancienne base (`lucky-cell-29057691`) est une sauvegarde figée.

| | Outils |
|---|---|
| **Permis sans demander** (lectures) | `run_sql` limité à des `SELECT` ; `get_database_tables`, `describe_table_schema`, `describe_project`, `list_branches`, `list_postgres_endpoints` |
| **Avec l'accord du propriétaire, à chaque fois** | toute écriture ; tout `delete_*` ; `create_branch`, `reset_from_parent`, `restore_snapshot` ; tout changement de réglage |
| **Jamais** | `get_connection_string`, `create_credential`, `rotate_credential`, `revoke_credential`, `reset_postgres_role_password` : ils rendent ou changent des secrets |

## MCP Vercel et GitHub

Comme sur `gestion` (son `CLAUDE.md`) : le projet Vercel `app-vc`
(`prj_x0D6x90ihnJnc86piYtt9fJXfNLM`, équipe `em-normandie1`) se lit sans
demander, ne s'écrit qu'avec l'accord du propriétaire, et ses variables ne
s'écrivent ni ne se lisent jamais ; le MCP GitHub (jeton d'`emnormandie76`,
limité au dépôt) lit la CI ; relancer un run demande l'accord du propriétaire.
Vercel ne construit pas cette branche.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run local` | le backend FastAPI dans sa propre fenêtre, puis Next.js (`scripts/start-local.ps1`). **Lance le backend : accord du propriétaire requis (règle 7)** |
| `npm run backend` | le backend seul (`uvicorn` sur `127.0.0.1:8000`, sans `--reload`, jamais `--host 0.0.0.0`). **Accord du propriétaire requis** |
| `npm run dev` | Next.js sur http://localhost:3000, sans le backend |
| `npm test` | les tests Python (pytest), avec le `python` du `PATH`, et non `backend/.venv` |
| `npm run test:ts` | les tests TypeScript (`node --test`) ; en CI, job `ts-tests` |
| `npm run typecheck` / `npm run lint` | types / ESLint (les avertissements sont la dette connue) |
| `npm run db:status` | état des migrations, en lecture seule |
| `npm run smoke` | smoke local contre `npm run dev`, lecture seule ; lit la base visée : **accord du propriétaire requis** |

@AGENTS.md
