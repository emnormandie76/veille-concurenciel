# Feature — Backend local sur demande : fin de l'hébergement du backend

> **Statut :** plan rédigé et validé par le propriétaire le 14 octobre 2026.
> Étapes 0 et 1 terminées le même jour : décisions D1 à D7 tranchées (§2.2),
> tests TypeScript en CI. Étape 2 (`DB_DRIVER=neon-ws`) faite et vérifiée sur
> la base le 14 octobre ; elle attend la validation du propriétaire avant
> l'étape 3.
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
- [ ] `test/test_scheduler_research_gate.py` est remplacé par
  `test/test_scheduler_registration.py` : `start_scheduler` n'inscrit **que** le
  crowdsourcing, quelles que soient `ENVIRONMENT` et `CRON_RESEARCH_ENABLED`
  (garde contre le retour d'un cron qui paie) ; `next_run_time` est posé ; un
  intervalle illisible retombe sur le défaut.
- [ ] `test/test_research_rotation_job.py` adapté à `run_due_passes` :
  - `max_passes` respecté ; `dry_run` sans `create_job` ni appel Research ;
  - deuxième appel simultané → `RotationAlreadyRunning` ;
  - plafond et quota inchangés ;
  - synchro `/usage` en échec → rien ne part.
- [ ] `test/test_rotation_status.py` adapté (`last_run`, `usage_sync`, plus de
  `research_cron`).
- [ ] Nouveau `test/test_internal_run_due_passes.py` : jeton absent ou faux,
  202, 409, 503 (pas de gestionnaire de clés, synchro), 422.
- [ ] Nouveau `test/test_startup.py` : un `TavilyKeyManager` qui lève →
  `/health` en `degraded` avec l'erreur ; une base injoignable → erreur de
  démarrage qui cite le pilote.
- [ ] Crowdsourcing : une lecture de base en échec → dernier passage `failed`
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

- [ ] Étape 3 terminée

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
- [ ] toutes les cibles échouent → `success: False`, `failed_targets` complet ;
- [ ] échecs mêlés à des tickets → compteurs justes ; règle D2 appliquée ;
- [ ] données inchangées partout → `success: True`, aucun ticket, `unchanged`
  compté ;
- [ ] `dry_run` et `skip_pending` inchangés (les tests existants restent verts).

**Docs :** `architecture.md` §5.3 (résultat d'une passe) et §5.5 (reprise
après échec).

- [ ] Étape 4 terminée

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
- [ ] `test/internal-api.test.ts` : URL absente → `BACKEND_LOCAL_ONLY` ; jeton
  absent → `TOKEN_MISSING` ; l'ancien nom de jeton est accepté, avec un seul
  avertissement.
- [ ] `test/api/pipeline-status.test.ts`, `trigger-research.test.ts`,
  `run-due-passes.test.ts` :
  - sans `FASTAPI_URL`, 503 et `fetch` **jamais appelé** ;
  - jeton absent → 500 ;
  - `fetch` rejeté → `BACKEND_NOT_RUNNING` ;
  - réponse transmise telle quelle ;
  - garde ADMIN sur les déclenchements ; bornes de `max_passes`.
- [ ] `test/api/pipeline-jobs.test.ts` : session requise, forme de la réponse,
  compte des `Pending_AI`.
- [ ] `test/rotation-status.test.ts` adapté.

**Docs :** `architecture.md` §2.3 (routes Next), §7.4 (`/admin/cron`), §10.5 ;
README.

- [ ] Étape 5 terminée

### Étape 6 — Le lanceur local

- `package.json` : `backend` lance
  `backend/.venv/Scripts/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`.
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

**Docs :** README (démarrage : une commande) ; `architecture.md` §2.4
(arborescence) et §10.6.

- [ ] Étape 6 terminée

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

- [ ] Étape 7 terminée

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
