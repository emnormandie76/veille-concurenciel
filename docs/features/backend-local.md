# Feature — Backend local sur demande : fin de l'hébergement du backend

> **🧊 Gelé le 16 octobre 2026.** Le projet se réoriente vers la gestion de
> contenu (réunion de l'équipe du 16 octobre) : la recherche IA est gardée
> telle quelle, réservée à l'admin, sans nouveau développement ni recette. La
> recette de bout en bout qui devait cocher l'étape 9 est **abandonnée** ; la
> case reste non cochée. Plan en cours : `docs/features/gestion-contenu.md`,
> sur la branche `gestion`. Ce document reste la référence sur l'état de la
> partie IA, et son journal (§11) son historique.
>
> **Il vit sur la branche `local`** (étape 11 du plan du gestionnaire,
> 21 octobre 2026). Les branches qu'il nomme (`localpython`, `newresearch`,
> `devresearch`) n'existent plus (22 octobre, D102), et la base qu'il décrit
> (`lucky-cell-29057691`) a été remplacée le 19 octobre par celle du compte
> de l'école (`noisy-credit-34683167`) ; la bascule du poste :
> [`manual_testing_cron.md`](../testing/manual_testing_cron.md) §1.3.
>
> **Statut au gel :** plan rédigé et validé par le propriétaire le 14 octobre 2026.
> Étapes 0 et 1 terminées le même jour : décisions D1 à D7 tranchées (§2.2),
> tests TypeScript en CI. Étape 2 (`DB_DRIVER=neon-ws`) faite, vérifiée sur
> la base et validée par le propriétaire le 14 octobre (commit `02da0d7`, CI
> verte). Étape 3 (plus de cron, passes dues sur demande, démarrage qui ne
> ment plus) faite et validée par le propriétaire le 14 octobre (commit
> `6f82c2e`, CI verte). Étape 4 (une Phase 2 qui dit la vérité) faite le
> 14 octobre (commit `df8730e`, CI verte) ; le propriétaire a confié l'étape 5.
> Étape 5 (un site en ligne sans backend) faite, vérifiée dans Chromium contre
> un faux backend et validée par le propriétaire le 14 octobre (commit
> `16ee824`, CI verte). Étape 6 (le lanceur local : `npm run local`,
> `npm run backend`) codée et testée le 14 octobre sur le poste, puis jouée pour
> de vrai avec l'accord du propriétaire, `/admin/cron` suivi dans Chromium, et
> validée par le propriétaire le 14 octobre. Étape 7 (tests des parties non
> couvertes) codée les 14 et 15 octobre : P0, P1 et P2 verts, F2 et F6
> corrigés, quatorze décisions du propriétaire sur les défauts révélés
> (journal), suites vertes aussi sous garde réseau ; smoke écrit, pas encore
> joué contre `npm run dev`. Le 15 octobre, le propriétaire demande le commit,
> le push et le prompt de l'étape 8 : étape 7 tenue pour validée. Étape 8
> (préparer Vercel) faite le 15 octobre : variables inventoriées, build vérifié
> sans base, smoke joué contre `npm run dev` (vert après correction d'une règle,
> sur décision du propriétaire), mémo de déploiement réécrit. Hors plan, à sa
> demande : `/api-docs` aligné sur les réponses réelles, titre des fiches
> corrigé. Le 15 octobre, le propriétaire demande le commit, le push et le
> prompt de l'étape 9 : étape 8 tenue pour validée. Le projet Vercel reste à
> créer par lui (mémo §8 et §9). Étape 9 (vérification de bout en bout) jouée
> le 15 octobre avec le propriétaire, sur la branche Neon `dev` créée ce
> jour-là : points 1 à 4 verts, passe due réelle réussie (ESSCA, Phase 1) ;
> la contribution de test a révélé trois défauts du crowdsourcing (C1 à C3,
> journal), à corriger après l'étape 9, puis contribution à rejouer. Case non
> cochée. Étape 9 validée en l'état par le propriétaire le 15 octobre. Hors
> plan, le même jour : C1 à C4 codés et poussés (`12b6bb3`), puis la tâche
> « trois sources » (au plus trois liens dans le bloc « Sources » d'un ticket
> du pipeline) codée, testée et validée (commit et push demandés). Prochaine : la
> recette de bout en bout sur `dev`, qui cochera la case de l'étape 9.
> **Branche de travail :** `localpython`, créée le 14 octobre 2026 depuis
> `newresearch` (`295044e`) à la demande du propriétaire.
> **Lire avant de coder :** ce document en entier, puis
> [`architecture.md`](../architecture/architecture.md) §2.3, §3.5 bis, §5.3, §5.5,
> §10.8 et §10 bis, et `AGENTS.md` à la racine (Next.js 16 : lire
> `node_modules/next/dist/docs/` avant de toucher au front).

---

## 0. Mode d'emploi pour un agent

- Les étapes se font **dans l'ordre**. L'étape 0 est une **porte** : si elle
  échoue, on s'arrête et on demande au propriétaire.
- **Une étape par session, puis arrêt.** À la fin d'une étape :
  1. faire le compte rendu au propriétaire : ce qui est fait, les tests, les
     écarts au plan, ce qui attend sa décision ;
  2. compléter le journal ;
  3. **attendre sa validation explicite**. Ne jamais enchaîner sur l'étape
     suivante, même si elle paraît simple, ni même si la consigne de départ
     disait « fais tout le plan ».

  Pour savoir où reprendre, lire le journal (§11) et les cases cochées.
- Une case ne se coche `[x]` que lorsque le code est écrit **et** que ses tests
  passent (`npm test`, `npm run test:ts`, `npm run typecheck`, `npm run lint`).
- **Tests d'abord pour les défauts listés au §5** : écrire le test qui montre
  le défaut, le voir échouer, puis corriger.
- **Documentation au fil de l'eau.** Chaque étape liste les docs à mettre à
  jour. On les met à jour à la fin de l'étape, pas avant, et seulement
  pour décrire ce que le code fait réellement. Le §10 récapitule ces mises à jour.
- À la fin de chaque session, ajouter une ligne au
  [journal](#11-journal-de-progression) : fait, reste, surprises, écarts au plan
  et leur raison.
- Ne commiter que si le propriétaire le demande. Dans ce cas, un commit par étape,
  message en français au format du dépôt (`feat(backend): …`).

**Interdits — sans exception :**

- Lire, afficher, journaliser ou commiter le contenu d'un fichier `.env*`
  (seul `.env.example` est lisible). Ne jamais afficher une URL de connexion ni
  un mot de passe, y compris dans un message d'erreur ou un test.
- `prisma db push`, `prisma migrate dev`, `prisma migrate reset`. Aucune
  migration n'est prévue par ce plan : si une étape semble en exiger une,
  s'arrêter et demander.
- **Modifier un `migration.sql` déjà appliqué**, même un commentaire (celui de
  `20260902100000_pipeline_job_state` cite Koyeb : on le laisse). Prisma compare
  une empreinte du fichier et croirait la migration modifiée.
- Lancer une recherche qui paie (Tavily Research, `/extract`, `/map`, appel
  Gemini ou Gemma réel) sans l'accord explicite du propriétaire. Les tests ne
  touchent jamais le réseau : un test qui paie est un bug.
- Lancer `prisma db seed` contre la base partagée.
- Poser `DB_DRIVER` sur Vercel.

**MCP Neon** (branché le 14 octobre 2026, **en mode écriture**, outils
destructifs exposés) :

- **Le projet de l'application** (relevé le 14 octobre 2026) :
  - projet `vc-bdd`, id `lucky-cell-29057691`, région `aws-eu-west-2`,
    PostgreSQL 17 ;
  - organisation « Vercel: anton1p's projects » (`org-lively-cell-45152555`),
    **gérée par Vercel**, en offre gratuite ;
  - une seule branche, `main` (`br-bitter-cloud-ab3c0wop`), marquée **branche
    de production Vercel** ;
  - endpoint `ep-twilight-forest-ab9qjkm7` ;
  - depuis le 15 octobre 2026 (étape 9, D7) : branche `dev`
    (`br-rapid-bird-abck4fdr`, endpoint `ep-falling-breeze-abibnpc4`), créée
    depuis `main` ; le poste la vise pour les essais.

  Passer `project_id` **et** `branch_id` explicitement à chaque appel.
- **Les autres projets ne nous concernent pas.** C'est le cas de
  `neon-cyclamen-river` (même organisation) et de tout projet d'un autre
  compte : une autre application en production y a été vue. **N'y faire aucun
  appel.**
- La branche `main` est à la fois la base de développement partagée et la
  future production : **lectures seulement** :
  `run_sql` limité à des `SELECT`, `get_database_tables`,
  `describe_table_schema`, `describe_project`. Toute écriture passe par le code
  de ce plan, jamais par le MCP.
- **Jamais sans l'accord explicite du propriétaire** :
  - les outils `delete_*`, `reset_from_parent`, `restore_snapshot` et
    `complete_database_migration` ;
  - un `run_sql` ou un `run_sql_transaction` qui écrit ;
  - `create_branch`, sauf à l'étape 10.
- **Jamais** : `get_connection_string`, `create_credential`,
  `rotate_credential`, `revoke_credential`, `reset_postgres_role_password`. Ils
  rendent ou changent des secrets.
- Le MCP passe par l'API de Neon, en HTTPS. Il sert à l'agent ; il ne remplace
  **pas** la connexion du backend Python (§4).
- Usages prévus :
  - relire `_prisma_migrations` (étape 2.2, en plus de `npm run db:status`) ;
  - compter les `PipelineJob` avant et après la simulation (étape 9) ;
  - créer puis supprimer la branche jetable (étape 10).

---

## 1. Pourquoi

Le backend FastAPI devait tourner sur Koyeb, en offre gratuite. Koyeb a fermé
son offre gratuite aux nouveaux comptes le 26 février 2026, après l'annonce de
son rachat par Mistral AI. Il faut maintenant souscrire l'offre Pro : 29 $/mois
plus la consommation. Aucun autre hébergeur gratuit et réputé ne fait
tourner un processus Python 24 h sur 24 sans contrepartie :

| Hébergeur | Pourquoi il ne convient pas |
|---|---|
| Render (gratuit) | s'endort après 15 min sans trafic : tue APScheduler et les passes longues |
| Oracle Always Free | récupère une instance restée sous 20 % de CPU, de réseau et de mémoire pendant 7 jours, ce qui est le profil exact de ce backend |
| Google Cloud e2-micro | carte bancaire, région américaine, adresse IPv4 publique payante, machine à administrer |
| Fly.io, Railway | périodes d'essai seulement |

Or le backend n'a pas besoin de tourner en permanence. La cadence voulue est
d'environ 30 écoles, avec deux passages par an pour chaque école. Cela fait
environ 10 passes par mois, pour 10 à 20 validations mensuelles. La base est
partagée : un backend lancé sur le poste de l'admin écrit ses tickets dans Neon,
et le site en ligne les affiche.

---

## 2. Décisions

### 2.1. Décisions du propriétaire (14 octobre 2026)

- **Koyeb abandonné. Le backend Python n'est plus hébergé nulle part** : l'admin le
  lance à la main, sur son poste, quand il veut chercher ou traiter les
  contributions.
- **Next.js reste en ligne sur Vercel, en offre Hobby gratuite.** Des personnes
  extérieures doivent y accéder : site public, formulaire de contribution,
  API v1 et back-office.
- **Neon reste la base partagée.**
- **Réseau de l'établissement** : seuls les ports 80 et 443 sortent. En local, la
  connexion à Neon passe par le proxy WebSocket de Neon (443). Le choix du pilote
  se fait par une variable locale, `DB_DRIVER=neon-ws`, jamais posée en production.
- **Tests sur toutes les parties qui n'en ont pas**, en priorité celles qui
  échouent sans le dire.
- Les docs de contexte sont mises à jour au fur et à mesure des étapes.

### 2.2. Décisions à valider avant l'étape 1

**Tranchées par le propriétaire le 14 octobre 2026 : les sept recommandations
sont retenues telles quelles.**

| # | Question | Recommandation (retenue) |
|---|---|---|
| D1 | Pont WebSocket du backend : dans le processus Python, ou script Node séparé ? | **Python, dans le processus** (`backend/neon_ws_bridge.py`) : `uvicorn` suffit, pas de pont à oublier de lancer, et les scripts `backend/scripts/` en profitent sans rien faire |
| D2 | Une passe de Phase 2 dont une ou plusieurs cibles ont échoué (hors quota) : `completed` ou `failed` ? | **`failed` dès qu'une cible a échoué en recherche ou en extraction**, avec la liste des cibles. L'école repasse 14 jours plus tard au lieu de 182. Le coût d'une nouvelle passe complète est borné par le plafond, et la garde « en attente » évite de repayer ce qui a été déposé |
| D3 | Ranger les rapports Research de Phase 2 quand leur extraction échoue, comme en Phase 1 ? | **Hors de ce plan.** À reprendre ensuite : ce chantier change la forme des tickets |
| D4 | Dossier des tests : `test/` (existant) ou un nouveau `tests/` ? | **`test/`** : il est déjà branché sur `pytest.ini`, `npm run test:ts` et la CI. Les tests de routes vont dans `test/api/` |
| D5 | Retirer du backend `ENVIRONMENT`, le masquage de `/docs` et la branche « production » de CORS ? | **Oui** : le backend n'écoute plus que sur `127.0.0.1` et n'a plus de production |
| D6 | Suite d'intégration sur une branche Neon jetable (étape 10) ? | **Plus tard, facultative.** Elle exige une clé d'API Neon, ou le MCP Neon |
| D7 | La seule branche Neon, `main`, est à la fois la base de développement et la future production Vercel. Faut-il créer une branche `dev` pour le travail local et les vérifications ? | **Oui, avant l'étape 9.** Sinon, la simulation, la contribution de test et la passe réelle de l'étape 9 écrivent dans la base que verront les visiteurs |

---

## 3. L'architecture, avant et après

### 3.1. Avant (prévu, jamais déployé)

```
Vercel : Next.js ──(HTTPS + INTERNAL_API_TOKEN)──► Koyeb : FastAPI 24 h/24
   │                                                 ├─ cron research_rotation, 03:00
   │                                                 └─ crowdsourcing, chaque minute
   └──────────────── Neon (WebSocket 443) ◄──────────┘ (psycopg2, 5432)
```

### 3.2. Après

```
           EN LIGNE (gratuit)                          POSTE DE L'ADMIN (lancé à la main)
┌──────────────────────────────────────┐    ┌──────────────────────────────────────────────┐
│ Vercel Hobby — Next.js               │    │ npm run local                                │
│  • site public, /contribute, API v1  │    │  • Next.js dev (localhost:3000) : back-office│
│  • back-office : inbox, écoles,      │    │    complet, /admin/cron pilote le backend    │
│    gestion, comptes                  │    │  • FastAPI 127.0.0.1:8000                    │
│  • /admin/cron : historique des      │    │     ├─ « passes dues » sur demande (bouton)  │
│    passes et contributions en        │    │     ├─ recherches ciblées                    │
│    attente, en LECTURE (base seule)  │    │     └─ crowdsourcing, chaque minute tant     │
│  • FASTAPI_URL absente               │    │        que le backend tourne                 │
└───────────────┬──────────────────────┘    │  • DB_DRIVER=neon-ws : psycopg2 → pont local │
                │ WebSocket 443             │    → wss://<hôte neon>/v2                    │
                ▼                           └───────────────┬──────────────────────────────┘
        ┌────────────────────┐                             │ WebSocket 443
        │  Neon PostgreSQL   │◄────────────────────────────┘
        └────────────────────┘
```

### 3.3. Ce qui bouge, composant par composant

| Composant | Aujourd'hui | Après |
|---|---|---|
| Hébergement du backend | Koyeb (prévu) | aucun ; `uvicorn` sur `127.0.0.1` |
| Cron `research_rotation` (03:00) | inscrit en production | **supprimé** ; remplacé par `POST /internal/run-due-passes`, que lance un bouton de `/admin/cron` |
| Planificateur `plan_rotation`, plafond, garde « en attente » | utilisés par le cron | **conservés tels quels**, appelés à la demande |
| Crowdsourcing | toutes les minutes, 24 h/24 | toutes les minutes **tant que le backend tourne**, première passe au démarrage ; les contributions attendent en `Pending_AI` entre deux lancements |
| Compteurs de crédits Tavily | en mémoire, recalés par `/usage` en arrière-plan | idem, mais une passe due **ne part pas** tant que la synchro `/usage` n'a pas réussi : chaque lancement repart de zéro |
| Connexion Python → Neon | psycopg2 en 5432 | psycopg2 en 5432 **ou**, si `DB_DRIVER=neon-ws`, à travers un pont WebSocket local |
| Connexion Next.js → Neon | Prisma + `@neondatabase/serverless` en WebSocket | **inchangée** (déjà en 443, partout) |
| Migrations Prisma | `prisma migrate deploy` (5432) | `npm run db:migrate` : CLI Prisma sans `DB_DRIVER`, script WebSocket avec `DB_DRIVER=neon-ws` |
| `/admin/cron` en ligne | 503 « Cold Start » au bout de 4 s | message immédiat « pilotage depuis le poste local » + historique lu en base |
| `ENVIRONMENT`, `ALLOWED_ORIGINS`, masquage de `/docs` | pilotent la production du backend | supprimés (D5) |
| Variables `CRON_RESEARCH_ENABLED`, `CRON_RESEARCH_HOUR`, `CRON_ROTATION_PASSES_PER_NIGHT` | cron | **supprimées** |
| Variables `CRON_MONTHLY_CREDIT_CEILING`, `CRON_RESEARCH_INTERVAL_DAYS`, `CRON_RESEARCH_RETRY_FAILED_DAYS`, `PIPELINE_JOB_ROTATION_RETENTION_DAYS` | cron | **conservées sous le même nom**. Le préfixe `CRON_` devient historique : on évite un renommage sans gain |

---

## 4. Le réseau de l'établissement

**Constats du 14 octobre 2026, depuis le poste :**

| Hôte Neon | Port 5432 | Port 443 |
|---|---|---|
| `…-pooler.eu-west-2.aws.neon.tech` | fermé (même en TCP) | ouvert |
| hôte direct | fermé | ouvert |

`psycopg2` a échoué deux fois sur 60 s. Le 28 septembre, il passait
parfois : le blocage est donc intermittent et, aujourd'hui, total.

**Ce qui marche déjà en 443 :** `lib/prisma.ts` crée toujours Prisma avec
`PrismaNeon` (WebSocket, `ws`), en local comme en production. Le seed et
`scripts/dump-program-identity.ts` passent par `lib/prisma.ts`. **On ne rend pas
`lib/prisma.ts` conditionnel** : le pilote WebSocket y est le pilote normal.

**Ce qui ne marche pas :**

1. **La CLI Prisma** (`migrate status`, `migrate deploy`) se connecte en 5432.
   Vérifié dans `node_modules/@prisma/config/dist/index.d.ts` (Prisma 7.10) :
   la configuration n'offre **aucun adaptateur** pour Migrate. Il faut donc un
   script qui applique les migrations à travers `@neondatabase/serverless`
   (étape 2.2).
2. **Le backend Python**, c'est-à-dire la partie qu'on veut faire tourner en local. Le pilote
   `@neondatabase/serverless` n'existe qu'en JavaScript. Le proxy WebSocket de
   Neon transporte le protocole PostgreSQL brut dans du `wss://` : un pont local
   TCP ↔ WebSocket permet à psycopg2 de l'utiliser **sans rien changer au code
   SQL**. Ce n'est pas un usage documenté par Neon : l'étape 0 le valide avant
   tout le reste.

On écarte l'API HTTP de Neon (`/sql`), qui ne gère pas les transactions
interactives : le backend en a besoin (ticket et suppression du rapport rangé
dans une même transaction, §5.1 d'`architecture.md`).

---

## 5. Défauts qui échouent sans le dire

Relevés sur le code le 14 octobre 2026. Chaque défaut se corrige **à l'étape
indiquée**, test d'abord.

| # | Où | Ce qui se passe | Étape |
|---|---|---|---|
| F1 | `backend/pipeline/phase2_research.py:348` et `:693` | Un appel Research ou une extraction qui échoue rend `None` et la boucle continue. En fin de passe, le résultat vaut **toujours** `success: True`. Une Phase 2 dont toutes les cibles ont échoué (Gemini saturé, panne Tavily hors quota) finit `completed`, et l'école n'est **pas reprise avant 182 jours**. Les rapports Research payés sont perdus | 4 |
| F2 | `app/api/admin/inbox/[id]/validate/route.ts:240-250`, `attachments/route.ts:97-107` | Un corps JSON **mal formé** est avalé par `catch {}` et la route écrit le JSON **brut de l'IA** à la place des corrections de l'admin, avec une réponse 200 | 7 |
| F3 | `backend/main.py:70-92` | Échec de la reprise des jobs, du `TavilyKeyManager` ou du scheduler : simple avertissement, puis « ✅ Backend prêt ». `/health` répond `ok` | 3 |
| F4 | `backend/crowdsourcing/processor.py:772-774`, `backend/scheduler/jobs.py:412-418` | Base injoignable : le traitement fait `return` chaque minute. Le job n'est pas suivi par `_record_job_run` : rien dans `pipeline-status`, rien à l'écran | 3 |
| F5 | `app/api/admin/pipeline-status/route.ts`, `trigger-research/route.ts` | Jeton absent : `Authorization: Bearer null`, et un 401 présenté comme une « erreur du backend ». `FASTAPI_URL` absente : repli silencieux sur `localhost:8000`, donc 4 s d'attente puis « Cold Start » sur Vercel | 5 |
| F6 | `app/page.tsx:70` et `:94`, `app/admin/inbox/page.tsx:542` | L'accueil affiche « aucune école » quand l'API échoue (`setSchools([])`, `.catch(() => {})`). L'inbox ignore une erreur (`/* silently ignore */`) | 7 |
| F7 | `.github/workflows/ci.yml` | Les tests TypeScript (`npm run test:ts`) ne tournent **nulle part** en CI | 1 |
| F8 | `backend/tavily_service/key_manager.py:118-176` | Les compteurs de crédits repartent de zéro à chaque démarrage. Si la synchro `/usage` d'arrière-plan échoue, le plafond mensuel croit le mois vierge. En local, chaque lancement est un démarrage | 3 |
| F9 | `backend/scheduler/jobs.py:57` | `CRON_CROWDSOURCING_INTERVAL_MINUTES` est lue par `int()` : une valeur illisible empêche le scheduler entier de démarrer, et F3 masque l'échec | 3 |

---

## 6. Étapes

### Étape 0 — Prérequis et sonde du pont (porte)

- [x] Arbre git propre ; branche de travail confirmée par le propriétaire
  (`localpython`).
- [x] Relever au journal le nombre de tests au départ (`npm test`,
  `npm run test:ts`), et l'état de `npm run typecheck` et `npm run lint`.
  Relevé du 14 octobre : 291 tests Python, 43 tests TypeScript (voir le journal).
- [x] Décisions D1 à D7 tranchées par le propriétaire (§2.2), reportées au journal.
- [x] **Sonde du pont, hors du dépôt** — **faite le 14 octobre 2026, réussie**
  sur l'hôte poolé et sur l'hôte direct (voir le journal). La refaire seulement
  si le réseau ou la configuration Neon change. Un script Python, lancé avec
  l'interpréteur de `backend/.venv` :
  1. démarre un serveur TCP sur `127.0.0.1` (port libre), qui, pour chaque
     connexion, ouvre `wss://<hôte neon>/v2` avec `websockets` et recopie les
     octets dans les deux sens ;
  2. lit `DATABASE_URL` dans `backend/.env` **sans jamais l'afficher**, puis
     connecte psycopg2 au pont : `host=127.0.0.1`, le port du pont,
     `sslmode=disable` (le chiffrement est assuré par `wss`), même utilisateur,
     mot de passe et base ;
  3. vérifie, sur l'hôte poolé **et** sur l'hôte direct : `SELECT 1` ;
     `BEGIN` / `SELECT` / `ROLLBACK` ; 5 connexions simultanées (c'est le
     `maxconn` du pool).

  Si Neon répond qu'il ne sait pas identifier l'endpoint, réessayer en ajoutant
  `options=endpoint=<id de l'endpoint>`. L'id est le premier segment de
  l'hôte, sans `-pooler`.

**Porte :** si la sonde échoue, **s'arrêter**, consigner l'erreur exacte (sans
secret) au journal et prévenir le propriétaire. Les replis possibles sont des
décisions qui lui reviennent : lancer le backend depuis un réseau où le 5432
sort, ou prendre un hébergement payant.

- [x] Étape 0 terminée

### Étape 1 — Filet de tests et CI

**Objectif :** pouvoir tester les routes Next.js, et faire tourner les tests
TypeScript en CI (F7).

- `package.json` :
  - `test:ts` → `node --import tsx --experimental-test-module-mocks --test "test/**/*.test.ts"`.
    Vérifier dans la documentation de Node 24 si le drapeau est encore requis
    pour `mock.module`. Les fichiers existants (`test/*.test.ts`) doivent
    toujours être trouvés.
- `test/helpers/fake-prisma.ts` : un faux client Prisma minimal. Chaque test ne
  déclare que les méthodes dont il a besoin, et les appels sont enregistrés.
  `$transaction(fn)` appelle `fn` avec le même faux ; une exception lancée dans
  `fn` doit remonter.
- `test/helpers/session.ts` : simule `guardAuth` / `guardAdmin` par
  `mock.module("@/lib/auth", …)`, avec trois profils : aucune session,
  MODERATOR et ADMIN.
- Une route se teste en important son handler et en l'appelant avec
  `new Request(…)` et `{ params: Promise.resolve({ id }) }`. Vérifier la
  signature des paramètres dynamiques dans les docs de Next 16. **Si
  `mock.module` n'est pas utilisable**, extraire la logique de la route dans
  `lib/` sous forme de fonctions qui reçoivent un client typé, comme le fait déjà
  `lib/campus-attachment.ts` avec `AttachmentTx`, et tester ces fonctions.
- `.github/workflows/ci.yml` :
  - nouveau job `ts-tests` : Node 24, `npm ci`, `npx prisma generate`,
    `npm run test:ts` ;
  - aligner le job `validate` sur Node 24, la version du poste (`v24.21.0`).
  - Le job `python-tests` reste en Python 3.12 alors que le poste est en 3.14 :
    le code doit rester compatible 3.12.

**Tests :**
- [x] `test/api/admin-guards.test.ts` (statique, sans mock) : chaque handler
  exporté (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) de
  `app/api/admin/**/route.ts` appelle `guardAuth` ou `guardAdmin` ; aucun fichier
  n'importe `getServerSession`. Chaque route de la liste ADMIN
  d'`architecture.md` §3.6 utilise `guardAdmin`. Le test énumère les fichiers :
  une nouvelle route est couverte d'office.
- [x] Le banc fonctionne : `GET /api/admin/inbox/[id]` sans session → 401, sans
  appel au faux Prisma.
- [x] La CI exécute `npm run test:ts` (vérifier sur un push de la branche).

**Docs :** `architecture.md` §10 bis (*Tests*, *Intégration continue*) ;
README, section « Tests et qualité » : elle annonce « 11 tests Python ».

- [x] Étape 1 terminée

### Étape 2 — Réseau : `DB_DRIVER=neon-ws`

**Objectif :** tout ce qui se connecte à Neon fonctionne depuis le réseau de
l'établissement, sans rien changer quand la variable est absente.

**Où vit la variable** (fichiers ignorés par git, propres au poste) :
- côté Node : `.env.development.local`, couvert par `.env.*.local` dans
  `.gitignore` ;
- côté Python : `backend/.env`.

C'est **le propriétaire** qui pose la variable. L'agent ne lit ni n'écrit ces fichiers.

#### 2.1. Backend Python

- Ce qui a marché lors de la sonde du 14 octobre, à reprendre tel quel :
  - `from websockets.asyncio.client import connect` (`websockets` 16) ;
  - `connect(f"wss://{host}/v2", max_size=None, compression=None,
    open_timeout=20)` ;
  - les octets TCP envoyés tels quels en trames binaires, et chaque message reçu
    réécrit sur la socket ;
  - côté psycopg2 : `sslmode=disable`, **sans** `channel_binding` ; l'option
    `options=endpoint=…` n'a pas été nécessaire.
- Nouveau `backend/neon_ws_bridge.py` (D1) :
  - `start_bridge(neon_host: str) -> int` démarre, une seule fois par processus,
    une boucle asyncio dans un thread démon. Elle écoute sur **`127.0.0.1`
    uniquement** (port libre, ou `NEON_WS_BRIDGE_PORT` si définie) et rend le
    port. Pour chaque connexion, elle ouvre `wss://{neon_host}/v2`
    (`websockets`) et recopie les octets dans les deux sens. La fermeture d'un
    côté ferme l'autre ;
  - les erreurs de connexion sont journalisées en `WARNING` avec l'hôte, jamais
    avec l'URL complète.
- `backend/db.py` : une fonction pure `build_dsn(database_url, driver)`, appelée
  par `get_pool()` :
  - `DB_DRIVER` absente → `DATABASE_URL` inchangée, et `neon_ws_bridge`
    **n'est pas importé** ;
  - `neon-ws` → DSN réécrit : hôte `127.0.0.1`, port du pont, `sslmode=disable`,
    sans `channel_binding`, avec les mêmes utilisateur, mot de passe (encodage
    `%XX` préservé), base et autres paramètres ;
  - toute autre valeur → `RuntimeError` explicite, **pas de repli silencieux**.
  - Le message d'échec de connexion du pool cite le pilote utilisé, jamais le DSN.
- `backend/requirements.txt` : déclarer `websockets==16.0`. Il est aujourd'hui
  tiré seulement par `uvicorn[standard]`. `npm test` lance le `python` du
  `PATH`, pas `backend/.venv` (décision du 14 octobre, journal) : vérifier que
  les deux interpréteurs ont `websockets` 16.0.

**Tests** — nouveau `test/test_db_driver.py`, sans réseau :
- [x] `build_dsn` sans pilote : chaîne identique ; avec `neon-ws` : hôte, port,
  `sslmode` réécrits, mot de passe à caractères spéciaux intact, `channel_binding`
  retiré ;
- [x] valeur inconnue → `RuntimeError` dont le message ne contient pas le mot
  de passe ;
- [x] sans pilote, `backend.neon_ws_bridge` absent de `sys.modules` après
  `get_pool()` (pool simulé) ;
- [x] le pont recopie les octets dans les deux sens, et la fermeture d'un côté
  ferme l'autre. Utiliser un faux serveur WebSocket d'écho sur `127.0.0.1`, et
  rendre l'URL cible injectable pour le test ;
- [x] le pont n'écoute que sur `127.0.0.1`.

#### 2.2. Migrations

- Module pur `scripts/lib/migration-plan.ts` :
  `planMigrations(folders, rows) -> { applied, pending, checksumMismatch, failed, unknownInDb }`.
  - `folders` : nom et octets de chaque `prisma/migrations/*/migration.sql` ;
  - `rows` : lignes de `_prisma_migrations` ;
  - l'empreinte attendue est le **sha256 hexadécimal des octets du fichier**.
    L'historique de la base mélange fins de ligne LF et CRLF, et Prisma accepte
    les deux. Git peut extraire le fichier en CRLF sous Windows. Une ligne est donc
    `applied` si son empreinte correspond aux octets **tels quels, en LF ou en
    CRLF**. Constat du 14 octobre 2026 :
    - les 10 empreintes en base correspondent toutes à l'une de ces trois formes ;
    - trois migrations (`20260521170000`, `20260701100000`, `20260901120000`)
      ne correspondent **qu'en LF**, alors que le fichier du poste est en CRLF.
      Une comparaison des seuls octets bruts les signalerait à tort ;
  - `failed` : `finished_at` nul et `rolled_back_at` nul.
- `scripts/db-migrate.ts`, avec les commandes `status`, `deploy` et
  `deploy --dry-run` :
  - sans `DB_DRIVER` : lance `npx prisma migrate status|deploy`, comme
    aujourd'hui ;
  - avec `neon-ws` : `Pool` de `@neondatabase/serverless` (WebSocket, **pas**
    `neon()` en HTTP) sur `DIRECT_URL`, repli sur `DATABASE_URL`.
    `status` n'écrit rien. `deploy` refuse de partir si `checksumMismatch` ou
    `failed` n'est pas vide. Il applique ensuite chaque migration en attente dans
    **une transaction** : `BEGIN`, contenu du fichier, `INSERT` dans
    `_prisma_migrations` (`id` aléatoire, `checksum`, `migration_name`,
    `started_at` et `finished_at` à `now()`, `applied_steps_count` à 1, `logs`
    et `rolled_back_at` à `NULL`), puis `COMMIT`. `--dry-run` fait la même chose
    mais termine par `ROLLBACK` et n'inscrit rien ;
  - les variables sont lues comme dans `prisma.config.ts`, plus
    `.env.development.local`. Aucune URL n'est affichée : seulement l'hôte,
    sans identifiants.
- `package.json` : `db:status`, `db:migrate`, `db:migrate:dry`.
- La vérification se fait sur la base partagée, **en lecture seule** :
  `npm run db:status` doit annoncer les 10 migrations appliquées et aucune en
  attente. **Ne pas lancer `deploy`** : il n'y a rien à appliquer.

**Tests** — nouveau `test/migration-plan.test.ts` :
- [x] répertoire et base identiques → tout `applied` ;
- [x] dossier absent de la base → `pending`, dans l'ordre des noms ;
- [x] empreinte calculée en LF ou en CRLF → `applied` ; contenu réellement
  différent → `checksumMismatch` ;
- [x] ligne sans `finished_at` ni `rolled_back_at` → `failed` ;
- [x] ligne en base sans dossier → `unknownInDb`.

#### 2.3. Next.js

Rien à faire : `lib/prisma.ts` est déjà en WebSocket, et doit le rester sans condition.

**Docs :** README, « Démarrage rapide » (`DB_DRIVER`, `npm run db:migrate`)
et « Commandes » ; `.env.example` (`DB_DRIVER` commenté, avec la mention
« poste local seulement, jamais sur Vercel », et `NEON_WS_BRIDGE_PORT`) ;
`architecture.md` §10.8 (pont, sécurité du segment local en clair) et
§10 bis (*Commandes*).

- [x] Étape 2 terminée (code, tests et vérification réelle ; reste la validation du propriétaire)

### Étape 3 — Backend : plus de cron, passes dues sur demande, démarrage qui ne ment plus

**Objectif :** plus aucune recherche ne part seule. L'admin lance « les passes
dues », sous le même plafond. Un démarrage raté se voit (F3, F4, F8, F9).

**`backend/scheduler/jobs.py`**
- Supprimer `research_cron_enabled()`, l'inscription de `research_rotation`,
  `CRON_RESEARCH_HOUR`, le fuseau de déclenchement et `PASSES_PER_NIGHT`.
- Remplacer `research_rotation` par
  `run_due_passes(key_manager, max_passes=1, dry_run=False, now=None) -> dict`.
  La logique ne change pas : relecture de l'état, `plan_rotation`, plafond, école
  occupée, `_QuotaWatch`, arrêt au premier quota épuisé. Ajouts :
  - le **rapport est rendu** (et toujours enregistré via `_record_job_run`) ;
  - `dry_run=True` : planifie et rend le plan, **sans créer de job ni appeler
    Research**. Cela remplace l'astuce `CRON_MONTHLY_CREDIT_CEILING=0` ;
  - un verrou de module empêche deux exécutions simultanées
    (`RotationAlreadyRunning`).
- Les passes lancées gardent **les mêmes libellés** (`PHASE1_CRON_LABEL`,
  `PHASE2_CRON_LABEL`) : ce sont eux qui font la mémoire du dernier passage. On
  ne les renomme pas. `source` vaut `"rotation"` : la colonne n'a pas de
  contrainte `CHECK` (vérifié dans `20260902100000_pipeline_job_state`), donc
  pas de migration.
- Crowdsourcing :
  - intervalle lu par `env_int` (F9) ;
  - `next_run_time` au démarrage, pour traiter tout de suite l'arriéré ;
  - le job passe par une enveloppe qui appelle `_record_job_run` (F4) ;
  - `process_pending_submissions` signale un échec de lecture de la base par une
    exception (ou un statut rendu) au lieu d'un `return` muet.
- `get_scheduler_status` :
  - retirer `research_cron`, ainsi que l'heure, le fuseau et la « nuit » du bloc
    `rotation` ;
  - garder `due_count`, `next` (5 premières passes), `monthly_ceiling` et
    `month_credits_used` ;
  - renommer `last_night` en `last_run` ;
  - ajouter `usage_sync` (`{ok, at, failed_keys}`).

**`backend/tavily_service/key_manager.py` (F8)**
- `sync_usage(timeout=20) -> dict` : la synchro `/usage` en **bloquant**, qui
  réutilise le code du fil d'arrière-plan. Elle mémorise
  `last_sync = {ok, at, failed_keys}`. Le démarrage lance toujours la synchro en
  arrière-plan.
- `run_due_passes` (réel) appelle `sync_usage()` d'abord. Si une clé n'a pas pu
  être synchronisée, il refuse (`USAGE_SYNC_FAILED`) et ne lance rien.

**`backend/routers/internal.py`**
- `POST /internal/run-due-passes`, avec le corps `{max_passes: 1..5, dry_run: bool}` :
  - `dry_run` → 200 avec le plan, en synchrone ;
  - réel → 202 avec ce qui va partir, puis exécution dans un fil
    (`run_in_executor`) ;
  - 409 si une exécution tourne déjà, 503 sans `TavilyKeyManager`, 503
    `USAGE_SYNC_FAILED`, 422 hors bornes.
- `pipeline-status` porte `startup_errors`.

**`backend/main.py` (F3, D5)**
- Chaque échec du démarrage s'ajoute à `app.state.startup_errors` et est
  journalisé en `ERROR`.
- Un `check_db_connection()` au démarrage. En cas d'échec, le message cite
  `DB_DRIVER` et suggère le pont.
- `/health` rend `{"status": "degraded", "errors": [...]}` si la liste n'est pas
  vide.
- Retirer `ENVIRONMENT` et `IS_PRODUCTION`. `/docs` reste ouvert : le service
  n'écoute que sur `127.0.0.1`. CORS : `http://localhost:3000` seulement.
- Retirer les mentions de Koyeb dans les commentaires et les docstrings
  (`main.py`, `pipeline_jobs.py`, `scheduler/jobs.py`).

**Tests :**
- [x] `test/test_scheduler_research_gate.py` est remplacé par
  `test/test_scheduler_registration.py` : `start_scheduler` n'inscrit **que** le
  crowdsourcing, quelles que soient `ENVIRONMENT` et `CRON_RESEARCH_ENABLED`
  (garde contre le retour d'un cron qui paie) ; `next_run_time` est posé ; un
  intervalle illisible retombe sur le défaut.
- [x] `test/test_research_rotation_job.py` adapté à `run_due_passes` :
  - `max_passes` respecté ; `dry_run` sans `create_job` ni appel Research ;
  - deuxième appel simultané → `RotationAlreadyRunning` ;
  - plafond et quota inchangés ;
  - synchro `/usage` en échec → rien ne part.
- [x] `test/test_rotation_status.py` adapté (`last_run`, `usage_sync`, plus de
  `research_cron`).
- [x] Nouveau `test/test_internal_run_due_passes.py` : jeton absent ou faux,
  202, 409, 503 (pas de gestionnaire de clés, synchro), 422.
- [x] Nouveau `test/test_startup.py` : un `TavilyKeyManager` qui lève →
  `/health` en `degraded` avec l'erreur ; une base injoignable → erreur de
  démarrage qui cite le pilote.
- [x] Crowdsourcing : une lecture de base en échec → dernier passage `failed`
  dans `get_scheduler_status()["last_runs"]`.

**Docs :**
- `architecture.md` :
  - §2.3 : API interne, bloc `scheduler`, `startup_errors` ;
  - §3.5 bis : `source = "rotation"`, libellés conservés ;
  - §5.1 et §5.3 : déclencheurs ;
  - §5.5, **réécrite** en « Passes dues sur demande » ;
  - §9 : Edge Case 15, les redémarrages Koyeb ;
  - §10.6 : surface du backend, loopback.
- `docs/features/cron-rotation-production.md` : bandeau en tête, « remplacé par
  `backend-local.md` ».
- `docs/testing/manual_testing_cron.md` : la passe à blanc devient le bouton
  « Simuler ».
- `docs/edgecase.md` : les mentions de Koyeb.
- `.env.example` : variables supprimées, de même qu'`ENVIRONMENT` et
  `ALLOWED_ORIGINS`.
- README, tableau des pièges.

- [x] Étape 3 terminée (code, tests et docs ; aucune vérification réelle prévue à cette étape) et validée par le propriétaire le 14 octobre 2026

### Étape 4 — Une Phase 2 qui dit la vérité (F1)

**Objectif :** une passe dont des cibles ont échoué ne se déclare plus réussie.

- `_run_research_and_extract` rend un **motif** en plus du résultat :
  - `ok`, `research_failed`, `empty_report` ;
  - `extraction_unavailable`, `extraction_failed`, `bad_shape`.
- `run_phase2_research` compte les motifs par catégorie, et les données
  inchangées à part (`unchanged`). Il rend `outcomes`, `failed_targets`
  (`[{category, label}]`) et `success`, selon la décision D2.
- Les déclencheurs manuels et `run_due_passes` s'appuient déjà sur
  `result["success"]` pour clore le job : vérifier qu'aucun ne force `completed`.
- Le chemin du quota (`_QuotaWatch`) ne change pas.

**Tests** — nouveau `test/test_phase2_outcomes.py` (Research et Gemini simulés) :
- [x] toutes les cibles échouent → `success: False`, `failed_targets` complet ;
- [x] échecs mêlés à des tickets → compteurs justes ; règle D2 appliquée ;
- [x] données inchangées partout → `success: True`, aucun ticket, `unchanged`
  compté ;
- [x] `dry_run` et `skip_pending` inchangés (les tests existants restent verts ;
  la doublure de `test_pending_guard.py` suit le nouveau contrat, ses
  assertions ne changent pas).

**Docs :** `architecture.md` §5.3 (résultat d'une passe) et §5.5 (reprise
après échec).

- [x] Étape 4 terminée (code, tests et docs ; aucune vérification réelle prévue à cette étape), commit `df8730e`, CI verte ; étape 5 confiée par le propriétaire le 14 octobre 2026

### Étape 5 — Next.js : un site en ligne sans backend (F5)

**Objectif :** sur Vercel, `/admin/cron` affiche ce que dit la base et
explique où se pilotent les recherches. En local, il pilote le backend.

- `lib/internal-api.ts` :
  - `fastapiUrl()` rend `null` si `FASTAPI_URL` est absente : plus de repli sur
    `localhost` ;
  - nouvelle fonction `backendTarget()` →
    `{ ok: true, url, token } | { ok: false, code: "BACKEND_LOCAL_ONLY" | "TOKEN_MISSING" }`.
- `pipeline-status`, `trigger-research` et la nouvelle route
  `app/api/admin/run-due-passes/route.ts` (`guardAdmin`, `max_passes` de 1 à 5,
  `dry_run`) :
  - `BACKEND_LOCAL_ONLY` → 503 **immédiat**, sans `fetch` ;
  - `TOKEN_MISSING` → 500 explicite ;
  - connexion refusée → 503 `BACKEND_NOT_RUNNING` ;
  - plus jamais de `Bearer null`.
- Nouvelle route `app/api/admin/pipeline-jobs/route.ts` (`guardAuth`, Prisma
  seul) : les 30 derniers `PipelineJob`, avec le nom de l'école, plus le nombre de
  contributions `Pending_AI` en attente de traitement local.
- `app/admin/cron/page.tsx` et `RotationPanel.tsx` :
  - trois états : *pilotage depuis le poste local* (en ligne), *backend local non
    lancé : `npm run local`*, et *backend prêt* ;
  - le bandeau « Cold Start (Edge Case 15) » disparaît ;
  - l'historique vient de `pipeline-jobs` dans tous les cas ;
  - les boutons « Simuler » et « Lancer N passes dues » (ADMIN) n'apparaissent
    que si le backend répond ;
  - `startup_errors` s'affiche en rouge.
- `lib/rotation-status.ts` : retirer les notions de nuit, d'heure et de fuseau ;
  décrire les passes dues, le plafond et `usage_sync`.
- `app/admin/inbox/page.tsx` : un bandeau « N contributions attendent le
  traitement par le backend local ».

**Tests :**
- [x] `test/internal-api.test.ts` : URL absente → `BACKEND_LOCAL_ONLY` ; jeton
  absent → `TOKEN_MISSING` ; l'ancien nom de jeton est accepté, avec un seul
  avertissement.
- [x] `test/api/pipeline-status.test.ts`, `trigger-research.test.ts`,
  `run-due-passes.test.ts` :
  - sans `FASTAPI_URL`, 503 et `fetch` **jamais appelé** ;
  - jeton absent → 500 ;
  - `fetch` rejeté → `BACKEND_NOT_RUNNING` ;
  - réponse transmise telle quelle ;
  - garde ADMIN sur les déclenchements ; bornes de `max_passes`.
- [x] `test/api/pipeline-jobs.test.ts` : session requise, forme de la réponse,
  compte des `Pending_AI`.
- [x] `test/rotation-status.test.ts` adapté.

**Docs :** `architecture.md` §2.3 (routes Next), §7.4 (`/admin/cron`), §10.5 ;
README.

- [x] Étape 5 terminée (code, tests et docs ; vérifiée dans Chromium contre un faux backend et une base morte) et validée par le propriétaire le 14 octobre 2026

### Étape 6 — Le lanceur local

- `package.json` : `backend` lance
  `backend/.venv/Scripts/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`.
  *Écrit à l'étape 6 avec le chemin entre guillemets* (`"backend/.venv/Scripts/python" …`) :
  sans eux, `cmd.exe`, le shell des scripts npm sous Windows, refuse le chemin.
- `scripts/start-local.ps1`, lancé par `npm run local` :
  1. refuse si le port 8000 est déjà pris : un second backend ferait un second
     `TavilyKeyManager`, et deux comptabilités qui s'ignorent ;
  2. démarre le backend **dans sa propre fenêtre** (`Start-Process`). Fermer Next
     ne doit pas tuer une passe en cours ;
  3. attend `/health` jusqu'à 60 s, puis affiche `startup_errors` s'il y en a ;
  4. lance `npm run dev`.
- **Ne jamais** lancer `uvicorn` avec `--host 0.0.0.0` sur le réseau de
  l'établissement : l'API interne et le pont seraient joignables depuis le
  réseau local.

**Tests** (ajoutés à l'étape 6) : `test/local-launcher.test.ts`, lecture
statique de `package.json` et du script : mêmes arguments des deux côtés,
`127.0.0.1:8000`, ni `0.0.0.0` ni `--reload`, chemin entre guillemets, BOM
UTF-8, commande citée par l'écran.

**Docs :** README (démarrage : une commande) ; `architecture.md` §2.4
(arborescence) et §10.6.

- [x] Étape 6 terminée (code, tests et docs ; vrai `npm run local` joué avec l'accord du propriétaire, `/admin/cron` suivi dans Chromium) et validée par le propriétaire le 14 octobre 2026

### Étape 7 — Tests des parties non couvertes

**Objectif :** chaque module a au moins ses cas d'échec testés, en commençant
par ceux qui échouent sans le dire. Les tests vont dans `test/` (Python), dans
`test/*.test.ts` (fonctions de `lib/`) et dans `test/api/` (routes).

Déjà couverts aujourd'hui, à ne pas refaire :
- `attachment_plan`, `campus_attachment`, `campus_attachment_collector` ;
- `program_identity`, `discovery_diff`, `pending_guard`, la cascade Gemini ;
- la rotation (planificateur, job, statut), la rotation des clés Tavily ;
- `process_crowdsourcing_ticket`, les énumérations partagées, le rapport rangé ;
- l'interrupteur de collecte, le rattachement des classements ;
- côté TypeScript : `lib/campus-attachment`, `lib/contribution`,
  `lib/rotation-status`, `lib/trigger-research`.

#### P0 — échecs muets et sécurité

| Module | À tester | Pourquoi |
|---|---|---|
| `app/api/admin/inbox/[id]/validate/route.ts` | **F2** : JSON mal formé → 400, rien d'écrit ; corps vide → données du ticket ; refus des charges `campus_attachments` et rapport rangé ; `Validated` seulement si une donnée est écrite, sinon 422 avec `skipped` ; capacité : les 4 cas de résolution du campus ; exception dans la transaction → ticket resté `Pending_Admin` | 1 242 lignes, aucune testée ; c'est la porte d'entrée de la production |
| `app/api/admin/inbox/[id]/attachments/route.ts` | **F2** ; arête absente → `edge_missing`, rien d'écrit | même défaut que `validate` |
| `app/api/contribute/route.ts` | plafonds (texte, nombre d'URL, catégories) ; `https` seulement ; hôte privé refusé ; domaine de l'école ou liste blanche ; appartenance du campus, du programme et de l'arête à l'école ; un ticket par catégorie, avec un même `submission_group_id` ; `user_text` stocké | seule écriture publique |
| `lib/auth.ts` | `guardAuth` sans session → 401 ; `guardAdmin` en MODERATOR → 403, en ADMIN → passe | toutes les routes admin en dépendent |
| `lib/utils.ts` | `isValidHttpsUrl` ; `normalizeDomain` ; `urlBelongsToDomain` : `emlv.fr.evil.com`, `evil-emlv.fr`, sous-domaine, port, majuscules | la liste blanche des contributions repose dessus |
| `lib/password.ts` | 11 caractères refusés, 12 acceptés ; limite de 72 **octets** avec des caractères multi-octets | au-delà de 72 octets, bcrypt tronque sans le dire |
| `proxy.ts`, `lib/rate-limit.ts` | 6ᵉ tentative de connexion en 15 min → 429 ; `/admin/*` sans session → redirection ; `/admin/login` libre ; Upstash absent ou en erreur → repli en mémoire, journalisé | protection de la connexion |
| `backend/pipeline/diff.py` | pour chaque catégorie : identique → `False` ; un champ changé → `True` ; `None` contre `0` ; aucune ligne en production → `True` ; listes dans un autre ordre | un faux « inchangé » supprime le ticket sans trace |
| `backend/ai/gemma_client.py` (`wrap_source`) | balises de délimitation neutralisées, y compris variantes de casse et d'espaces ; le reste du texte intact | garde anti-injection jamais testée (README, *Sécurité* §2) |
| `backend/pipeline_jobs.py` | un seul job actif par école ; `reap_orphaned_jobs` (autre `worker_id`) ; `reap_stale_jobs` au seuil ; purge à deux rétentions selon `ROTATION_LABELS` ; `finished_at` lu en UTC ; `update_progress` avale l'erreur mais journalise | mémoire du dernier passage : une erreur fait repayer une école, ou ne plus jamais la repasser |
| `backend/crowdsourcing/processor.py` (`process_pending_submissions`) | sélection : les 20 plus anciens `Pending_AI` et les `Failed` rejouables (compteur et délai) ; catégorie inconnue → `Rejected` ; quota → arrêt du lot | la file des contributions publiques |
| `backend/tavily_service/research_client.py` | échecs consécutifs ; délai maximal ; erreur de quota → `QuotaExhaustedError` ; crédits estimés enregistrés ; `dry_run` | un compteur faux fausse le plafond |

#### P1

| Module | À tester |
|---|---|
| `backend/ai/extraction_schemas.py`, `extraction_prompts.py` | chaque catégorie de `backend/constants.py` a un schéma et un prompt (`get_extraction_*` ne lève pas) ; `MIN_TIER_BY_CATEGORY` les couvre toutes ; chaque schéma est un objet JSON Schema bien formé (`type`, `properties`, `required` ⊂ `properties`) |
| `backend/ai/research_prompts.py` | chaque brief contient le nom de l'école, le domaine et l'année cible ; aucun ne reçoit de texte d'utilisateur |
| `backend/tavily_service/catalog_client.py` | quota → passe catalogue abandonnée avec un avertissement, la Phase 1 continue ; page introuvable → ancre vide |
| `backend/tavily_service/client.py` | `search_web`, `extract_from_urls` : quota → exception typée ; lots de 5 URL |
| `backend/utils/academic_year.py` | bornes du 31 août et du 1er septembre, pour l'année cible et l'année courante |
| `backend/pipeline/phase2_research.py` (hors F1) | `ARRAY_RESULT_KEYS` : N tickets reliés par un même `submission_group_id` ; `_include_domains_for` (domaine pour Pricing, rien pour Ranking et Capacity) ; `_write_capacity_ticket` |
| `backend/routers/internal.py` | jeton absent côté serveur → erreur explicite ; jeton faux → 401 ; pour chaque déclencheur : école inconnue → 404, occupée → 409, exception → job `failed` |
| `app/api/admin/inbox/purge/route.ts` | ne supprime jamais `Pending_AI` ni `Pending_Admin` ; ADMIN seulement |
| `reject`, `create-programs` | ticket absent → 404 ; programmes créés pour la seule école du ticket |
| `app/api/admin/users/**` | un MODERATOR ne crée pas de compte ; changer son propre mot de passe exige l'actuel ; celui d'un tiers exige ADMIN ; politique de `lib/password.ts` appliquée |
| `app/api/v1/**` (15 routes) | forme de la réponse ; 404 ; en-têtes CORS ; format d'erreur d'`architecture.md` §8.9 ; bornes de pagination ; une erreur Prisma → 500 au format, sans le message interne |

#### P2

| Module | À tester |
|---|---|
| CRUD admin (`schools`, `campuses`, `programs`, `pricing`, `rankings`, `capacities`, `accreditations`, `stats`, `program-campuses`) | par route : 400 sur un corps invalide, 404 sur un id inconnu, le cas nominal ; suppressions en cascade réservées à ADMIN |
| `app/api/schools/**` (site public) | écoles `ACTIVE` seulement ; 404 |

#### Pages React

Le projet n'a pas de bibliothèque de test React. On n'en ajoute pas :
- **F6** : l'accueil affiche une erreur au lieu d'une liste vide, et le
  `catch` muet de l'inbox affiche un message ;
- nouveau `scripts/smoke-local.ts`, lancé à la main contre `npm run dev`. Il
  appelle `/`, `/contribute`, `/api-docs`, la fiche de la première école, celle de
  son premier programme et chaque `GET /api/v1/*`. Il attend un 200, un JSON
  lisible pour l'API, et l'absence de page d'erreur Next. Il n'est pas en CI : il
  a besoin de la base.

**Fait quand :** P0 et P1 sont verts ; P2 couvre au moins 400, 404 et le cas
nominal de chaque route ; F2 et F6 sont corrigés.

**Docs :** `architecture.md` §10 bis (*Tests* : inventaire, banc des routes,
smoke) ; README (nombre de tests).

- [x] Étape 7 terminée (code, tests et docs ; P0, P1 et P2 verts, F2 et F6 corrigés ; suites rejouées sous garde réseau, 0 tentative). `scripts/smoke-local.ts` écrit et rodé contre un faux site local, **pas encore joué contre `npm run dev`** (il lit la base partagée : accord du propriétaire). Commit, push et prompt de l'étape 8 demandés par le propriétaire le 15 octobre 2026

### Étape 8 — Préparer Vercel (documentation ; le propriétaire déploie)

L'agent ne déploie pas. Il prépare et vérifie :

- **Variables sur Vercel :**
  - `DATABASE_URL` (poolée), `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (URL de
    production) ;
  - `UPSTASH_REDIS_REST_URL` et `_TOKEN` : fortement recommandées, car la limite
    de débit en mémoire ne tient pas sur des fonctions sans état ;
  - `CONTRIBUTION_ALLOWED_DOMAINS` si elle est utilisée.
- **Jamais sur Vercel** : `FASTAPI_URL`, `INTERNAL_API_TOKEN`, `DB_DRIVER`, les
  clés Gemini et Tavily, `SEED_ADMIN_PASSWORD`.
- **La base est déjà rattachée à Vercel.** Le projet Neon `vc-bdd` vit dans une
  organisation gérée par Vercel, et sa branche `main` est marquée « branche de
  production Vercel ». L'intégration peut donc injecter elle-même les variables
  de connexion dans le projet Vercel. Vérifier leurs noms côté Vercel. Il faut
  que `DATABASE_URL` y soit l'URL poolée, et ne pas créer de doublon à la main.
- Le build (`prisma generate && next build`) se contente de `DATABASE_URL` :
  `prisma.config.ts` se replie dessus. Le vérifier en local, avec la variable
  seule.
- **Offre Hobby** (usage non commercial, accepté par le propriétaire) :
  - vérifier dans la documentation de Vercel la durée maximale d'une fonction,
    face au délai de 60 s de la transaction de `validate` ;
  - aucune tâche planifiée Vercel n'est nécessaire.
- Les migrations sont appliquées depuis le poste avec `npm run db:migrate`, avant
  le déploiement qui en dépend.

**Docs :** `docs/memory/memory-deploiement-vercel.md`, avec le §0
**réécrit** (plus de Koyeb ni de backend hébergé) et la liste des variables
mise à jour ; `docs/architecture/task.md` (mentions de Koyeb) ;
`architecture.md` §1.2 et §2.1-2.2 (schéma et pile).

- [x] Étape 8 terminée (documentation et vérifications ; 15 octobre 2026). Variables inventoriées, aucun écart ; build vert avec une `DATABASE_URL` morte pour seule variable ; Hobby : 300 s par fonction, aucune tâche planifiée ; smoke vert contre `npm run dev` après correction de sa règle 404 (décision du propriétaire) ; [`memory-deploiement-vercel.md`](../memory/memory-deploiement-vercel.md) réécrit. **Le projet Vercel n'existe pas encore** : création, variables, connexion de la base et déploiement reviennent au propriétaire (mémo, §8 et §9)

### Étape 9 — Vérification de bout en bout (avec le propriétaire)

Si D7 est acceptée, toute l'étape se fait sur la branche `dev`. Le propriétaire
pointe les `DATABASE_URL` locales vers elle. Sinon, chaque écriture touche la
base que verront les visiteurs.

1. `DB_DRIVER=neon-ws` posée par le propriétaire. `npm run db:status` annonce
   10 migrations appliquées et aucune en attente.
2. `npm run local` : `/health` est `ok`, aucune `startup_errors`, et
   `/admin/cron` liste les passes dues.
3. « Simuler » : le plan s'affiche, le nombre de `PipelineJob` est le même avant
   et après, et aucun crédit n'est consommé.
4. Arrêter le backend : `/admin/cron` en local affiche « backend local non
   lancé ». Un `next build && next start` sans `FASTAPI_URL` affiche « pilotage
   depuis le poste local » **immédiatement**, avec l'historique.
5. **Avec l'accord du propriétaire seulement :**
   - une contribution de test sur `/contribute` en local, traitée en moins d'une
     minute et passée en `Pending_Admin` (coût : ~1 crédit Tavily et deux appels
     Gemma) ;
   - puis une passe due réelle (Phase 1 : ~30 crédits).

- [ ] Étape 9 terminée. Jouée le 15 octobre 2026 sur `dev` : points 1 à 4 verts ; passe due réelle (ESSCA, Phase 1) `completed`, un ticket en `Pending_Admin`. **Reste** : la contribution de test n'a pas atteint `Pending_Admin` (supprimée, défaut C1) ; à rejouer après la correction de C1 à C3 (décision du propriétaire, journal), puis validation du propriétaire

### Étape 10 — Facultative : suite d'intégration sur une branche Neon (D6)

Les faux Prisma ne vérifient ni les contraintes d'unicité, ni les `CHECK`, ni
les vraies transactions. La suite `npm run test:db` :
1. crée une branche Neon jetable depuis la base partagée, avec le MCP Neon
   (`create_branch`, avec l'accord du propriétaire) ou la CLI `neon`, et les
   skills `neon` et `neon-postgres` installés dans `.claude/skills/` ;
2. lance les tests de `validate`, `attachments` et `contribute` contre elle, par
   Prisma en WebSocket (443) ;
3. supprime la branche, même en cas d'échec.

Elle exige une clé d'API Neon (fournie par le propriétaire, jamais commitée) et
ne tourne pas en CI.

---

## 7. Pièges connus

- **Empreinte des migrations** : sha256 des octets du fichier, en LF ou en CRLF.
  Ne jamais retoucher un `migration.sql` appliqué.
- **Le segment pont ↔ psycopg2 est en clair** (`sslmode=disable`), et Neon peut
  y demander le mot de passe en clair. Il doit rester sur `127.0.0.1`.
- **Un seul backend à la fois** : deux processus feraient deux
  `TavilyKeyManager`, et `max_instances` comme le verrou de `run_due_passes` ne
  valent que par processus.
- **La rétention des passages reste supérieure à l'intervalle**
  (`PIPELINE_JOB_ROTATION_RETENTION_DAYS` > `CRON_RESEARCH_INTERVAL_DAYS`).
  Sinon, une école déjà passée paraît « jamais passée » et elle est repayée.
- **Les libellés de `PipelineJob` ne changent pas** : la mémoire des passages en
  dépend.
- **Fermer la fenêtre du backend pendant une passe** laisse un job `running`.
  `reap_orphaned_jobs` le clôt en `failed` au lancement suivant, et l'école
  repasse 14 jours plus tard.
- **`/usage` n'est pas en temps réel** : même synchronisé, le compteur sous-estime
  les dernières minutes. C'est l'écart entre le plafond (7 000) et le budget
  (~10 000) qui absorbe ce retard.
- **Next.js 16** : `proxy.ts` tient lieu de middleware. Lire les docs de
  `node_modules/next/dist/docs/` avant de toucher aux pages et aux routes.
- **Chemins Windows** dans les scripts (`backend/.venv/Scripts/python`) : le
  poste du propriétaire est sous Windows.

---

## 8. Hors périmètre

- Ranger les rapports Research de Phase 2 quand leur extraction échoue (D3).
- Afficher `raw_report` dans l'inbox.
- Chemin d'écriture de `ProgramPlacement` (abandonné le 29 septembre 2026).
- CSP à nonce ; vulnérabilités npm tirées par la CLI Prisma.
- Réécrire le backend en TypeScript.

---

## 9. Récapitulatif des fichiers

| Nouveaux | Modifiés | Supprimés |
|---|---|---|
| `backend/neon_ws_bridge.py` | `backend/db.py`, `backend/main.py`, `backend/requirements.txt` | `test/test_scheduler_research_gate.py` (remplacé) |
| `scripts/db-migrate.ts`, `scripts/lib/migration-plan.ts` | `backend/scheduler/jobs.py`, `backend/routers/internal.py` | |
| `scripts/start-local.ps1`, `scripts/smoke-local.ts` | `backend/tavily_service/key_manager.py` | |
| `app/api/admin/run-due-passes/route.ts` | `backend/pipeline/phase2_research.py`, `backend/crowdsourcing/processor.py` | |
| `app/api/admin/pipeline-jobs/route.ts` | `lib/internal-api.ts`, `lib/rotation-status.ts` | |
| `test/helpers/*`, `test/api/*.test.ts` | `app/api/admin/pipeline-status/route.ts`, `trigger-research/route.ts` | |
| `test/test_db_driver.py`, `test/migration-plan.test.ts` | `app/api/admin/inbox/[id]/validate/route.ts`, `attachments/route.ts` | |
| `test/test_scheduler_registration.py`, `test/test_internal_run_due_passes.py`, `test/test_startup.py`, `test/test_phase2_outcomes.py` | `app/admin/cron/page.tsx`, `RotationPanel.tsx`, `app/admin/inbox/page.tsx`, `app/page.tsx` | |
| tests de l'étape 7 | `package.json`, `.github/workflows/ci.yml`, `.env.example` | |

---

## 10. Documentation à mettre à jour, étape par étape

| Document | Sections | Étape |
|---|---|---|
| `README.md` | deux exécutions, démarrage rapide, pièges des variables, commandes, nombre de tests | 1, 2, 3, 6, 7 |
| `.env.example` | `DB_DRIVER` et `NEON_WS_BRIDGE_PORT` (local) ; suppression des variables du cron, d'`ENVIRONMENT` et d'`ALLOWED_ORIGINS` ; `FASTAPI_URL` et `INTERNAL_API_TOKEN` marquées « local seulement » | 2, 3, 5 |
| `docs/architecture/architecture.md` | §1.2, §2.1–2.4, §3.5 bis, §5.1, §5.3, §5.5 (réécrite), §7.4, §9 (EC 15), §10.5, §10.6, §10.8, §10 bis | chaque étape, pour ce qu'elle touche |
| `docs/memory/memory-deploiement-vercel.md` | §0 réécrit, variables | 8 |
| `docs/features/cron-rotation-production.md` | bandeau « remplacé par `backend-local.md` » | 3 |
| `docs/testing/manual_testing_cron.md` | passe à blanc → « Simuler » | 3, 5 |
| `docs/edgecase.md` | mentions de Koyeb | 3 |
| `docs/architecture/task.md` | mentions de Koyeb | 8 |
| `docs/cahier-des-charges-school-pipeline.md`, `docs/prompt/*` | **aucune** : documents historiques | — |

---

## 11. Journal de progression

| Date | Étape | Fait | Reste / surprises |
|---|---|---|---|
| 2026-10-14 | — | Plan rédigé. Réseau mesuré depuis le poste : 5432 fermé sur l'hôte poolé et sur l'hôte direct, 443 ouvert ; psycopg2 en échec (2 × 60 s). Prisma 7.10 : aucun adaptateur pour Migrate. Skills Neon (`neon`, `neon-postgres`) installés dans `.claude/skills/`. | Décisions D1 à D6 à trancher. Le pont WebSocket du backend n'est pas encore éprouvé (étape 0). |
| 2026-10-14 | — | MCP Neon branché par le propriétaire. Lectures seulement (projets, branches, tables) : le compte connecté ne voit **qu'un autre projet** (une autre application, région `aws-eu-central-1`, production Vercel). Le projet de l'application (`ep-twilight-forest-ab9qjkm7`, `aws-eu-west-2`) n'y figure pas. | Rebrancher le MCP sur le compte qui porte la base de l'application, idéalement limité à ce seul projet. |
| 2026-10-14 | — | MCP rebranché. Il voit le projet `vc-bdd` (`lucky-cell-29057691`) dans l'organisation gérée par Vercel. Lectures seulement : 10 migrations appliquées, aucune en échec ; empreintes concordantes en brut, LF ou CRLF (trois en LF seulement). Comptes de référence : 6 écoles (toutes `ACTIVE`), 13 campus, 46 programmes, 51 arêtes, 4 `PipelineJob`, 2 comptes ; inbox : 6 `Validated`, 1 `Rejected`, 1 `Failed`. | Une seule branche Neon, marquée production Vercel : décision D7 ajoutée. Le MCP voit aussi `neon-cyclamen-river`, qui n'est pas à nous. |
| 2026-10-14 | 0 | **Sonde du pont réussie** depuis le réseau de l'établissement, alors que le 5432 était fermé. Montage : psycopg2 → `127.0.0.1` (`sslmode=disable`) → `wss://<hôte>/v2` (443). Hôte poolé et hôte direct : connexion en 0,8 s et 0,1 s, `SELECT 1` (PostgreSQL 17.11), lecture réelle (6 écoles), transaction terminée par `ROLLBACK` (46 programmes), 5 connexions simultanées (5 processus serveur distincts). Aucune erreur côté pont ; `options=endpoint` inutile. Lectures seulement. | La porte de l'étape 0 est franchie pour le réseau. Restent les relevés de tests et les décisions D1 à D7. |
| 2026-10-14 | 0 | **Relevés de départ**, sur `newresearch` (`295044e`) : `npm test` 291 tests Python verts et 25 sous-tests (2,1 s) ; `npm run test:ts` 43 verts ; `npm run typecheck` propre ; `npm run lint` 0 erreur, 124 avertissements, dont 112 sur des fichiers suivis et 12 dans `tmp/` (ignoré par git, mais lu par ESLint sur le poste). Défauts F1 à F9 (§5) revérifiés dans le code : tous présents aux endroits cités. | **Surprise** : `npm test` lance le `python` du `PATH`, c'est-à-dire le Python 3.14 global, et non `backend/.venv`. Les deux environnements peuvent diverger. **Arbre non propre** : `.mcp.json` (serveurs Neon et Vercel), `skills-lock.json`, `.claude/skills/` et ce plan ne sont pas commités. Restent : arbre propre, branche confirmée, décisions D1 à D7. |
| 2026-10-14 | 0 | **Décisions du propriétaire** : D1 à D7 retenues telles que recommandées. D1 : pont dans le processus Python. D2 : une Phase 2 finit `failed` dès qu'une cible échoue. D3 : hors du plan. D4 : tests dans `test/` et `test/api/`. D5 : retrait d'`ENVIRONMENT`, du masquage de `/docs` et du CORS de production. D6 : plus tard. D7 : branche Neon `dev` à créer avant l'étape 9. **Branche de travail `localpython`**, créée depuis `newresearch` à sa demande. Plan, `.mcp.json`, `skills-lock.json` et `.claude/skills/` commités dessus ; arbre propre. **Étape 0 terminée.** | Écart : la branche de travail n'est plus `newresearch` (choix du propriétaire). `CLAUDE.md` est ignoré par git : sa mise à jour reste sur le poste. Prochaine session : étape 1, après validation du plan par le propriétaire. La question de `npm test` et du Python global reste ouverte (voir la ligne précédente). |
| 2026-10-14 | 0 | **`npm test`, décision du propriétaire** : on garde le `python` du `PATH`, comme la CI qui repart d'un environnement neuf. Rien ne change dans `package.json`. À l'étape 2, vérifier `websockets` dans les deux interpréteurs : relevé ce jour, les deux ont la 16.0. **`CLAUDE.md` est désormais suivi par git**, à la demande du propriétaire : retiré de `.gitignore`. `AGENTS.md` reste ignoré : seul `CLAUDE.md` était demandé. | **Surprise** : le Python du `PATH` a déjà dérivé des versions épinglées (`google-genai` 2.3.0 au lieu de 2.4.0, `bcrypt` absent, `pytest-asyncio` 1.4.0 au lieu de 1.3.0). `backend/.venv` est conforme. Les 291 tests passent quand même. Réaligner revient au propriétaire : `python -m pip install -r backend/requirements-dev.txt`. Dans une copie neuve du dépôt, l'import `@AGENTS.md` de `CLAUDE.md` ne se résout qu'après un premier `next dev`. |
| 2026-10-14 | 1 | **Plan validé par le propriétaire ; étape 1 codée.** `test:ts` passe à `node --import tsx --experimental-test-module-mocks --test "test/**/*.test.ts"` : les 43 tests existants sont toujours trouvés, sous `cmd` comme sous `sh`. Nouveau banc : `test/helpers/fake-prisma.ts` et `test/helpers/session.ts`, plus `test/api/inbox-ticket.test.ts` (3 tests) et `test/api/admin-guards.test.ts` (4 tests). CI : job `ts-tests` (Node 24, `npm ci`, `prisma generate`, `npm run test:ts`) ; job `validate` passé de Node 20 à Node 24. Docs : `architecture.md` §2.4 et §10 bis (*Commandes*, *Tests*, *Intégration continue*), README (*Commandes*, *Tests et qualité*), `CLAUDE.md`. Fin d'étape : `npm test` 291 verts (+25 sous-tests), `npm run test:ts` **50** verts, `typecheck` propre, `lint` 0 erreur et 124 avertissements (aucun dans les nouveaux fichiers). | **Reste** : la case CI, qui exige un push de `localpython` (accord du propriétaire). **Constats** : sous Node 24.21, `mock.module` exige encore le drapeau ; `namedExports` est déprécié, on passe par `exports`. `mock.module` marche du premier coup avec tsx et les alias `@/`, et le repli du plan (extraire la logique dans `lib/`) n'a pas servi. **Écarts** : (1) le test des gardes vérifie l'**égalité** entre les handlers sous `guardAdmin` et la liste ADMIN du §3.6, pas seulement l'inclusion ; il exige aussi un `await` devant la garde, refuse les exports qu'il ne sait pas lire, et un cas synthétique prouve qu'il repère ces défauts ; (2) le banc ajoute deux contrôles positifs (200, 404) qui prouvent que le faux Prisma est bien branché ; (3) `fake-prisma.ts` pose une `DATABASE_URL` locale morte, pour qu'un test ne puisse jamais joindre Neon ; (4) le job `ts-tests` reçoit une `DATABASE_URL` factice, car `env()` de `prisma/config` lève dès le chargement de `prisma.config.ts`, `prisma generate` compris. **Surprise** : le commentaire de `prisma.config.ts` décrit `env()` comme une référence résolue plus tard. Faux : la fonction lève tout de suite (`node_modules/@prisma/config/dist/index.js`). La logique du fichier reste juste, et on n'y touche pas dans ce plan. |
| 2026-10-14 | 1 | **Commit `a449194` poussé sur `origin/localpython`**, avec l'accord du propriétaire, ainsi que les deux commits de l'étape 0. Run CI `38541040467` : **`ts-tests` vert, 50 tests lancés et réussis** ; `python-tests` vert. Case CI cochée. **Étape 1 terminée.** | **`validate` en échec, sans lien avec l'étape** : types, ESLint, Prisma et garde-fou passent, mais `npm audit --audit-level=critical` trouve **1 critique** (`next` 16.0.0 à 16.3.7 ; le projet est en 16.3.4) et 13 hautes. Le lock n'a pas changé : ce sont des avis publiés depuis le dernier run vert (28 septembre). `next/og`, siège de la faille d'exécution de code, n'est pas utilisé ; les avis de cache et de SSRF visent un site en ligne. npm corrige par `npm audit fix` sans `--force`. **Décision du propriétaire en attente** : montée de `next` hors du plan, puis les sept contrôles manuels d'`architecture.md` §10 bis. Doc mise à jour (*Sécurité des dépendances*, *Intégration continue*). Avertissement GitHub non bloquant : `actions/checkout@v4` et `actions/setup-node@v4` visent Node 20, que GitHub force en Node 24. |
| 2026-10-14 | hors plan | **Montée de `next`, à la demande du propriétaire**, entre les étapes 1 et 2. `next` 16.3.4 → **16.3.8**, le correctif de la même mineure ; plancher de `package.json` à `^16.3.8`. `npm audit fix` sans `--force` : `brace-expansion`, `fast-uri`, `sharp` 0.35.5, `source-map-js`. `eslint-config-next` réaligné sur 16.3.8 (`audit fix` l'avait monté en 16.4.0). Audit : **0 critique**, 9 hautes, toutes liées à un `--force` refusé (Prisma 6, `eslint-config-next` 14). `npm test` 291, `test:ts` 50, `typecheck` et `lint` inchangés (0 erreur, 124 avertissements), `npm run build` vert. Contrôles manuels d'`architecture.md` §10 bis : n°1 à n°6 verts ; n°7 vert en développement sur 11 pages, dont 6 en session ADMIN. Identifiants lus dans les variables utilisateur Windows, jamais affichés ; 0 occurrence du mot de passe dans le journal du serveur. | **n°7 en production, complété après reconnexion de l'extension** : zéro violation CSP sur les pages publiques et le back-office en session ADMIN ; un message témoin en début et en fin de parcours prouve que la console était suivie. Commit `3ccd016` poussé ; **run CI `38543458606` entièrement vert** (`validate`, `ts-tests`, `python-tests`). Sur `/admin/cron`, `pipeline-status` répond 503 toutes les 5 s et l'écran annonce un « démarrage à froid » : c'est F5, corrigé à l'étape 5. **Surprises** : (1) npm 11.19 n'exécute plus les scripts d'installation non approuvés (`@prisma/engines`, `esbuild`, `prisma`, `unrs-resolver`). Ces paquets n'ont pas changé de version, donc sans effet ici ; à surveiller à leur prochaine montée. (2) `next dev` et `next start` écoutent aussi sur l'adresse réseau (`172.30.208.1`), pas seulement sur `localhost`. (3) En développement, Next 16 recopie les requêtes Prisma du serveur dans la console du navigateur. |
| 2026-10-14 | 2 | **Passage à l'étape 2 validé par le propriétaire.** Départ : `localpython` en `1d9898a`, arbre propre ; CI `38543458606` verte ; `npm test` 291 (+25 sous-tests), `test:ts` 50, `typecheck` propre, `lint` 0 erreur et 124 avertissements. | Étape 2 en cours (cette ligne sera suivie du compte rendu de fin d'étape). **Lecture des `.env` autorisée par le propriétaire** (exception à §0) : vérifiés par script, noms des variables seulement, plus la valeur de `DB_DRIVER` et l'hôte des URL ; aucun secret affiché. Constat : `DB_DRIVER=neon-ws` posée dans `.env.local` et dans `.env` (racine), `.env.development.local` absent, `backend/.env` sans `DB_DRIVER`. |
| 2026-10-14 | 2 | **Étape 2 codée, testée et vérifiée sur la base.** Tests d'abord, vus en échec (27 sur 28 en Python, le 28ᵉ décrivant l'état existant ; le fichier TypeScript entier), puis le code. Python : `backend/neon_ws_bridge.py` (classe `Bridge` à URL cible injectable, `start_bridge` unique par processus, `stop_bridge`, `NEON_WS_BRIDGE_PORT`), `build_dsn()` et branchement dans `get_pool()` (`backend/db.py`), `websockets==16.0` déclaré (16.0 dans le Python du `PATH` comme dans `backend/.venv`, déjà dans le lock). Node : `scripts/lib/migration-plan.ts` (pur), `scripts/lib/migration-runner.ts`, `scripts/db-migrate.ts`, scripts `db:status`, `db:migrate`, `db:migrate:dry`. Aucune dépendance npm ajoutée. Fin d'étape : `npm test` **319** (+28, +25 sous-tests), `test:ts` **68** (+18), `typecheck` propre, `lint` 0 erreur et 124 avertissements (aucun nouveau). **Vérification réelle, en lecture seule** : `npm run db:status` en WebSocket vers l'hôte direct : **10 appliquées, 0 en attente**, recoupé avec `_prisma_migrations` lue par le MCP (10 lignes finies, aucune annulée ; rejeu hors ligne de `planMigrations` : les trois migrations « LF seulement » sortent bien `applied`). Python : `get_pool()` avec `neon-ws`, script hors dépôt chargeant `backend/.env` : `SELECT 1`, PostgreSQL 17.11, 6 écoles, dans une transaction `READ ONLY`. Aucune URL dans les sorties (0 occurrence de `postgres`). Ni `deploy`, ni `--dry-run`, ni `uvicorn`. **Variables** : à la demande du propriétaire (option A), l'agent a déplacé `DB_DRIVER` de `.env.local` et `.env` vers un nouveau `.env.development.local`, par un script qui ne touche que cette ligne, vérifie que les 7 autres variables sont inchangées à l'octet près et n'affiche aucune valeur ; le propriétaire a ajouté la ligne à `backend/.env`. `db:status` rejoué ensuite : identique. Docs : README (*Démarrage rapide*, *Commandes*, nombre de tests), `.env.example`, `architecture.md` §10.8 et §10 bis, `CLAUDE.md`. | **Écarts** : (1) `scripts/lib/migration-runner.ts` en plus : la suite de requêtes de `deploy` et `--dry-run` ne sera pas jouée contre la base, elle est donc testée sur un faux client SQL ; le module porte aussi l'aiguillage `DB_DRIVER`, le choix de l'URL et le nettoyage des messages. (2) `--dry-run` : toutes les migrations dans **une** transaction terminée par `ROLLBACK`, pour qu'une migration qui dépend de la précédente soit vérifiée ; le déploiement garde une transaction par migration. Sans `DB_DRIVER`, `--dry-run` refuse (la CLI Prisma n'en a pas). (3) Garde-fous ajoutés : `build_dsn()` refuse `host`, `hostaddr` et `port` en paramètres d'URL avec `neon-ws` (le segment local est en clair) ; un échec du pool lève une `RuntimeError` nettoyée du mot de passe, sans chaîner l'exception de libpq, qui recopie parfois le DSN ; c'est le seul changement visible sans pilote. `status` lit dans une transaction `READ ONLY`, et une base sans `_prisma_migrations` est renvoyée vers la CLI Prisma. (4) `CLAUDE.md` : `db:migrate` jamais sans l'accord du propriétaire. **Surprises** : (a) le pilote WebSocket rejette un `ErrorEvent` de `ws` et non une `Error` (premier essai : « [object Object] ») : `describeError()` le lit ; (b) l'ouverture du pool a pris 5 s (réveil de Neon probable) ; (c) `backend/.env` garde l'ancien nom `INTERNAL_TOKEN` et `.env.local` `FASTAPI_INTERNAL_TOKEN` (étape 5) ; `CRON_PHASE1_INTERVAL_HOURS` et `CRON_PHASE2_INTERVAL_HOURS` ne sont plus lues ; `.env` (racine) est un doublon de `.env.local`. **Reste** : validation du propriétaire ; CI à vérifier au prochain push (Python 3.12 non disponible sur le poste). Prochaine étape : 3. |
| 2026-10-14 | 2 | **Commit `02da0d7` poussé sur `origin/localpython`**, à la demande du propriétaire. Run CI `38547705252` **entièrement vert** : `python-tests` 319 verts (+25 sous-tests) sous **Python 3.12.15**, pont compris, `websockets` 16.0 installé depuis `requirements.txt` ; `ts-tests` 68 verts ; `validate` vert (types, ESLint, Prisma, garde-fou, `npm audit`). | Étape 2 en attente de la validation explicite du propriétaire. Cette ligne n'est pas encore commitée. |
| 2026-10-14 | 2 | **Étape 2 validée par le propriétaire**, qui demande le prompt de l'agent de l'étape 3. Prompt rédigé par l'agent de l'étape 2 et remis au propriétaire. | Prochaine session : étape 3. Les trois dernières lignes du journal, le bandeau de tête du plan et `CLAUDE.md` (*Phase en cours*) ne sont pas commités : ils partiront avec l'étape 3, sauf demande contraire du propriétaire. |
| 2026-10-14 | 3 | **Début de l'étape 3**, confiée par le propriétaire. Départ : `localpython` en `02da0d7`, arbre modifié comme prévu (`CLAUDE.md`, ce plan : clôture de l'étape 2) ; `npm test` 319 verts (+25 sous-tests), `test:ts` 68 verts. | Étape en cours (cette ligne sera suivie du compte rendu de fin d'étape). Aucune vérification réelle : ni `uvicorn`, ni `/internal/run-due-passes`, ni `/usage`. |
| 2026-10-14 | 3 | **Étape 3 codée et testée.** Tests d'abord, vus en échec (37 en échec, 23 en erreur, un fichier en erreur dès la collecte), puis verts. Nouveaux : `test_scheduler_registration.py` (remplace `test_scheduler_research_gate.py`, supprimé), `test_internal_run_due_passes.py`, `test_startup.py`, `test_usage_sync.py`. Adaptés : `test_research_rotation_job.py`, `test_rotation_status.py`, et deux ajustés (`test_phase1_collection_switch.py` : fonctions renommées ; `test_tavily_key_rotation.py` : garde réseau). Code : `scheduler/jobs.py` (plus de cron ; `run_due_passes` ; `RotationAlreadyRunning`, `UsageSyncFailed` ; enveloppe `_crowdsourcing_job` ; intervalle par `env_int` ; `next_run_time` ; statut sans `research_cron`, `last_night` → `last_run`, `usage_sync`), `key_manager.py` (`_fetch_quota` commun, `sync_usage`, `last_sync`), `routers/internal.py` (`POST /internal/run-due-passes`, `startup_errors`, tri des jobs sur `"rotation"` **et** `"cron"`, clé `cron_jobs` gardée), `main.py` (`startup_errors`, contrôle de la base, `/health` en `degraded`, plus d'`ENVIRONMENT` ni d'`IS_PRODUCTION`, CORS en dur sur `localhost:3000`, plus de Koyeb), `db.py` (`db_connection_error()`, qui reprend le message de `get_pool()` et ajoute une piste selon `DB_DRIVER`), `processor.py` (`SubmissionQueueUnavailable`, bilan rendu), `pipeline_jobs.py` (`SOURCE_ROTATION`, `ROTATION_SOURCES`), docstrings de `rotation.py` et `phase1_research.py`, commentaire de `prisma/schema.prisma` (`npx prisma validate` : valide). Fin d'étape : `npm test` **362** verts (+25 sous-tests), `test:ts` 68, `typecheck` propre, `lint` 0 erreur et 124 avertissements (aucun nouveau). **Garde réseau** passée sur toute la suite (connexions et DNS refusés hors de `127.0.0.1`) : aucune tentative. Docs : `architecture.md` (en-tête, §2.3, §2.4 pour les tests et `jobs.py`, §3.5 bis, §5.1, §5.3, §5.4, §5.5 réécrite, §9 : EC 15, 22, 27, 29, 30 et nouveaux 31 à 33, §10.6, §10 bis, §11), `cron-rotation-production.md` (bandeau), `manual_testing_cron.md` (simulation `dry_run`, dépannage), `edgecase.md` (Koyeb ; EC 31 à 33), `.env.example`, README, `CLAUDE.md` (règle 7, *Phase en cours*), mémoire `local-backend-cron-hazard`. | **Écarts** : (1) `run_due_passes` reçoit en plus `on_planned` : la route répond 202 avec le plan, et 409 ou 503 de façon synchrone, sans dupliquer verrou ni synchro ; (2) la simulation ne prend pas le verrou : elle ne paie rien et n'ouvre aucun job, et reste donc possible pendant une exécution réelle (testé) ; comme le réel, elle clôt les jobs morts (`reap_stale_jobs`) pour planifier la même chose ; (3) elle s'inscrit sous sa propre clé (`run_due_passes_dry_run`) : elle n'efface pas l'issue de la dernière exécution réelle (`last_run`) ; (4) bloc `rotation` : `enabled` retiré (il disait si le cron était inscrit) ; `interval_days` gardé (variable toujours lue) ; (5) corps de la route : `dry_run` **exigé**, `StrictBool`, champ inconnu refusé : une passe payante ne part ni par défaut, ni sur `"false"`, ni sur une faute de frappe (`dryRun`). Tous ces cas répondent 422 ; (6) 202 aussi quand rien ne part (rien de dû, plafond atteint, planification impossible) : le corps porte alors le rapport final ; (7) `_start_cron_job` et `_finish_cron_job` renommés en `_start_rotation_job` et `_finish_rotation_job` ; la clé du registre vaut `run_due_passes` (mémoire seulement). Les libellés `PHASE*_CRON_LABEL` ne changent pas ; (8) démarrage : la base d'abord ; injoignable, la reprise des jobs n'est pas tentée (deux délais de connexion de plus pour la même erreur), et les jobs morts sont clos au battement de cœur ; (9) la synchro du démarrage passe désormais par `sync_usage()` dans un fil, pour que `usage_sync` la reflète. `test_tavily_key_rotation.py` remplace donc aussi `_sync_usage_in_background`, avec `addCleanup`. Une réponse `/usage` sans bloc `key` compte comme un échec (elle passait en silence) ; (10) crowdsourcing : un quota Tavily épuisé est inscrit `failed`, car les contributions restent bloquées ; (11) `has_failure` présent même scheduler arrêté ; `pipeline-status` en `degraded` si `startup_errors` n'est pas vide ; (12) `test_usage_sync.py` en plus de la liste du plan, pour tester F8 côté gestionnaire de clés. **Surprises** : (a) importer `backend.main` charge `backend/.env` (`load_dotenv` au niveau du module) ; la suite l'évitait jusqu'ici. `test_startup.py` neutralise `load_dotenv` et restaure l'environnement ; (b) l'étape 6 dit qu'avec `--host 0.0.0.0` « le pont » serait joignable : faux, il écoute sur `127.0.0.1` quoi qu'il arrive. Seules la documentation et l'API interne le seraient (corrigé au §10.6 d'`architecture.md`) ; (c) sans en-tête, `HTTPBearer` de FastAPI 0.136 répond 401, pas 403 ; (d) `CRON_CROWDSOURCING_INTERVAL_MINUTES=1440` ne retarde plus le premier passage du crowdsourcing ; (e) une demande réelle attend la synchro (jusqu'à 20 s) avant de répondre : la route Next de l'étape 5 doit tolérer plus de 20 s, alors que `pipeline-status` coupe aujourd'hui à 4 s. **Reste** : validation du propriétaire ; commit et push à sa demande ; CI à vérifier en Python 3.12 ; **`/admin/cron` en local incohérent jusqu'à l'étape 5** : il lit encore `research_cron` (`page.tsx:514`), `last_night` (`RotationPanel.tsx:131`), `hour`, `timezone` et `passes_per_night` (`lib/rotation-status.ts`), et affiche une rotation « inactive — job non inscrit ». Les tests TypeScript restent verts (fixtures). **Hors étape, signalé** : `backend/.env` garde `CRON_PHASE1_INTERVAL_HOURS` et `CRON_PHASE2_INTERVAL_HOURS` (plus lues) et l'ancien nom `INTERNAL_TOKEN`. Il ne contient ni `ENVIRONMENT`, ni `ALLOWED_ORIGINS`, ni variable `CRON_RESEARCH_*` : rien à retirer pour cette étape. |
| 2026-10-14 | 3 | **Commit de l'étape 3 poussé par le propriétaire** (`ba07fc4`, message « étape 3 done »), puis renommé à sa demande au format du dépôt : `feat(backend): plus de cron, passes dues sur demande, démarrage qui ne ment plus` (`6f82c2e`, même arbre, même auteur ; `git commit --amend` puis `push --force-with-lease` adossé à `ba07fc4`). Run CI `38563999291` (`ba07fc4`) puis `38564790293` (`6f82c2e`) **entièrement verts** : `python-tests` **362** verts (+25 sous-tests) sous Python 3.12.15, `ts-tests` 68, `validate` vert. **Étape 3 validée par le propriétaire**, qui demande de démarrer l'étape 4. | Sur le poste, la branche locale reste sur `ba07fc4` : `git fetch origin` puis `git reset --keep origin/localpython`. Les MCP Neon et Vercel ne joignaient pas la session cloud en début de session (tunnel refusé par le proxy) ; sans objet pour l'étape 4, qui ne touche pas la base. |
| 2026-10-14 | 4 | **Début de l'étape 4**, dans une session cloud (conteneur Linux, et non le poste Windows) : Python 3.13.16, Node 24.21.0 installé par `nvm` comme en CI, `npm ci`, `pip install -r backend/requirements-dev.txt`. Départ : `localpython` en `6f82c2e`, arbre propre ; `npm test` 362 verts (+25 sous-tests), `test:ts` 68, `typecheck` propre, `lint` 0 erreur et **112** avertissements (les 112 des fichiers suivis : pas de `tmp/` dans une copie neuve). Aucun `.env` dans le conteneur. | Étape en cours (cette ligne sera suivie du compte rendu de fin d'étape). Ni base, ni réseau payant : Research et Gemini sont simulés dans les tests. |
| 2026-10-14 | 4 | **Étape 4 codée et testée.** Tests d'abord : `test/test_phase2_outcomes.py` vu en échec (14 en échec, dont 7 `assert True is False` qui montrent F1 ; les 2 tests des déclencheurs manuels passaient déjà), puis vert. Il fait tourner la vraie `run_phase2_research` et le vrai `_run_research_and_extract`, avec Research, Gemini et la base en doubles. Code : `backend/pipeline/phase2_research.py` : motifs `OUTCOME_*`, `FAILURE_LABELS`, `ResearchOutcome` (tuple nommé rendu par `_run_research_and_extract`), `_PassTally` (compte et message) ; `run_phase2_research` rend `success` (faux dès qu'une cible a échoué, D2), `outcomes`, `unchanged`, `failed_targets`, et un message qui nomme les cibles en échec ; `_write_ranking_tickets` et `_write_capacity_ticket` rendent `(créés, inchangés)`. `backend/scheduler/jobs.py` : une passe de rotation en échec garde son résultat. Vérifié : les déclencheurs manuels (`_run_enrichment`, `_run_targeted_research`) et la rotation clôturent sur `result["success"]`, aucun ne force `completed` ; c'est désormais tenu par des tests. Le chemin du quota ne change pas : en rotation, `_QuotaWatch` est lu avant `success`. Fin d'étape : `npm test` **379** verts (+17, +25 sous-tests), rejoués aussi sous Python 3.12.3 (environnement `uv` jetable, hors dépôt) ; `test:ts` 68 ; `typecheck` propre ; `lint` 0 erreur et 112 avertissements (inchangés). Garde réseau sur toute la suite : 0 tentative. Docs : `architecture.md` (en-tête, §5.3 *Résultat d'une passe*, §5.5 clôture, quota et *Reprise après échec*, §9 EC 34, §10 bis), `edgecase.md` (EC 34), README (nombre de tests), `CLAUDE.md`. | **Écarts** : (1) motif `dry_run` en plus des six du plan : en simulation, rien n'est extrait et ce n'est pas un échec ; une recherche qui lève en simulation reste un échec ; (2) `failed_targets` porte aussi `reason` ; `label` vaut l'école, le programme ou « programme @ campus » (sans le « pour » du journal) ; (3) `unchanged` est une clé à part, `{catégorie: nb d'enregistrements}`, et non un motif : `outcomes` compte des cibles, et un rapport Ranking porte plusieurs enregistrements ; (4) le message nomme au plus 5 cibles, puis « (+n) » : il part dans `PipelineJob.error` (tronqué à 2 000 caractères) et dans le rapport des passes dues ; (5) `_run_rotation_pass` passe `result=result` sur un échec, comme les déclencheurs manuels : `failed_targets` arrive dans `PipelineJob.result`. C'est le seul changement hors de `phase2_research.py` ; (6) tests en plus de la liste du plan : quota → `research_failed`, une seule cible en échec, message court, passe sans échec, simulation avec recherche en échec, garde « en attente », trois déclencheurs ; (7) `test/test_pending_guard.py` : sa doublure rendait `(None, "", [])`, exactement le retour d'une recherche en échec, et le test affirmait `success is True` : il encodait F1 sans le vouloir. Elle rend désormais « rien de neuf » (`ResearchOutcome({}, "", [], "ok")`, `has_data_changed` → `False`), et `_write_ranking_tickets` → `(0, 0)`. **Aucune assertion modifiée** ; (8) docs en plus du plan : EC 34, en-tête d'`architecture.md`, README. **Surprises** : (a) une recherche manuelle coupée par le quota finit maintenant `failed` (avant : `completed`), avec « recherche en échec » ; le mot « quota » n'est que dans le journal du serveur ; (b) Accreditation n'a pas de comparaison à la production (`_get_existing_record` rend `None`) : un ticket à chaque passe, jamais `unchanged`. Comportement antérieur, hors du plan ; (c) une reprise après échec refait toute la passe : les cibles inchangées et celles en échec sont repayées, sous le plafond. C'est le coût accepté par D2 ; (d) `/admin/cron` ne montre pas l'`error` d'un job (le type la porte, l'écran ne l'affiche pas) : les cibles en échec sont en base, pas à l'écran. À voir à l'étape 5. **Reste** : validation du propriétaire ; commit et push à sa demande. **Session cloud : rien n'est commité, et le conteneur est éphémère** ; CI à vérifier au push. Aucune vérification réelle : ni `uvicorn`, ni Research, ni Gemini, ni base. |
| 2026-10-14 | 4 | **Commit `df8730e` sur `origin/localpython`** (`fix(phase2): une passe dont une cible échoue finit failed et nomme ses cibles`). Run CI `38567545066` **entièrement vert** : `Tests Python` (379 attendus), `Tests TypeScript`, `Lint, Types & Migrations` (types, ESLint, Prisma, garde-fou, `npm audit`). Le propriétaire confie l'étape 5 : l'étape 4 est tenue pour validée. | Les lignes du journal ajoutées depuis `df8730e` partiront avec l'étape 5, sauf demande contraire. |
| 2026-10-14 | 5 | **Début de l'étape 5**, en session cloud (conteneur Linux). Départ : `localpython` en `df8730e`, arbre propre ; `npm test` 379 verts (+25 sous-tests), `test:ts` 68, `typecheck` propre, `lint` 0 erreur et 112 avertissements. **Décisions du propriétaire**, demandées avant le code : (1) l'historique de `/admin/cron` affiche l'erreur d'un job `failed` (message tronqué, texte entier au survol) ; (2) tant que `npm run local` n'existe pas (étape 6), l'écran cite la commande `uvicorn` actuelle, tenue dans une seule constante que l'étape 6 remplacera. | **Surprise** : dans ce conteneur, le `node` du `PATH` est la 22.22 (`/opt/node22`) ; la 24.21 de la CI est sous `/opt/nvm/versions/node/v24.21.0`. Sous Node 22, les 3 tests de `test/api/inbox-ticket.test.ts` échouent (`guardAuth is not a function` : l'option `exports` de `mock.module` n'y existe pas). Tous les relevés de cette étape sont faits sous Node 24. |
| 2026-10-14 | 5 | **Étape 5 codée, testée et vérifiée dans un navigateur.** Tests d'abord : 46 des nouveaux tests vus en échec ; avec la seule constante de délai ajoutée, ceux des deux routes existantes montraient F5 (sans `FASTAPI_URL`, appel à `http://localhost:8000` ; sans jeton, appel au backend quand même). Code : `lib/internal-api.ts` (`fastapiUrl()` → `null`, `backendTarget()`, `backendUnavailable()`, `relayToBackend()`, `BACKEND_TIMEOUTS_MS`) ; `pipeline-status` et `trigger-research` réécrites sur le relais ; nouvelles routes `run-due-passes` (`guardAdmin`) et `pipeline-jobs` (`guardAuth`, Prisma seul) ; `lib/rotation-status.ts` (plus de nuit, d'heure ni de fuseau ; `describeUsageSync`, `previewRun`, `parseRunDuePassesBody`, `describeDuePassesReport`) ; `/admin/cron` (trois états, historique, « Simuler » et « Lancer N passes dues ») ; bandeau `Pending_AI` dans l'inbox. Fin d'étape : `npm test` 379 (+25 sous-tests), `test:ts` **122** (+54), `typecheck` propre, `lint` 0 erreur et **103** avertissements (−9, aucun dans les fichiers nouveaux), `next build` vert. **Vérification** sur `next start`, dans Chromium (Playwright), base factice morte, sessions ADMIN et MODERATOR fabriquées avec un secret de test, faux backend de fixtures sur `127.0.0.1` : bandeau « Pilotage depuis le poste local » en 0,3 à 0,6 s sans `FASTAPI_URL` ; « Backend local non lancé » sur un port fermé ; backend prêt : `startup_errors` en rouge, « Simuler » puis « Lancer 2 passes dues » avec confirmation (le faux backend a reçu `{"max_passes":2,"dry_run":true}` puis `{"max_passes":2,"dry_run":false}`) ; MODERATOR sans bouton ; historique et bandeau de l'inbox sur réponses simulées. Ni vrai backend, ni Neon, ni appel payant. Docs : `architecture.md` (en-tête, §2.3, §2.4, §3.6, §7.4, §9 EC 15, §10.5, §10 bis), `edgecase.md` (EC 15), `manual_testing_cron.md` (écran, « Simuler », dépannage), `.env.example` (local seulement), README, `CLAUDE.md`. | **Écarts** : (1) deux modules purs en plus, `lib/backend-state.ts` (codes, trois états, commande citée) et `lib/pipeline-history.ts` (libellés, durée, aperçu de l'erreur), testés sans React : `lib/internal-api.ts` est réservé au serveur ; (2) `app/admin/cron/page.tsx` devient une page serveur qui lit le rôle ; l'ancien écran passe dans `CronMonitoringClient.tsx`. Sans cela, l'écran ne savait pas réserver les boutons aux ADMIN ; (3) deux codes en plus : `BACKEND_TIMEOUT` (504 ; pour un lancement, le message dit que la demande « a pu partir ») et `BACKEND_BAD_RESPONSE` (502). Un 401 du backend passe tel quel, et l'écran le lit « le backend refuse le jeton » ; (4) délais : `pipeline-status` 4 → 8 s, un appel à la fois ; `trigger-research` 10 → 30 s ; `run-due-passes` 60 s (couvre la synchro `/usage` de 20 s). En ligne, l'écran ne redemande plus `pipeline-status` ; (5) `trigger-research` : corps illisible → 400 (avant : 503 « Backend indisponible ») ; `school_id` encodé dans le chemin ; (6) le formulaire de recherche ciblée n'apparaît plus qu'à un ADMIN, backend prêt (§7.4) ; un MODERATOR le voyait et recevait 403 ; (7) un lancement réel demande une confirmation (aperçu, coût estimé) ; « Lancer » est grisé sans passe due ; (8) le compte de l'inbox passe par la route existante (`/api/admin/inbox?status=Pending_AI&limit=1`), rechargé avec la liste ; (9) **décision (1) du propriétaire** : l'erreur est bornée à 2 000 caractères par la route (comme à l'écriture par le backend) et tronquée à 300 **par l'écran**, le texte entier au survol ; la question parlait de 300 « côté route », ce qui aurait empêché le survol de montrer le texte entier ; (10) aide de test `test/helpers/fake-backend.ts` ; (11) titre de la page : « Pipeline de recherche ». **Surprises** : (a) `next build` réécrit `next-env.d.ts` (`.next/dev/types` → `.next/types`) : remis en état ; (b) le build signale « Dynamic server usage » sur `/api/schools`, antérieur à l'étape ; (c) le menu latéral dit encore « Monitoring & Cron » (`SidebarClient.tsx`, hors étape). **Reste** : validation du propriétaire ; CI du push ; à l'étape 6, remplacer `LOCAL_BACKEND_COMMAND` (`lib/backend-state.ts`) par `npm run local`, ainsi que son test (`test/backend-state.test.ts`) et `architecture.md` §7.4 ; à l'étape 9, les trois états contre le vrai backend et la vraie base. **Commit et push sur `localpython` en fin de session**, à la demande du crochet de fin de session du conteneur cloud (le conteneur est éphémère). |
| 2026-10-14 | 5 | **Étape 5 validée par le propriétaire**, sur le poste Windows, après le pull de `16ee824` (CI `38572088863` verte). La branche locale restait sur `ba07fc4` : `git rebase origin/localpython` l'a écarté (même arbre que `6f82c2e`). **Variables, à la demande du propriétaire** (noms seulement, aucune valeur lue ni affichée) : `backend/.env`, `INTERNAL_TOKEN` → `INTERNAL_API_TOKEN`, `CRON_PHASE1_INTERVAL_HOURS` et `CRON_PHASE2_INTERVAL_HOURS` retirées (plus lues), commentaire au-dessus de `DB_DRIVER` ; `.env.local`, `FASTAPI_INTERNAL_TOKEN` → `INTERNAL_API_TOKEN`. Les deux jetons comparés par le script : identiques. | Plus aucun ancien nom de jeton sur le poste. |
| 2026-10-14 | 6 | **Début de l'étape 6**, confiée par le propriétaire, sur le poste (Windows PowerShell 5.1, Node 24.21, Python 3.14 dans `backend/.venv`). Départ : `localpython` en `16ee824` ; `npm test` 379 verts (+25 sous-tests), `test:ts` 122, `typecheck` propre, `lint` 0 erreur et 115 avertissements (dont ceux de `tmp/`, non suivi). | **Surprise** : la commande du plan, `backend/.venv/Scripts/python -m uvicorn …`, échoue sous `cmd.exe`, le shell des scripts npm sous Windows (« 'backend' n'est pas reconnu »). Entre guillemets, le chemin passe. |
| 2026-10-14 | 6 | **Étape 6 codée et testée sur le poste.** Test d'abord : `test/local-launcher.test.ts` vu en échec (script absent), puis vert. Code : `package.json` (`local` → `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1` ; `backend` → `"backend/.venv/Scripts/python" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`) ; `scripts/start-local.ps1` (Windows PowerShell 5.1, UTF-8 avec BOM) : refus si le port 8000 est pris, en nommant le programme ; contrôle de l'interpréteur du venv ; backend dans sa fenêtre (`cmd /k`) ; attente de `/health` (60 s, sans proxy) puis bilan `ok` ou `startup_errors` ; `npm run dev`. `lib/backend-state.ts` : `LOCAL_BACKEND_COMMAND` = `npm run local`, son test adapté (`test/backend-state.test.ts`). Bandeau « backend local non lancé » de `CronMonitoringClient.tsx` : une phrase en plus. **Vérifications sans lancer le backend** : `npm run local` avec le port 8000 tenu par un faux programme → refus, code 1, « python (PID …) », aucun processus `uvicorn` ensuite ; fonctions du script chargées depuis son AST et exercées contre un faux `/health` (`scratchpad`, hors dépôt) : port libre ou pris, `ok`, `degraded` avec accents, 404, fenêtre vivante, backend mort, fenêtre fermée, tout vert ; syntaxe vérifiée par l'analyseur de PowerShell 5.1. Fin d'étape : `npm test` 379 (+25 sous-tests), `test:ts` **128** (+6), `typecheck` propre, `lint` 0 erreur et 115 avertissements (inchangés ; les 5 de `CronMonitoringClient.tsx` sont antérieurs). Docs : README (démarrage, commandes, nombre de tests), `architecture.md` (en-tête, §2.4, §7.4, §10.6, §10 bis), `manual_testing_cron.md` (§2, §3, dépannage), `CLAUDE.md` (phase en cours, règle 7, commandes). | **Écarts** : (1) chemin de l'interpréteur entre guillemets dans `package.json` (surprise de l'étape) ; (2) le point 4 du plan ne relance pas Next.js s'il écoute déjà sur le port 3000 : l'écran cite `npm run local` justement quand Next.js tourne, et un second `next dev` n'aurait rien apporté ; (3) si le backend meurt au démarrage ou si sa fenêtre est fermée, le lanceur s'arrête **sans** lancer Next.js et renvoie à la fenêtre ; passé 60 s sans réponse, il lance Next.js avec un avertissement (base lente) ; (4) `cmd /k` : la fenêtre reste ouverte quand le backend s'arrête, pour qu'on lise l'erreur ; (5) plus de `--reload` dans les commandes documentées (README et `CLAUDE.md` le portaient) : il tuerait une passe en cours ; (6) test et docs en plus de la liste du plan : `test/local-launcher.test.ts`, `manual_testing_cron.md`, `CLAUDE.md`. **Surprises** : (a) `cmd.exe` lit `backend/.venv/…` sans guillemets comme « backend » suivi d'une option ; (b) sous Windows, une connexion refusée sur `127.0.0.1` met 2 s à échouer : le lanceur teste le port (0,5 s) avant `/health` ; (c) sans BOM, PowerShell 5.1 lit le script en ANSI : le test l'exige ; (d) le test interdit `0.0.0.0` partout dans le script, y compris dans un commentaire, qui a été reformulé. **Reste** : validation du propriétaire ; **premier lancement réel de `npm run local` avec son accord** (il écrit dans la base et traite les `Pending_AI`), sinon à l'étape 9 ; commit et push à sa demande. |
| 2026-10-14 | 6 | **Vérification réelle dans un navigateur, avec l'accord du propriétaire.** Avant : aucun ticket `Pending_AI` (le seul `Failed` est un `Automated_AI`, que le traitement des contributions ne reprend pas), 4 jobs `failed`, aucun actif (MCP Neon, `SELECT` seulement). `npm run local` réel : backend `ok` (aucune `startup_errors`), Next.js prêt en 0,6 s. Chromium (Playwright `playwright-core` 1.63.0 installé dans le dossier temporaire de la session, hors dépôt ; Chromium 1243 déjà en cache), session ADMIN ouverte avec les identifiants lus dans le registre (`APPVC_ADMIN_*`), jamais affichés : **10 vérifications sur 10 vertes**. (1) `/admin/cron` « prêt », aucune erreur de démarrage, « Simuler » et « Lancer » visibles ; (2) « Simuler » : « 1 passe partirait — ESSCA, Phase 1, ~30 crédits » (9 passes dues, synchro `/usage` réussie, 4 clés, 4 000 crédits restants) ; « Lancer » jamais cliqué, toute boîte de confirmation refusée d'office ; (3) second lancement pendant que le backend tourne → refus, code 1, « port 8000 déjà pris par python (PID …) » ; (4) fenêtre du backend fermée → « non lancé », le bandeau cite `npm run local` ; (5) relance → « Backend prêt », « Next.js tourne déjà sur le port 3000 … il n'est pas relancé », code 0, écran revenu à « prêt ». Après : même état en base (aucun job créé, aucun ticket traité, rien de purgé), backend et Next.js arrêtés, ports 3000 et 8000 libres ; mot de passe présent dans aucun des journaux et fichiers de la session (compte sans affichage). | **Hors étape, signalé** : `next dev` annonce une adresse réseau (`Network: http://172.30.208.1:3000`) : comme toujours, Next.js écoute sur toutes les interfaces ; l'adresse vue est sans doute une carte virtuelle du poste. Le back-office y exige une session. **Reste** : validation du propriétaire ; commit et push à sa demande ; le propriétaire peut retirer `APPVC_ADMIN_USERNAME` et `APPVC_ADMIN_PASSWORD` de ses variables Windows. |
| 2026-10-14 | 6 | **Étape 6 validée par le propriétaire**, qui demande le commit, le push et le prompt de l'agent de l'étape 7. Avant le commit : lanceur converti en CRLF comme les autres fichiers du poste (`core.autocrlf=true` ; git le stocke en LF, BOM gardé), tests rejoués : `npm test` 379 (+25 sous-tests), `test:ts` 128, `typecheck` propre, `lint` 0 erreur et 115 avertissements, syntaxe PowerShell 5.1 sans erreur. Prompt de l'étape 7 rédigé et remis au propriétaire. | Prochaine session : étape 7. |
| 2026-10-14 | 7 | **Début de l'étape 7**, confiée par le propriétaire, sur le poste (Windows, Node 24.21). Départ : `localpython` en `048d945`, égal à `origin/localpython` après `git fetch` (rien à rebaser), arbre propre ; `npm test` 379 verts (+25 sous-tests), `test:ts` 128, `typecheck` propre, `lint` 0 erreur et 115 avertissements (dont ceux de `tmp/`, non suivi). Session sur Opus 5.5 ; le niveau d'effort n'est pas vérifiable par l'agent. | Étape en cours (cette ligne sera suivie du compte rendu de fin d'étape ou de session). Ordre suivi : P0, P1, P2, puis F6 et `scripts/smoke-local.ts`. |
| 2026-10-14 | 7 | **P0 écrit et vert ; F2 corrigé.** Tests d'abord, vus en échec : F2 (4 tests sur `validate`, 4 sur `attachments` : 200 et JSON de l'IA écrit au lieu de 400). Correction : `lib/request-body.ts` (`readOptionalJsonObject`, `adminCorrections`), corps lu avant la base ; JSON mal formé **ou** valeur qui n'est pas un objet (`null`, tableau, nombre, chaîne) → 400, rien d'écrit ; absent ou `{}` → le ticket tel quel. Banc : `fake-prisma.ts` retient ce qu'une transaction en échec annule (`rolledBack`, `writes()`), car la forme tableau du faux exécute chaque requête dès sa construction. Nouveaux tests : `test/api/inbox-validate.test.ts`, `inbox-attachments.test.ts`, `contribute.test.ts` ; `test/request-body.test.ts`, `auth.test.ts`, `utils.test.ts`, `password.test.ts`, `rate-limit.test.ts`, `proxy.test.ts` ; `test/test_diff.py`, `test_wrap_source.py`, `test_pipeline_jobs.py`, `test_crowdsourcing_queue.py`, `test_research_client.py`. **Quatre défauts hors F2/F6 révélés, exposés au propriétaire (règle 4), qui a retenu chaque fois l'option recommandée** ; chacun vu en échec puis corrigé : (1) `wrap_source` ne neutralisait pas `< /TEXTE_SOURCE>` (espace avant la barre) → expression `<\s*/?\s*…` ; `isPrivateHost` laissait passer `[::ffff:127.0.0.1]` et `localhost.` → IPv4 encapsulée et point final ramenés à leur forme simple ; (2) `attachments` closait le ticket sans aucune ligne résolue → 422 avec les conflits (décompte dans `error`), ticket ouvert, comme `validate` ; (3) `contribute` ne posait pas de `submission_group_id` → un `randomUUID` par soumission ; (4) une tâche Research perdue au polling n'était pas comptée → estimation enregistrée dès le `request_id`. Relevé : `npm test` **463** (+84, +25 sous-tests), `test:ts` **246** (+118), `typecheck` propre, `lint` 0 erreur et 115 avertissements (inchangés). | **Reprendre à P1.** Surprise : la doc de Next 16 cite `unstable_doesProxyMatch`, que `next` 16.3.8 n'exporte pas ; le test du matcher utilise `unstable_doesMiddlewareMatch`. `purge_finished_jobs` et `read_last_passes` (UTC) étaient déjà tenus par `test_rotation_plan.py` : pas refaits. |
| 2026-10-14 | 7 | **P1 en cours, F6 corrigé ; arrêt à une frontière propre** (le propriétaire demande un `/compact`). **Trois décisions de plus du propriétaire, option recommandée à chaque fois, chacune vue en échec puis corrigée** : (5) `client.py` : `search_web` et `extract_from_urls` avalaient un refus de quota ou une panne et rendaient `""`, que le traitement des contributions lisait « contenu vide » → ticket **supprimé** ; désormais clé refusée → clé suivante (3 essais, comme `/map`) puis `QuotaExhaustedError`, autre panne → `TavilyRequestError` (nouvelle) ; le processor passe le ticket en `Failed` (rejoué), le collecteur lit une panne comme une page vide ; seule une extraction réussie mais vide reste permanente ; (6) déclencheurs internes : école inconnue → 404 `SCHOOL_NOT_FOUND` (`_require_school`, avant tout job ; avant : 500 sur la clé étrangère) ; (7) école occupée → 409 `ALREADY_RUNNING` (avant : 200 `already_running`), branche morte retirée de `CronMonitoringClient.tsx`. **F6** : tests d'abord (`test/silent-pages.test.ts`, vu en échec), puis `lib/public-schools.ts` (accueil : une erreur n'est plus une liste vide, message et « Réessayer », statistiques jamais avalées) et `lib/ticket-refresh.ts` (inbox : échec ou réponse non 2xx du rechargement → message). P1 écrits et verts : `test_extraction_contracts.py`, `test_academic_year.py`, `test_catalog_client.py`, `test_tavily_client.py`, `test_phase2_writers.py`, `test_internal_triggers.py` ; `test/api/inbox-actions.test.ts` (purge, rejet, création de programmes), `test/api/users.test.ts`. Adaptés : `test_crowdsourcing_processor.py`, `test_campus_attachment_collector.py` (tests ajoutés), `test_phase1_collection_switch.py` (remplacement de `_require_school`, assertions inchangées). Relevé : `npm test` **570** verts (+25 sous-tests), `test:ts` **280** verts, `typecheck` propre. | **Reprendre à P1, API v1 (15 routes)**, puis P2, le smoke, la garde réseau, les docs. **Défaut trouvé, à soumettre au propriétaire (règle 4)** : `GET /api/v1/schools/[id]/pricing` et `GET /api/v1/rankings` filtrent par `program.campus`, relation disparue avec le refactor `Program` : Prisma refuse la requête (`PrismaClientValidationError : Unknown argument campus`, vérifié avec le vrai client vers `127.0.0.1:9`, sans réseau) → **toujours 500**. `tsc` ne le voit pas (`where: any`). Option recommandée : passer par `program.school` (et `program.campuses` pour l'affichage). **Question ouverte pour P2** : un JSON mal formé donne 500 (rien d'écrit) sur toutes les routes CRUD admin et `create-programs` ; leur 400 vient des contrôles de contenu. Écart noté : les briefs Research Phase 1 et Accreditation n'ont pas d'année cible, par construction. |
| 2026-10-14 | 7 | **Reprise après `/compact` : trois décisions du propriétaire, option recommandée à chaque fois.** (8) `GET /api/v1/schools/[id]/pricing` et `GET /api/v1/rankings` (toujours 500, `program.campus`) : **corriger**, test d'abord ; filtre par `program.school`, chaque ligne expose `program.campuses` (et `program.school` pour `/rankings`). (9) Défaut trouvé à la relecture : `?page=abc` ou `?limit=abc` → `NaN` dans `parsePagination` → Prisma refuse (`Argument skip is missing`, vérifié avec le vrai client vers `127.0.0.1:9`) → 500 sur `/schools`, `/programs`, `/rankings` ; **une valeur non numérique reprend la valeur par défaut**, comme les valeurs hors bornes. (10) CRUD admin et `create-programs` : un JSON mal formé ou `null` → 500, rien d'écrit ; **consigné, non corrigé** (écrit en clair dans les tests P2), suite possible. | En cours : P1 API v1. |
| 2026-10-14 | 7 | **P1 API v1 vert (décisions 8 et 9 appliquées) ; P2 : quatre défauts de plus, exposés au propriétaire, option recommandée à chaque fois (corriger).** (11) `PUT /api/admin/programs/[id]` ne vérifiait pas que les `campusIds` appartiennent à l'école du programme (la création le fait) → même contrôle, 400. (12) `POST`/`PUT` écoles et campus : un nom ou un domaine fait d'espaces passait le contrôle (fait avant `trim()`) et une chaîne vide était écrite → contrôle après `trim()`, 400. (13) Une valeur non numérique (tarifs, statistiques, durées d'un programme) devenait `NaN`, que Prisma **écrit en `NULL`** (vérifié en capturant le SQL par un faux adaptateur, sans base : `SET "total_fee" = $1`, `args = [null, …]`) : une faute de frappe effaçait la valeur, réponse 200 → 400 en nommant le champ. (14) `GET /api/admin/schools/[id]/campuses` rendait `[]` pour une école inconnue → 404. Banc : `test/helpers/prisma-schema.ts` relit chaque requête du faux contre le vrai schéma (`Prisma.dmmf`), c'est lui qui a vu `program.campus`. | En cours : corrections 11 à 14, puis le smoke. |
| 2026-10-15 | 7 | **Étape 7 codée et testée ; fin d'étape.** Décisions 8 à 14 appliquées, chacune vue en échec puis corrigée (10 : consignée, écrite en clair dans les tests P2). **P1, API v1** : `test/api/v1.test.ts` (112 cas) : forme, CORS, `OPTIONS`, 404, erreur Prisma → 500 sans message interne (`P1001`, URL de base), pagination (7 cas par collection), `?year=abc` → 400, filtres, comparaison ; correctifs : `/schools/[id]/pricing` (`program.schoolId`, `program.campuses`), `/rankings` (`program.school`, `program.campuses`, défaut 50 passé à `parsePagination`), `parsePagination(searchParams, defaultLimit)`. Les deux requêtes corrigées passent la validation du vrai client Prisma (sonde vers `127.0.0.1:9`, échec à la connexion seulement). **P2** : `test/api/admin-schools.test.ts`, `admin-programs.test.ts`, `admin-records.test.ts` (400, 404, cas nominal par handler ; 401 partout ; cascades → 403 pour un MODERATOR ; JSON mal formé → 500 écrit en clair, décision 10), `public-schools.test.ts` ; correctifs 11 à 14 (`readOptionalNumbers` et `invalidNumbersMessage` dans `lib/request-body.ts`). **Banc** : `test/helpers/prisma-schema.ts` (`schemaErrors`, sur `Prisma.dmmf`) posé en `afterEach` sur les 7 fichiers de routes existants : 100 tests, aucun écart ; contrôle positif fait (un champ disparu fait échouer le test). `test/helpers/requests.ts`. **Smoke** : `scripts/smoke-local.ts` + module pur `scripts/lib/smoke-checks.ts` (testé : `test/smoke-checks.test.ts`, dont l'alignement sur `app/api/v1`), `npm run smoke` ; rodé contre un faux site sur `127.0.0.1` et contre un port fermé ; **pas joué contre `npm run dev`**. **Fin d'étape** : `npm test` **570** verts (+25 sous-tests), `test:ts` **482** verts, `typecheck` propre, `lint` 0 erreur et **112** avertissements (115 avant : trois `any` retirés, aucun nouveau). **Garde réseau** (greffon pytest ; `--import` pour `node --test`, chargé dans les 34 processus fils ; contrôle positif vers `192.0.2.1` et un nom `.invalid` refusé) : **0 tentative** sur les deux suites. Branche : `origin/localpython` lu par le MCP GitHub (`git fetch` bloque ici sur les identifiants) : `048d945`, aucune divergence. Docs : `architecture.md` (en-tête, §2.3, §4, §5.4, §6.2, §7.4, §8.1, §8.4, §8.8, §9 EC 35 à 39, §10.1, §10.2, §10 bis : inventaire, banc, garde réseau, *Smoke local*, CI), `API-rest.md`, `edgecase.md` (EC 35 à 39), README, `CLAUDE.md`, commentaire de `.github/workflows/ci.yml`. | **Écarts** : (1) `test/helpers/prisma-schema.ts` et `requests.ts`, hors plan : le faux Prisma accepte tout, et c'est ce contrôle qui a vu `program.campus` ; (2) le smoke est coupé en deux (`scripts/lib/smoke-checks.ts`, pur et testé ; `scripts/smoke-local.ts`, les appels), comme `db-migrate.ts`, et a sa commande `npm run smoke` ; (3) le smoke tolère un 404 « Statistiques introuvables » sur `/stats` (noté « absent ») et saute `/campuses/[id]` sans campus : une donnée manquante n'est pas une panne ; il refuse toute adresse non locale ; (4) décision 12 : à la modification, un nom ou un domaine fourni vide est refusé, alors qu'il était ignoré en silence ; (5) décision 13 : un `0` numérique dans les durées d'un programme vaut 0 (il valait `null`), `parseInt` en base 10 ; le contrôle des statistiques précède la lecture de l'école ; (6) `API-rest.md` disait `/stats` « tableau » : c'est un objet, doc corrigée. **Surprises** : (a) Prisma refuse `NaN` dans `skip`/`take` (« Argument missing ») mais l'écrit en `NULL` dans `data` (SQL capturé par un faux adaptateur, sans base) ; (b) le modèle de données d'exécution de Prisma 7 ne dit pas si une relation est une liste : `schemaErrors` contrôle les noms, pas la forme des filtres ; (c) **les exemples de réponse de `/api-docs` (`app/api-docs/endpoints.ts`) sont fictifs** sur plusieurs routes (champs de `/stats`, tarifs groupés par programme, `/rankings` avec `ranking_name` et `year` en tête et marqués obligatoires) : non touché, **à soumettre au propriétaire** ; (d) `git fetch` attend des identifiants dans ce terminal. **Reste** : validation du propriétaire ; `npm run smoke` contre `npm run dev`, avec son accord ; commit et push à sa demande, puis CI ; question des exemples de `/api-docs` ; suite possible de la décision 10. Ne pas commencer l'étape 8. |
| 2026-10-15 | 7 | **Commit et push demandés par le propriétaire**, avec le prompt de l'étape 8 pour un autre agent : l'étape 7 est tenue pour validée. Rien d'autre ne change dans le code depuis la ligne précédente. | **Ouverts pour l'étape 8 ou au-delà** : `npm run smoke` contre `npm run dev` (accord à demander) ; exemples fictifs de `/api-docs` (deux options, recommandation : les corriger) ; décision 10 (JSON mal formé → 500 sur le CRUD admin) ; empreinte du commit et état de la CI à relever par l'agent suivant. |
| 2026-10-15 | 7 | **Commit `dae8fd6` poussé** (`git -c credential.username=Anton1P push` : Git Credential Manager connaît deux comptes GitHub et ne peut pas demander lequel). **CI rouge** sur `Tests Python` : `test_gemini_cascade.py::test_daily_quota_waits_for_pacific_midnight` (« 60.0 not greater than 3600 ») ; les jobs TypeScript et Lint tournaient encore. Test antérieur à l'étape (`3a1394b`, septembre) qui lisait l'heure réelle : la CI est passée à 23 h 59 PDT, où le délai jusqu'à minuit Pacifique vaut le plancher de 60 s. Code juste, reproduit en local en passant l'heure. **Décision du propriétaire** (option recommandée) : figer l'horloge. Assertion gardée (et précisée : 14 h exactement à 10 h Pacifique), nouveau test du compte à rebours (30 min, plancher, heure d'hiver). `npm test` **571** verts (+25 sous-tests). Commit `fix(test)` qui suit `dae8fd6`. | **Écart** : correction d'un test hors étape 7, sur décision. **Reste** : vérifier la CI des deux commits ; ouverts : smoke contre `npm run dev`, exemples de `/api-docs`, décision 10. |
| 2026-10-15 | 8 | **Début de l'étape 8**, sur le poste (Windows, Node 24.21). Départ : `localpython` = `origin/localpython` = `6315a95` après `git -c credential.username=Anton1P fetch origin` (rien à rebaser), arbre propre. **CI de `6315a95`** (run `38696796855`, lu par le MCP GitHub) : `Lint, Types & Migrations`, `Tests TypeScript` et `Tests Python` **verts**. Relevés : `npm test` 571 verts (+25 sous-tests), `test:ts` 482, `typecheck` propre, `lint` 0 erreur et 112 avertissements. Session sur Opus 5.5 ; le niveau d'effort n'est pas vérifiable par l'agent. **Décisions du propriétaire**, demandées avant d'agir (règle 4) : (1) exemples fictifs de `/api-docs` : **option A**, les aligner sur les réponses réelles **avant le déploiement**, dans une tâche à part, hors étape 8 ; (2) `npm run smoke` contre `npm run dev` : **accordé** ; (3) décision 10 (JSON mal formé → 500 sur le CRUD admin) rappelée, rien à faire. | Étape en cours (cette ligne est suivie du compte rendu de fin d'étape). |
| 2026-10-15 | 8 | **Étape 8 faite (documentation et vérifications ; rien de déployé).** **Smoke** : `npm run dev` seul (ni backend, ni `uvicorn`), puis `npm run smoke`. Premier passage : 14 bons, **5 en échec**, 1 absent. Les 5 pages (`/`, `/contribute`, `/api-docs`, une fiche école, un programme) étaient marquées « page 404 de Next » alors qu'elles répondaient 200 avec le bon titre (script hors dépôt) : `next dev` 16.3.8 met la phrase « This page could not be found » dans la charge RSC (`<script>`) de **chaque** page. **Défaut hors plan, exposé au propriétaire (règle 4), option recommandée retenue (corriger)** : test d'abord (`test/smoke-checks.test.ts`, 2 tests vus en échec), puis `nextErrorMarker` ne cherche plus la phrase que hors `<script>` (`scripts/lib/smoke-checks.ts`). Second passage : **19 bons, 0 échec, 1 absent** (`/stats` d'EM Strasbourg). Serveur arrêté, port 3000 libre, aucune URL de base dans son journal. **Inventaire des variables** (`process.env` de `app/`, `lib/`, `proxy.ts`, `next.config.ts`, `prisma.config.ts`, plus ce que `next-auth` 4.24.15 lit seul : `NEXTAUTH_SECRET` ou `AUTH_SECRET`, `NEXTAUTH_URL`, `NEXTAUTH_URL_INTERNAL`, `VERCEL`, `VERCEL_URL`, `AUTH_TRUST_HOST`) : **aucune variable hors des trois listes** du plan, en plus des variables que Vercel pose lui-même. **Intégration Neon** (documentation Neon, *Vercel-Managed Integration*) : `DATABASE_URL` poolée, `DATABASE_URL_UNPOOLED`, `PG*`, `POSTGRES_*` ; seul `DATABASE_URL` est lu : pas de saisie à la main, pas de préfixe. Projet Vercel **absent** (MCP, `list_projects` sans `teamId` : seulement les deux projets étrangers). **Build** : `git worktree` jetable de `6315a95` dans le scratchpad (aucun `.env*`, aucune variable de l'application dans le shell), `npm ci`, `npm run build` avec pour seule variable une `DATABASE_URL` morte (`127.0.0.1:9`) : **vert**, aucune page ne lit la base au build (`/`, `/contribute`, `/api-docs`, `/admin/login` statiques). Worktree supprimé. **Hobby** (documentation Vercel) : avec Fluid compute, actif par défaut, 300 s par défaut et au maximum ; la transaction de 60 s de `validate` tient, aucun `maxDuration` nécessaire ; ni `vercel.json` ni tâche planifiée. **Migrations** : `npm run db:status` (WebSocket, lecture seule) → 10 appliquées, 0 en attente. **Comptes** (MCP Neon, `SELECT`) : 1 ADMIN, 1 MODERATOR, donc pas de seed. Fin d'étape : `npm test` 571 (+25 sous-tests), `test:ts` **483** (+1), `typecheck` propre, `lint` 0 erreur et 112 avertissements. Docs : `memory-deploiement-vercel.md` réécrit (§0, variables, intégration Neon, migrations et comptes, build, Upstash, Hobby, décisions, ordre des opérations, vérifications ; la section sur la CI éphémère est inchangée), `architecture.md` (en-tête, §1.2, §2.1, §2.2, §10.3, §10 bis *Tests* et *Smoke local*), `task.md` (tableau d'état, 11.2), `.env.example` (`DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_URL`, Upstash), README (Upstash, renvoi au mémo, décompte), `CLAUDE.md`. | **Écarts** : (1) une correction de code hors plan (règle du smoke), sur décision du propriétaire ; (2) `NEXTAUTH_URL` est obligatoire **en Production seulement** : sur Vercel, next-auth déduit l'origine de la requête (`VERCEL`), et une valeur de production en Preview y renverrait la connexion vers la production ; (3) `DIRECT_URL` passe dans « jamais sur Vercel » : l'ancien mémo l'exigeait « pour le build », mais le build ne se connecte pas ; (4) le mémo ajoute deux décisions (§8) et un réglage de région, absents de la liste du plan, parce qu'ils conditionnent le premier déploiement. **Surprises** : (a) `origin/main` est à `e4c09cf` (2 septembre), **46 commits derrière `localpython`**, et Vercel déploie `main` en production par défaut (décision 8.1) ; (b) une préversion exige `DATABASE_URL` pour builder et, base connectée, écrit dans la production (décision 8.2) ; (c) région par défaut d'un projet Vercel : `iad1` (Washington), alors que Neon est à Londres : `lhr1` recommandée ; (d) les noms injectés par l'intégration Upstash du Marketplace ne sont pas documentés ; les anciens `KV_REST_API_*` ne sont pas lus : création directe sur la console Upstash recommandée ; (e) le processus `next` a survécu à l'arrêt de la tâche de fond : arrêté par son PID, après vérification de sa ligne de commande ; (f) `git worktree remove` échoue sous Windows (« Filename too long ») : dossier supprimé par PowerShell (`\\?\`), puis `git worktree prune` ; (g) au build, `dotenv` journalise `injected env (0) from .env.local`, sans effet ; (h) **hors étape, signalé** : le titre des fiches porte deux fois « — EduData France » (`app/layout.tsx` ajoute le suffixe par son modèle, `app/schools/[id]/page.tsx:70` et `programs/[pid]/page.tsx:58` aussi). **Reste** : validation du propriétaire ; décisions 8.1 et 8.2 du mémo ; tâche `/api-docs` (option A) avant le déploiement ; création du projet Vercel et déploiement par le propriétaire (mémo §9), puis vérification par le MCP Vercel, et nom et id `prj_…` à noter dans `CLAUDE.md` ; commit et push à sa demande. Ne pas commencer l'étape 9. |
| 2026-10-15 | hors plan | **Les deux tâches hors étape, à la demande du propriétaire** (« fais ce que tu recommandes »), avant toute validation de l'étape 8. **(1) `/api-docs` aligné** (option A, décidée en début d'étape 8) : à la relecture, presque tous les exemples étaient fictifs, au-delà des trois cas relevés à l'étape 7 : `school_id` au lieu de `schoolId`, `students_count`, `degree`, `duration`, `amount`, `places`, champs absents. Autres écarts : `search` de `/schools` annoncé sur le domaine (le nom seulement) et celui de `/programs` sur le programme seul (aussi l'école) ; URL d'exemple codée en `http://localhost:3000` ; filtre `!p.name.includes("id")` qui retirait `ids` (exemple de comparaison → 400) et `campus_id` ; identifiant d'un campus (`/schools/[id]/campuses`) ou d'un programme (`/schools/[id]/programs`, `/schools/[id]/pricing`) posé à la place de celui de l'école. Test d'abord : `test/api-docs.test.ts`, vu en échec (5 tests sur 6), confronte chaque fiche à sa route. Il vérifie les routes couvertes, les paramètres lus par la route, « obligatoire » par l'appel (400 sans lui, 200 sans les facultatifs) et la forme de l'exemple. Pour la forme, un faux Prisma « écho » rend exactement les champs sélectionnés, en liste selon `schema.prisma`, et la route fait son propre travail. Il vérifie aussi l'URL d'exemple. Contrôle positif : une liste devenue objet, puis un champ imbriqué renommé, font échouer le test. Code : `app/api-docs/endpoints.ts` réécrit (école fictive « École de Commerce Exemple », identifiants au format UUID, `in: "path" \| "query"`, `example`, `buildSampleUrl`, introduction sur la limite de débit et le format d'erreur) ; `app/api-docs/page.tsx` : URL d'exemple par `buildSampleUrl` et adresse lue par `useSyncExternalStore` (vide au rendu serveur, sans écart d'hydratation). **(2) Titre en double** : test d'abord, `test/page-titles.test.ts` (vu en échec), puis `app/schools/[id]/page.tsx` et `programs/[pid]/page.tsx` laissent le suffixe au modèle d'`app/layout.tsx` (guide `generate-metadata.md` de Next 16 lu). Vérifié dans Chrome sur `npm run dev` : `/api-docs` seulement, page statique qui ne lit pas la base ; l'introduction, puis la comparaison (`?ids=…,…`, `ids` marqué obligatoire, exemple JSON réel) ; aucune erreur dans la console après rechargement. Serveur arrêté, port 3000 libre. Fin : `npm test` 571 (+25 sous-tests), `test:ts` **491** (+8), `typecheck` propre, `lint` 0 erreur et **109** avertissements (−3 : les `any` d'`endpoints.ts`). Docs : `architecture.md` (§7.3, §10 bis *Tests*), `API-rest.md`, mémo de déploiement (§11, §12), README, `CLAUDE.md`. | **Écarts** : (1) la tâche `/api-docs` déborde des trois cas de l'étape 7 : toute la page était fausse, et l'URL d'exemple aussi ; (2) une école fictive remplace EMLV dans les exemples, pour ne pas prêter des chiffres inventés à une vraie école. **Non vérifié** : les titres des fiches dans un navigateur (ces pages lisent la base, et l'accord du smoke ne couvrait que son passage) ; le test statique et le modèle du layout les tiennent. **Reste** : validation de l'étape 8 et de ces deux tâches ; commit et push à sa demande. |
| 2026-10-15 | 8 | **Le propriétaire demande le commit, le push sur `localpython` et le prompt de l'étape 9** : l'étape 8 et les deux tâches hors plan sont tenues pour validées. Un seul commit pour l'étape et les deux tâches : elles touchent les mêmes documents (journal, `CLAUDE.md`, `architecture.md`, README, mémo). Prompt de l'étape 9 rédigé et remis au propriétaire. **Recommandation de l'agent, donnée au propriétaire** : déployer après l'étape 9, une fois la branche Neon `dev` (D7) en place, plutôt qu'avant (la base locale est aujourd'hui aussi la production) ou qu'à la fin du développement (`main` prend du retard). | Empreinte du commit et état de sa CI à relever par l'agent de l'étape 9. Prochaine session : étape 9. |
| 2026-10-15 | 9 | **Début de l'étape 9**, sur le poste (Windows, Node 24.21, Python 3.14 du venv). Départ : `localpython` = `origin/localpython` = `10a3bf3` (`git -c credential.username=Anton1P fetch origin`), arbre propre. CI de `10a3bf3` (run `38702345765`) **verte sur ses trois jobs** (MCP GitHub). Relevés de départ : `npm test` 571 verts (+25 sous-tests), `test:ts` 491, `typecheck` propre, `lint` 0 erreur et 109 avertissements. Neon (MCP, lectures) : une seule branche, `main`, limite de l'offre gratuite à 10 branches ; sur `main`, 4 jobs `failed` (`manual`), aucun actif, aucun ticket `Pending_AI`, aucune contribution publique (le seul `Failed` est un `Automated_AI`). Questions de début d'étape posées au propriétaire (branche `dev`, branche du poste après l'étape, dépenses). | En attente de ses réponses : rien n'est lancé. |
| 2026-10-15 | 9 | **Décisions du propriétaire (règle 4), option recommandée à chaque fois.** (1) **D7 : branche `dev`**, créée par l'agent par le MCP Neon (`create_branch`, avec son accord explicite, une seule fois) : `dev`, id **`br-rapid-bird-abck4fdr`**, endpoint **`ep-falling-breeze-abibnpc4`** (hôtes `ep-falling-breeze-abibnpc4[-pooler].eu-west-2.aws.neon.tech`), parent `main` au LSN `0/A5AB248`, calcul 0,25 CU. Relevé sur `dev` (`SELECT`) : identique à `main` (10 migrations finies, aucune annulée ; 4 jobs `failed` ; tickets 6 `Validated`, 1 `Rejected`, 1 `Failed`, tous `Automated_AI` ; 1 ADMIN, 1 MODERATOR). Notée dans `CLAUDE.md` (*MCP Neon*), cible par défaut des lectures. (2) **Après l'étape : `dev` pour les essais et les vérifications, `main` pour le travail réel**, bascule à documenter. (3) **Dépenses** : contribution de test puis passe due réelle, accord demandé séparément au moment de chacune. (4) Session ADMIN : identifiants lus dans les variables Windows `APPVC_ADMIN_*`, jamais affichés. | Bascule des `.env*` vers `dev` : au propriétaire (règle 3). Script de contrôle sans secret prêt hors dépôt (n'affiche que l'hôte ; rodé sur de faux fichiers, faux mot de passe absent de la sortie), lancé seulement avec son accord. |
| 2026-10-15 | 9 | **Bascule du poste vers `dev`, faite par l'agent sur autorisation explicite du propriétaire** (« je te donne l'autorisation d'aller dans mes fichiers env et aussi de les modifier »). **Écart** à la règle 3 et à *Secrets* de `CLAUDE.md`, décidé par le propriétaire pour cette bascule. Aucune valeur affichée : un script hors dépôt (`switch-branch.mjs`, rodé sur de faux fichiers : passe à blanc sans écriture, commentaires et autres variables intacts, aller-retour identique octet pour octet) remplace seulement l'identifiant d'endpoint `ep-twilight-forest-ab9qjkm7` → `ep-falling-breeze-abibnpc4` sur les lignes actives `DATABASE_URL` et `DIRECT_URL` : **5 lignes** (`.env.local` : 2, `.env` racine : 2, `backend/.env` : 1 ; rien dans `.env.development.local` ni dans les variables Windows). Contrôle par `env-hosts.mjs` (hôtes seulement) : Next.js, `db:status` et le backend visent `dev`. **Point 1** : `npm run db:status` → WebSocket vers `ep-falling-breeze-abibnpc4` (`DIRECT_URL`), **10 appliquées, 0 en attente** ; le mot de passe hérité de `main` vaut sur `dev`. **Point 2, relevé avant lancement** (`dev`, `SELECT`) : 4 jobs `failed` (`manual`, Phase 1, 28-29 septembre, libellé de passage complet : rétention 400 j, la purge du démarrage ne les touche pas), aucun job actif, aucun `Pending_AI`, aucune contribution publique. | **Surprise** : le propriétaire a collé dans le chat l'URL de `main`, mot de passe compris (non recopiée ici). Recommandation donnée : changer le mot de passe de `neondb_owner` dans la console Neon (sur `main` au moins ; `dev` l'a hérité), après l'étape 9 et avant le déploiement Vercel. |
| 2026-10-15 | 9 | **Points 2 à 4 vérifiés sur `dev`, avec l'accord du propriétaire pour `npm run local`.** Pilotage : Chromium par `playwright-core` 1.63.0 installé hors dépôt (scratchpad), Chromium 1243 en cache ; session ADMIN ouverte une fois avec `APPVC_ADMIN_*` lus dans le registre, jamais affichés, puis réutilisée (état de session dans le scratchpad) ; toute boîte de dialogue refusée d'office. **Point 2** : `npm run local` → « Backend prêt (version 0.5.0) », Next.js prêt en 0,8 s ; `/health` `{"status":"ok"}` ; `pipeline-status` (route Next, session ADMIN) : `startup_errors` vide, base `connected`, traitement des contributions passé une fois en `success` (« aucune contribution en attente » : 0 dépense), synchro `/usage` `ok` pour 4 clés (1 000 crédits chacune, 0 consommé, mois à 0/7 000) ; `/admin/cron` « prêt », **9 passes dues** (en tête : ESSCA P1 `never` ~30, Essec P1 `never` ~30, EMLV P1 `retry_after_failure` ~30, Em Lyon P2 ~785, Em Normandie P2 ~720), historique lu sur `dev`. **Point 3** : « Simuler » → « Simulation : 1 passe partirait — ESSCA, Phase 1, ~30 crédits » ; `PipelineJob` (MCP, `SELECT` sur `dev`) : 4 `failed` avant **et** après, aucun statut changé (dernière mise à jour : 29 septembre), aucun job mort à clore ; crédits du mois toujours 0 ; inscrite sous `last_runs.run_due_passes_dry_run`, `last_run` resté `null`. **Point 4** : backend arrêté par son PID (aucune passe en cours ; processus vérifié par sa ligne de commande) → `/admin/cron` « Backend local non lancé », cite `npm run local`. Puis Next dev arrêté, port 3000 libre ; `next build` puis `next start` lancés par un lanceur Node hors dépôt qui passe **`FASTAPI_URL` vide** dans l'environnement du processus (`.env.local` non modifié). Piste vérifiée avant usage : `@next/env` ne prend la valeur d'un fichier que si la variable est `undefined` dans le processus, `fastapiUrl()` traite le vide comme absent, et l'enfant Node reçoit bien `""` (PowerShell, lui, supprime une variable vide). Build vert ; `/admin/cron` → « Pilotage depuis le poste local » **visible en 0,6 s** (chargement compris), historique des 4 jobs lu sur `dev` ; `pipeline-status` → 503 `BACKEND_LOCAL_ONLY` en 20 ms ; seule erreur de console : ce 503. `next start` arrêté ; `next-env.d.ts` réécrit par le build (`.next/dev/types` → `.next/types`), remis en état par `git checkout` ; ports 3000 et 8000 libres. | Le discriminant du point 4 tient : si Next avait lu la `FASTAPI_URL` de `.env.local`, l'écran aurait affiché « non lancé » (backend arrêté), pas « pilotage depuis le poste local ». Reste : point 5 (dépenses, accord séparé pour chacune). |
| 2026-10-15 | 9 | **Point 5, contribution de test : faite avec l'accord du propriétaire, résultat attendu NON atteint.** Backend relancé (`npm run local`, prêt ; Next.js prêt en 0,6 s). Contribution sur `/contribute` en local : Em Lyon, « Accréditation », `https://em-lyon.com/en/about-emlyon-business-school/institution` (page vérifiée avant : cite « triple accreditation from EQUIS, AACSB, and AMBA », aucune donnée personnelle), description « Contribution de test (étape 9) ». `POST /api/contribute` 200 à 08:47:23 UTC, ticket `cb9032a5…` en `Pending_AI` ; bandeau « 1 contribution attend le traitement par le backend local » vu sur `/admin/cron`. Journal du backend (copié par le propriétaire depuis la fenêtre ; le tampon lisible par programme n'a que 30 lignes) : passage de 08:48:06 ; Tavily `extract` 1 URL réussi (1,2 s) ; Gemma 26B (compatibilité) : 500 INTERNAL (34 s), puis 200, compatible (86 s) ; Gemma 31B (extraction) : **3 × 500 INTERNAL**, puis 200 avec **la bonne réponse, une liste de 3 objets** (EQUIS, AACSB, AMBA, `source_url` exacte) ; `call_gemma` n'attend qu'un objet → `GemmaParsingError` → « erreur permanente » → **ticket supprimé** à 08:51:46 (4 min 23 s après la soumission). Passages de 08:49, 08:50 et 08:51 sautés (`max_instances` = 1). Rapport du backend : « Rejetés (Rejected) : 1 » alors que le ticket est supprimé. `pipeline-status` n'en garde rien : `last_runs` est écrasé une minute plus tard par « aucune contribution en attente ». **Dépense** : 1 crédit Tavily (`month_credits_used` 0 → 1 ; la synchro `/usage` de 08:52 et 08:57 lit encore 0/1000 : retard connu de `/usage`), **6 appels Gemma** (2 × 26B, 4 × 31B), dont 2 seulement ont répondu. | **Défauts hors plan, exposés au propriétaire (règle 4)** : voir la ligne suivante pour ses décisions. |
| 2026-10-15 | 9 | **Trois défauts hors plan révélés par la contribution de test ; décisions du propriétaire, option recommandée à chaque fois.** **C1** (le plus grave) : la consigne d'extraction `Accreditation` du crowdsourcing (`ACCREDITATION_SYSTEM_PROMPT`, `backend/crowdsourcing/processor.py:181`) décrit un objet unique et ne dit rien d'une page qui en cite plusieurs, cas ordinaire ; `call_gemma` refuse une liste de plusieurs objets (`backend/ai/gemma_client.py`, voulu pour ne rien jeter en silence) ; une extraction juste devient « erreur permanente » et la contribution est supprimée : probablement systématique pour cette catégorie. Décision **A** : la consigne demande toutes les accréditations, et le backend crée **un ticket par accréditation**, liés par le même `submission_group_id` ; inbox et `validate` inchangés. **C2** : un passage qui traite des contributions ne laisse pas de trace hors de la fenêtre du backend (`last_runs` écrasé au passage suivant ; le rapport range une suppression sous « Rejetés »). Décision **A** : le registre garde aussi le dernier passage qui a traité au moins un ticket, montré par `pipeline-status` et `/admin/cron` ; le rapport dit « supprimés ». **C3** (coût) : une `GemmaAPIError` laisse le ticket en `Pending_AI` ; chaque passage suivant repaie l'extraction Tavily, sans borne. Décision **A** : une erreur d'API Gemma compte comme une tentative, avec le délai et le plafond des tickets `Failed` (`CROWDSOURCING_RETRY_DELAY_MINUTES`, `CROWDSOURCING_MAX_ATTEMPTS`). **Calendrier, décision A** : finir l'étape 9 (passe due réelle, accord séparé), puis corriger C1 à C3 dans une tâche hors plan dédiée, tests d'abord, avant le déploiement Vercel, et rejouer la contribution d'accréditation sur `dev` (~1 crédit) ; la case de l'étape 9 reste décochée jusque-là. | Ne rien corriger pendant l'étape 9. |
| 2026-10-15 | 9 | **Passe due réelle, avec l'accord séparé du propriétaire, puis fin de session.** « Simuler » rejoué d'abord : « 1 passe partirait — ESSCA, Phase 1, ~30 crédits ». Avant (`dev`, `SELECT`) : 4 jobs `failed`, 8 tickets `Automated_AI`, ESSCA sans campus. « Lancer 1 passe due » à 09:08 UTC : boîte de confirmation « Lancer au plus 1 passe due ? Aperçu : ESSCA, Phase 1, ~30 crédits », acceptée par le script pour ce seul clic ; message « 1 passe lancée : ESSCA, Phase 1, ~30 crédits » ; synchro `/usage` `ok` à 09:08:45. Job `Phase 1 — Cartographie (Auto)`, `source = rotation`, suivi dans l'historique (lecture du catalogue → Research → structuration) : **`completed` en 7 min 5 s**, `result.success` vrai, **un ticket `Program_Discovery` en `Pending_Admin`** (`28f121aa…`, 11 campus, 22 programmes dont 20 qualifiés, 4 titres de catalogue, `diff_against_base` vide, collecte du rattachement `disabled`, rapport Research de 13 772 caractères), visible dans l'inbox, **non validé**. `rotation.last_run` `success` ; passes dues 9 → 8 (en tête : Essec P1). Après : 5 jobs (1 `completed` `rotation`, 4 `failed` `manual`), 9 tickets. **Smoke** sur `dev` (accord du propriétaire) : 19 bons, 0 échec, 1 absent (`/stats` d'EM Strasbourg), comme à l'étape 8. Backend et Next.js arrêtés (PID vérifiés par leur ligne de commande), ports 3000 et 8000 libres, aucun processus restant ; état de session ADMIN et copie du tampon supprimés du scratchpad. **Dépenses réelles de l'étape** : Tavily ~30 crédits (1 pour l'`extract` de la contribution, ~29 pour la passe ESSCA au compteur local de la clé `…7Ad6tT` ; `/usage` n'étant pas en temps réel, le tableau de bord Tavily fait foi) ; Gemma 6 appels (2 × 26B, 4 × 31B, dont 4 en 500) ; cascade Gemini de la Phase 1 ESSCA (nombre d'appels dans la fenêtre du backend seulement) ; Neon : une branche de plus. Fin : `npm test` 571 (+25 sous-tests), `test:ts` 491, `typecheck` propre, `lint` 0 erreur et 109 avertissements : inchangés, aucun code modifié. Docs : `CLAUDE.md` (*Phase en cours*, *MCP Neon*), `manual_testing_cron.md` (bandeau, §1.3 bascule `dev` ↔ `main`, §4.2 trace des contributions), mémo de déploiement (§0 : deux branches ; §8.2), `architecture.md` (§6.2 : défauts C1 à C3 ; §10 bis : vérification contre le vrai backend), ce plan (statut, §0, étape 9). | **Case de l'étape 9 non cochée** (décision du propriétaire) : la contribution doit atteindre `Pending_Admin`, après correction de C1 à C3. **Écarts** : (1) `.env*` lus et modifiés par l'agent, sur autorisation explicite du propriétaire, sans rien afficher ; (2) défauts C1 à C3 non corrigés pendant l'étape (décision du propriétaire). **Surprises** : (a) URL de `main` avec mot de passe collée dans le chat par le propriétaire : changer le mot de passe de `neondb_owner` (console Neon) avant le déploiement ; (b) API Google en 500 sur 4 appels Gemma sur 6 ; (c) le journal du backend ne vit que dans sa fenêtre, et le tampon lisible par programme (ConPTY) n'a que 30 lignes ; (d) Git Bash convertit un argument `/admin/inbox` en chemin Windows : passer par PowerShell. **Reste** : validation du propriétaire ; tâche hors plan C1 à C3 (tests d'abord), puis contribution rejouée (~1 crédit) ; ticket ESSCA en `Pending_Admin` sur `dev`, à laisser ou à juger par le propriétaire ; poste toujours sur `dev` (retour sur `main` : §1.3 de la fiche) ; fenêtre du backend restée ouverte, à fermer ; commit et push à sa demande. Ne pas commencer l'étape 10. |
| 2026-10-15 | 9 | **Question du propriétaire : pourquoi Gemma dans le crowdsourcing, alors que la cascade Gemini priorise gemini-3.8-flash, 3.7, 3.6… ?** Constat de l'agent : la cascade (`MODEL_LADDER`, `backend/ai/gemini_client.py`) ne sert qu'au pipeline (Phases 1 et 2, rattachement campus) et ne contient pas Gemma ; le crowdsourcing appelle Gemma directement (26B compatibilité, 31B extraction), seul modèle de ce chemin. Origine : le cahier des charges du 19 mai 2026 (premier commit) nomme Gemma ; la cascade est arrivée le 3 septembre (`e47cf7c`) pour le pipeline seul, le crowdsourcing n'y a jamais été branché ; aucune raison écrite. **Décision C4 du propriétaire (option A, recommandée ; il modifie le cahier des charges)** : le crowdsourcing passe par la cascade Gemini, compatibilité comprise (modèles « lite » d'abord), aux mêmes planchers par catégorie que le pipeline ; Gemma en dernier recours seulement, cascade épuisée. À faire dans la même tâche hors plan que C1 à C3 (C4 change la façon de corriger C1 : un schéma JSON « liste »). **Renommage** : les défauts de l'étape 9, d'abord appelés D1 à D3, deviennent **C1 à C3** (C pour crowdsourcing) pour ne pas se confondre avec les décisions D1 à D7 du plan ; renommés dans toutes les lignes écrites ce jour. Docs : cahier des charges (en-tête, §3, workflow A étape 7 : exigence modifiée, « à mettre en œuvre »), `architecture.md` §6.2 (C4). | **Écart** : le §10 du plan tenait le cahier des charges pour historique ; modifié à la demande explicite du propriétaire. Aucun code touché. **En attente** : validation de l'étape 9 ; commit et push à sa demande. |
| 2026-10-15 | 9 | **Étape 9 validée par le propriétaire, en l'état** ; il demande le commit, le push et le prompt de l'agent de la tâche C1 à C4. La case de l'étape 9 reste décochée : elle se coche quand la contribution d'accréditation, rejouée après C1 à C4, atteint `Pending_Admin`. **C1 retranché par le propriétaire** : en préparant le prompt, l'agent a constaté que sa présentation de C1 était fausse. L'option « une liste dans un seul ticket » ne touche ni l'inbox ni `validate` : `validateAccreditation` (`app/api/admin/inbox/[id]/validate/route.ts`) accepte `accreditations[]` ou un objet unique, l'écran de l'inbox édite une liste (« Accréditations et Labels détectés »), et la Phase 2 produit déjà cette forme avec `ACCREDITATION_EXTRACTION_SCHEMA` (`backend/ai/extraction_schemas.py`). Nouvelle décision : **C1 = un seul ticket qui porte `accreditations: [...]`**, au lieu d'un ticket par accréditation. Docs : `architecture.md` §6.2, `CLAUDE.md`. | Prochaine session : tâche hors plan C1 à C4, sur `dev`. |
| 2026-10-15 | hors plan | **Tâche C1 à C4 (le crowdsourcing passe par la cascade Gemini et ne perd plus rien), codée ; vérification réelle NON faite.** Départ : `localpython` = `origin/localpython` = `fb45980` (`git -c credential.username=Anton1P fetch origin`), CI de `fb45980` (run `38715091268`) **verte sur ses trois jobs** (MCP GitHub). Relevé de départ : `npm test` 571 (+25 sous-tests), `test:ts` 491, `typecheck` propre, `lint` 0 erreur et 109 avertissements. **Décisions du propriétaire demandées avant de coder (règle 4), option recommandée à chaque fois** : (C3) **A**, une cascade épuisée ne consomme pas de tentative : le ticket attend la réouverture du premier modèle ; (« Modèle IA Principal ») **A**, afficher la chaîne réelle. **Code** : `gemini_client` (`lowest_first`, `ModelRegistry.seconds_until_available`) ; `backend/crowdsourcing/schemas.py` (schémas propres : compatibilité, Ranking et Capacity mono-programme en objet plat, trois schémas multi-programme ; Pricing, SchoolStats et Accreditation reprennent ceux du pipeline) ; `backend/ai/model_chain.py` (modèles Gemma en constantes, `describe_model_chain()`) ; `processor.py` : `_extract_with_cascade` (cascade au plancher de `MIN_TIER_BY_CATEGORY`, compatibilité par le bas ; Gemma 26B/31B **seulement** sur `ExtractionUnavailable`, jamais sur `GeminiError`), `ExtractionDeferred` + `_defer_ticket` (`Failed`, `processing_attempts` gardé, `deferred_count`, `retry_not_before_epoch` = max(60 min, réouverture du premier modèle)), porte `retry_not_before_epoch` dans le SQL de la file, `OUTCOME_VALIDATED`/`OUTCOME_REJECTED`, rapport `{tickets, validated, rejected, deleted, failed, deferred, quota_exhausted}` et console (« Supprimés », « En attente d'un modèle ») ; consigne et validation `Accreditation` : un ticket `{"accreditations": [...]}` (C1), repli Gemma sur la même forme ; `jobs.py` : `crowdsourcing.last_processed` (C2) ; `internal.py` : `ai_models` remplace `ai_model_*`. TypeScript : `lib/crowdsourcing-status.ts`, `lib/ai-models.ts`, blocs « Modèles IA » et « Contributions du public » de `/admin/cron` (Next 16 : guide `05-server-and-client-components.md` relu, composant client existant). **Fin** : `npm test` **635** (+25 sous-tests), `test:ts` **507**, `typecheck` propre, `lint` 0 erreur et 109 avertissements. Docs : `architecture.md` (§2.3, §4.1 bis, §6.2 dont l'encadré devenu historique, §7.4, §9 EC 40, §10.9, arborescence, décomptes), cahier des charges, `manual_testing_cron.md`, `edgecase.md` (n°7 et n°40), README, `CLAUDE.md`. **Lectures réelles faites** : `npm run db:status` → `ep-falling-breeze-abibnpc4`, 10 appliquées, 0 en attente ; `SELECT` sur `dev` : **aucun** ticket `Pending_AI` ni `User_Submission`. | **Écarts** : (1) **tests existants modifiés, parce que le contrat change** : `test_crowdsourcing_processor.py` (fixture qui épuise la cascade, ces tests tenant désormais le repli Gemma ; `test_api_error_keeps_pending_ai` devient `test_api_error_defers_the_ticket` : « reste en Pending_AI » était le défaut C3) ; `test_crowdsourcing_queue.py` (forme du rapport ; `api_errors` disparaît, une erreur d'API compte une tentative donc `failed`) ; aucun test affaibli, `test_gemini_cascade.py` intact ; (2) la compatibilité « par le bas » commence par `gemini-2.5-flash` (dernier de l'échelle, pas un « lite ») : `lowest_first` renverse l'échelle, sans notion de lite ; (3) `rejected` garde son nom mais ne compte plus que les `Rejected`. **Non fait** : vérification réelle (backend, contribution Em Lyon) en attente d'un accord séparé pour chaque action ; **case de l'étape 9 non cochée**. **À signaler (non corrigé)** : (a) **SchoolStats** : objet plat, une page qui donne plusieurs années ne livre qu'une année, sans règle « la plus récente » (aucune suppression, mais une année perdue en silence) ; (b) **aucun plafond sur les attentes** : une panne durable de Gemini et de Gemma repaie Tavily au plus une fois par fenêtre de 60 min par ticket (lisible dans `deferred_count`) ; (c) Gemma reçoit la même consigne que la cascade (avec sa description de structure) ; (d) tests TypeScript d'affichage écrits avant les libs mais jamais lancés avant elles ; tests Python vus en échec (import et 8 échecs). |
| 2026-10-15 | hors plan | **Décisions du propriétaire sur les sources des tickets (règle 4), option recommandée à chaque fois ; commit et push de C1 à C4 demandés.** Constat : la colonne `urls` d'un ticket `Automated_AI`, le bloc « Sources » de l'inbox, porte toutes les pages lues par Tavily Research, non les pages qui prouvent la donnée. En Phase 2, c'est la liste complète (`_insert_ticket`), sauf un classement qui a sa propre URL ; en Phase 1, la page catalogue plus toutes les sources Research (`phase1_research.py`) ; d'où des dizaines de liens, invérifiables. `validate` ne lit pas cette colonne : la couper ne change aucune donnée de production. **Décisions** : (1) **au plus 3 liens** dans le bloc « Sources », quitte à ce que des informations ne soient plus vérifiables ; (2) choisis **dans cet ordre, sans doublon** : les URL citées par les données extraites, puis le domaine officiel de l'école (et la page catalogue en Phase 1), puis le reste dans l'ordre de Tavily ; (3) coupés **à l'écriture du ticket**, par une seule fonction partagée par la Phase 1 et la Phase 2, et l'écran de l'inbox plafonné à 3 pour les tickets déjà en base ; (4) les **liens par ligne** (`source_url` de chaque programme, accréditation, ligne de rattachement…) **restent** ; (5) les URL des **contributions du public ne sont pas touchées**. À coder dans une tâche hors plan, tests d'abord, **avant** la recette de bout en bout : le prompt de la recette est remis au propriétaire, qui le garde pour après ; celui de la tâche « trois sources » aussi. La vérification réelle de C1 à C4 (contribution Em Lyon) passe dans la recette ; la case de l'étape 9 reste décochée jusque-là. | **Écart signalé au propriétaire** : la tâche C1 à C4 a été codée sur Sonnet 5.5, non sur Opus 5.5 en effort extra high (`CLAUDE.md`, *Modèle*). **Prochaine** : tâche « trois sources », puis recette de bout en bout. |
| 2026-10-15 | hors plan | **Décision du propriétaire sur la question ouverte des sources (règle 4), option recommandée par l'agent.** Constat : en Phase 1, chacun des 20 à 30 programmes d'un ticket `Program_Discovery` peut porter son propre `source_url` ; avec l'ordre retenu (URL citées, puis domaine officiel et catalogue, puis le reste), les URL citées prennent les 3 places et la page catalogue disparaît du bloc « Sources ». **Décision : en Phase 1, une place est réservée à la page catalogue.** Pour un ticket `Program_Discovery` qui a une page catalogue (`catalog_urls`), la **première** URL catalogue occupe la **première** des 3 places ; les 2 autres suivent l'ordre décidé (URL citées → domaine officiel → reste de Tavily), sans doublon (une URL catalogue déjà citée ne compte qu'une fois). Les autres URL catalogue, s'il y en a, concourent dans le groupe « domaine officiel ». Sans page catalogue, l'ordre décidé s'applique tel quel aux 3 places. La réserve ne vaut que pour `Program_Discovery` : le rattachement campus et la Phase 2 suivent l'ordre décidé sans réserve. | Pour l'agent de la tâche « trois sources » : point 4 de son prompt tranché, à coder et à tester tel quel (un test montre qu'un ticket Phase 1 à 25 programmes cités garde le catalogue en première place). Ligne non commitée : elle partira avec le commit de cette tâche. |
| 2026-10-15 | hors plan | **Tâche « trois sources » codée, testée et vérifiée à l'écran sur `dev`, avec l'accord du propriétaire.** Départ : `localpython` = `origin/localpython` = `12b6bb3` (`git -c credential.username=Anton1P fetch origin`), CI de `12b6bb3` (run `38720269205`) **verte sur ses trois jobs** (MCP GitHub) ; la ligne précédente (catalogue en tête), non commitée, tranche le point 4 du prompt : codée telle quelle, non resoumise. Relevé de départ : `npm test` 635 (+25 sous-tests), `test:ts` 507, `typecheck` propre, `lint` 0 erreur et 109 avertissements. Lectures `SELECT` sur `dev` (MCP Neon) : `official_domain` hétérogènes (`www.essca.eu/`, `em-strasbourg.com/fr`, `essec.edu/fr/`, `www.em-normandie.com`) ; ticket ESSCA `28f121aa…` à **28** URL, page catalogue en tête ; 25 URL par classement d'Em Normandie ; `ai_extracted_json` en `jsonb`. **Tests d'abord, vus en échec** : Python (module absent, puis 10 échecs des écritures une fois la fonction pure posée, pour la bonne raison : listes non coupées, paramètre absent), TypeScript (module absent, route sans le domaine, page non branchée). **Code** : `backend/pipeline/ticket_sources.py` (`select_ticket_sources`, `cited_urls`, `is_official_url`, `url_key`, pur) ; Phase 2 : la coupe dans `_insert_ticket`, `official_domain` **obligatoire**, passé aussi à `_write_ranking_tickets` et `_write_capacity_ticket` ; Phase 1 : ticket `Program_Discovery` coupé, pages catalogue en `priority_urls` ; `_park_report` inchangé (liste entière, test à l'appui) ; rattachement : coupe dans `run_campus_attachment_step`, avant `emit_ticket` ; `lib/ticket-sources.ts` (reflet + `displayedTicketSources`) ; `GET /api/admin/inbox` rend `schoolOfficialDomain` (**champ ajouté** : la liste ne rendait que le nom de l'école, et la règle « domaine officiel » en a besoin pour les tickets d'avant la coupe ; `GET /api/admin/inbox/[id]` inchangé) ; bloc « Sources » de `app/admin/inbox/page.tsx` (Next 16 : guide `05-server-and-client-components.md` relu ; module pur importé par un composant client). Cas partagés : `test/fixtures/ticket_sources_cases.json`. **Fin** : `npm test` **714** (+25 sous-tests), `test:ts` **540**, `typecheck` propre, `lint` 0 erreur et 109 avertissements ; les deux suites aussi sous **garde réseau** (greffon pytest et `--import` Node refaits dans le scratchpad, contrôle positif vers `192.0.2.1`) : 0 tentative. Aucun appel payant, aucun backend, aucune écriture en base. **Vérification à l'écran** (accord du propriétaire) : ports 3000 et 8000 libres ; `npm run dev` **seul** ; Claude in Chrome, onglet neuf, session ADMIN par le presse-papiers (variables Windows, jamais affichées ; presse-papiers vidé avant l'envoi) ; inbox de `dev` : le ticket ESSCA `28f121aa…` (28 URL en base, `SELECT`) n'affiche que **3 sources**, celles que calcule `lib/ticket-sources.ts` sur ses données : `https://www.essca.eu/programmes` (catalogue, en tête), `https://essca.eu/en/10-campuses-around-the-world`, `https://essca.eu/en/10-campuses-around-the-world/paris` (les deux premières URL citées, `source_urls` lu en premier dans le `jsonb`). Le formulaire des 11 campus est inchangé. Lecture seule : ni validation ni rejet ; après coup, `SELECT` : toujours 28 URL, `Pending_Admin`. Panneau fermé, déconnexion, onglet fermé ; tâche `npm run dev` arrêtée, ports 3000 et 8000 libres, aucun processus Next.js restant. Docs : `architecture.md` (en-tête, arborescence, §5.1, §5.3, §5.4, nouvelle §5.6, §6.2, §7.4, §9 EC 41, §10 bis), `edgecase.md` (EC 41), `manual_testing_cron.md` (§4.3, point 6), README (décomptes), `CLAUDE.md`, statut en tête de ce plan. | **Écarts et interprétations** : (1) **test existant modifié** : `test_phase2_writers.py`, ses 8 appels aux écrivains reçoivent `official_domain=…` (devenu obligatoire), assertions inchangées ; (2) **inbox, ticket déjà coupé** : un ticket du pipeline qui porte au plus 3 liens s'affiche tel qu'écrit ; lui réappliquer la sélection pouvait y faire entrer une URL citée que l'écriture n'avait pas retenue, d'autant que la charge relue en `jsonb` a perdu l'ordre de ses clés (`source_urls` avant `discovered_campuses`) ; (3) **découverte d'avant la coupe** : l'écran ne connaît pas `catalog_urls` ; sa première URL tient la place réservée, la Phase 1 ayant toujours écrit ses pages catalogue en tête (une découverte écrite sans catalogue voit sa première source Tavily prendre cette place) ; (4) **domaine officiel** : schéma, chemin, port et `www.` de tête retirés de `official_domain`, sans quoi `en.em-normandie.com` n'est pas officiel pour Em Normandie ; (5) **normalisations** en plus des trois prévues, justifiées : schéma en minuscules (RFC 3986 §3.1), blancs ASCII autour d'une URL retirés ; seul l'ASCII est replié, des deux côtés ; (6) rattachement : l'ordre suit les lignes, et non plus l'ordre alphabétique. **Surprises** : (a) le `jsonb` (point 2) ; (b) le formulaire d'une découverte n'a jamais affiché les `source_url` des programmes : ils restent dans la charge, sans lien par ligne à l'écran ; (c) un `source_url` qui n'est pas une adresse (« Le Figaro Étudiant ») est écarté : un classement dont c'était la seule source n'aurait plus de lien (EC 41) ; (d) `sed -i` de Git Bash retire les `\r` d'un fichier CRLF (README restauré, contenu inchangé) ; (e) **à soumettre au propriétaire (règle 4)** : sur le ticket ESSCA, l'extraction cite ses pages **sans `www.`** (`https://essca.eu/…`), Tavily **avec** (`https://www.essca.eu/…`). La règle des doublons ne replie pas `www.` : une même page peut donc prendre deux des trois places (un ticket neuf de Phase 2 ESSCA dont la page citée est aussi une source Tavily). Options : (A) replier un `www.` de tête de l'hôte dans la clé des doublons, des deux côtés, tests d'abord ; (B) garder la règle telle quelle. Recommandation de l'agent : A. **Non corrigé.** **Reste** : validation du propriétaire et décision sur (e) ; commit et push à sa demande ; puis la recette de bout en bout. |
| 2026-10-15 | hors plan | **Décision du propriétaire sur (e) : option A** (« fait le A »). **Doublons `www.`, tests d'abord** : `test/fixtures/ticket_sources_cases.json` reçoit 2 sélections tirées du ticket ESSCA (page citée sans `www.` et source Tavily avec ; catalogue cité sans `www.`) et 6 paires de doublons (`www.` et casse, avec port, `www2.`, `en.`, `www.www.`, `wwwessca.eu`) ; vus en échec dans les deux suites (5 en Python, 3 en TypeScript). **Code** : `url_key` (`backend/pipeline/ticket_sources.py`) et `urlKey` (`lib/ticket-sources.ts`) retirent **un** `www.` de tête de l'hôte, après la mise en minuscules ; docstrings mises à jour. **Fin** : `npm test` **722** (+25 sous-tests), `test:ts` **542**, `typecheck` propre, `lint` 0 erreur et 109 avertissements ; les deux suites sous garde réseau : 0 tentative. L'écran du ticket ESSCA ne change pas (ses 3 liens étaient déjà des pages distinctes) : pas de nouvelle vérification dans Chrome. Docs : `architecture.md` (§5.6, arborescence, décomptes), `edgecase.md` (EC 41), README, `CLAUDE.md`. | **Écart** : une paire existante du fichier de cas change d'attendu, parce que la règle change sur décision du propriétaire : `https://em-lyon.com/fr/pge` et `https://www.em-lyon.com/fr/pge`, `same: false` → `true`. **Reste** : validation de la tâche « trois sources » ; commit et push à sa demande ; puis la recette de bout en bout. |
| 2026-10-15 | hors plan | **Le propriétaire demande le commit et le push** : la tâche « trois sources » (doublons `www.` compris) est tenue pour validée. Un seul commit sur `localpython`, avec la ligne de décision du propriétaire (catalogue en tête) restée non commitée jusque-là. | **Prochaine** : la recette de bout en bout sur `dev` (prompt remis au propriétaire), qui cochera la case de l'étape 9. |
| 2026-10-16 | gel | **Plan gelé par la réorientation du projet** (réunion de l'équipe du 16 octobre) : la recherche IA est gardée telle quelle, réservée à l'admin, sans nouveau développement ni recette. La recette de bout en bout sur `dev` est **abandonnée** ; la case de l'étape 9 reste non cochée. Branche `gestion` créée depuis `localpython` (`423631e`) ; `localpython` gardée en l'état. | Suite : `docs/features/gestion-contenu.md` (sur la branche `gestion`). Les règles de dépense (`CLAUDE.md`, règle 7) restent en vigueur. |
