# Feature — Backend local sur demande : fin de l'hébergement du backend

> **Statut :** plan rédigé et validé par le propriétaire le 14 octobre 2026.
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
> le push et le prompt de l'étape 8 : étape 7 tenue pour validée. Prochaine :
> étape 8 (préparer Vercel).
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
  - endpoint `ep-twilight-forest-ab9qjkm7`.

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

- [ ] Étape 8 terminée

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

- [ ] Étape 9 terminée

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
