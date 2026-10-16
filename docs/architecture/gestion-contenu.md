# Le gestionnaire de contenu — état du code

> **Relevé du 16 octobre 2026**, branche `gestion` (`423631e`). Cette fiche
> décrit **ce que le code fait aujourd'hui** ; la cible est dans le plan
> [`features/gestion-contenu.md`](../features/gestion-contenu.md). Chaque étape
> du plan la met à jour.
>
> C'est le point d'entrée pour travailler sur le contenu sans lire
> [`architecture.md`](architecture.md), centrée sur le pipeline IA (gelé).

---

## 1. Ce que c'est

Le site Next.js 16 (`app/`) porte tout le gestionnaire de contenu : la
consultation, le back-office qui crée, modifie et supprime les données des
écoles, et l'API v1. Il lit et écrit la base Neon par Prisma
([`lib/prisma.ts`](../../lib/prisma.ts), WebSocket sur le port 443).

**Il ne dépend pas du backend Python.** Seules trois routes l'appellent, toutes
IA : `trigger-research`, `run-due-passes`, `pipeline-status`. Sans
`FASTAPI_URL`, elles répondent 503 `BACKEND_LOCAL_ONLY` sans appel ; le reste du
site marche (étape 5 du plan backend-local).

---

## 2. Authentification et accès

| Élément | Où | Ce qu'il fait |
|---|---|---|
| Connexion | [`app/api/auth/[...nextauth]/route.ts`](../../app/api/auth/[...nextauth]/route.ts) | NextAuth v4, `CredentialsProvider` : identifiant (`username`) et mot de passe (bcrypt) contre `User`. Pas d'auto-inscription. Session **JWT de 8 h** ; le rôle est copié dans le jeton à la connexion et n'est plus relu ensuite |
| Page de connexion | `app/(admin-auth)/admin/login/` | hors du layout admin (groupe de routes), pour éviter la boucle de redirection |
| Gardes | [`lib/auth.ts`](../../lib/auth.ts) | `guardAuth()` : 401 sans session, **toute session passe**. `guardAdmin()` : 401 sans session, 403 si le rôle n'est pas `ADMIN`. Rôles connus : `ADMIN`, `MODERATOR` |
| Proxy | [`proxy.ts`](../../proxy.ts) (tient lieu de middleware) | session exigée sur `/admin/*` seulement (hors login) ; plafonds de débit sur la connexion (5 / 15 min / IP), `/api/contribute` (5 / 20 s) et `/api/v1/*` (60 / min), par [`lib/rate-limit.ts`](../../lib/rate-limit.ts) |
| Layout admin | [`app/admin/layout.tsx`](../../app/admin/layout.tsx) | renvoie vers la connexion sans session ; **ne regarde pas le rôle** |
| Menu | [`app/admin/SidebarClient.tsx`](../../app/admin/SidebarClient.tsx) | Inbox, Écoles, Cron (IA) pour tous ; Utilisateurs pour `ADMIN` |
| Mots de passe | [`lib/password.ts`](../../lib/password.ts) | politique unique (longueurs, borne bcrypt de 72 octets) |

En base, `User` n'a que `username`, `password_hash`, `role` (chaîne, défaut
`MODERATOR`, bornée par une contrainte `CHECK` à `ADMIN` et `MODERATOR`) et
`createdAt`. **Pas d'e-mail.**

Ouverts à tous, sans session : les pages publiques, `/api-docs`,
`/api/schools/*`, `/api/v1/*` et `/api/contribute`.

---

## 3. Écrans

### 3.1. Site public

| Chemin | Rôle | Données |
|---|---|---|
| `/` ([`app/page.tsx`](../../app/page.tsx)) | liste et recherche des écoles | client : `fetch('/api/schools')`, erreurs par [`lib/public-schools.ts`](../../lib/public-schools.ts) |
| `/schools/[id]` | fiche école (campus, programmes, chiffres clés, accréditations) | serveur, Prisma, ISR 1 h |
| `/schools/[id]/programs/[pid]` | fiche programme (tarifs, places, classements, rattachements) | serveur, Prisma, ISR 1 h |
| `/contribute` | contribution du public (**abandonnée**, plan §2.1 G8) | `POST /api/contribute`, crée un ticket `Pending_AI` |
| `/api-docs` | documentation de l'API v1 | statique, verrouillée par `test/api-docs.test.ts` |

### 3.2. Back-office

| Chemin | Rôle | IA ? |
|---|---|---|
| `/admin/schools` | liste des écoles, création (`ADMIN`) | non |
| `/admin/schools/[id]/manage` | **la gestion de contenu d'une école**, 7 onglets (`manage/tabs/`) : `SchoolInfoTab`, `CampusProgramsTab`, `PricingTab`, `CapacitiesTab`, `RankingsTab`, `StatsTab`, `AccreditationsTab` ; sélecteurs `ProgramSelector`, `YearSelector` | non |
| `/admin/schools/[id]/campuses` | les campus d'une école | non |
| `/admin/inbox` | la zone tampon : tickets du pipeline IA et contributions, à valider ou rejeter | **oui** (tickets IA) |
| `/admin/users` | comptes (`ADMIN`) | non |
| `/admin/cron` | pilotage du backend local, passes dues, quotas Tavily, historique des jobs | **oui** |

---

## 4. Routes

Garde de chaque méthode, relevée dans le code le 16 octobre 2026.
`Auth` = `guardAuth` (toute session), `Admin` = `guardAdmin`.

### 4.1. Gestion de contenu (`app/api/admin/`)

| Route | Méthodes |
|---|---|
| `schools` | GET Auth · POST Admin |
| `schools/[id]` | GET Auth · PUT Auth · DELETE Admin |
| `schools/[id]/manage` | GET Auth (tout ce que les onglets affichent) |
| `schools/[id]/campuses` | GET Auth · POST Auth |
| `campuses/[id]` | PUT Auth · DELETE Admin |
| `schools/[id]/programs` | GET Auth · POST Auth |
| `programs/[id]` | PUT Auth · DELETE Admin |
| `schools-with-programs` | GET Auth |
| `schools/[id]/pricing` · `programs/[id]/pricing` · `pricing/[id]` | GET Auth · PUT Auth · DELETE Auth |
| `schools/[id]/capacities` · `program-campuses/[id]/capacity` · `capacities/[id]` | GET Auth · POST Auth · PUT Auth · DELETE Auth |
| `schools/[id]/rankings` · `programs/[id]/rankings` · `rankings/[id]` | GET Auth · POST Auth · PUT Auth · DELETE Auth |
| `schools/[id]/stats` · `schools/[id]/stats/[recordId]` | GET Auth · PUT Auth · DELETE Auth |
| `schools/[id]/accreditations` · `accreditations/[id]` | GET Auth · POST Auth · PUT Auth · DELETE Auth |
| `users` | GET Admin · POST Admin |
| `users/[id]` | DELETE Admin |
| `users/[id]/password` | PATCH Auth (soi-même ; un tiers : `ADMIN` seulement, contrôlé dans la route) |

Corps de requête : [`lib/request-body.ts`](../../lib/request-body.ts)
(défaut connu : un JSON mal formé rend 500 sur ces routes).

### 4.2. Inbox et IA

| Route | Méthodes | Remarque |
|---|---|---|
| `inbox` · `inbox/[id]` | GET Auth | liste et détail des tickets ; sources plafonnées par [`lib/ticket-sources.ts`](../../lib/ticket-sources.ts) |
| `inbox/[id]/validate` | PUT Auth | **écrit les données** (`Campus`, `Program`, `ProgramCampus`, `PricingRecord`, `RankingRecord`, `CapacityRecord`…) dans une transaction |
| `inbox/[id]/reject` | PUT Auth | |
| `inbox/[id]/create-programs` | POST Auth | depuis un ticket `Program_Discovery` (Phase 1) |
| `inbox/[id]/attachments` | PUT Auth | rattachement campus collecté par l'IA |
| `inbox/purge` | DELETE Admin | |
| `trigger-research` · `run-due-passes` | POST Admin | **appellent le backend** |
| `pipeline-status` | GET Auth | **appelle le backend** |
| `pipeline-jobs` | GET Auth | historique, lu en base |

### 4.3. Lecture publique

- `app/api/schools/*` : 3 routes GET, sans garde, ISR 1 h, utilisées par
  l'accueil.
- `app/api/v1/*` : 15 routes GET, sans session, plafonnées à 60 requêtes par
  minute et par IP. Référence : [`API-rest.md`](API-rest.md).
- `app/api/contribute` : POST sans garde, plafonné (contribution abandonnée).

---

## 5. Tables

Schéma : [`prisma/schema.prisma`](../../prisma/schema.prisma) ; référence :
[`bdd.md`](bdd.md) ; vue d'ensemble pour l'équipe : le doc « Données stockées
sur les écoles » du propriétaire.

| Table | Rattachée à | Lien source | Écrite par |
|---|---|---|---|
| `School` | — | non | Next.js |
| `Campus` | école | non | Next.js |
| `Program` | école (pas un campus) | non | Next.js |
| `ProgramCampus` | programme × campus | non | Next.js |
| `ProgramCampusAttachment` | programme × campus × année d'études | oui | Next.js, depuis l'inbox seulement (`inbox/[id]/attachments`) |
| `PricingRecord` | programme × année scolaire | oui | Next.js |
| `CapacityRecord` | programme × campus × année scolaire | oui | Next.js |
| `RankingRecord` | programme × année × média | oui | Next.js |
| `SchoolStatsRecord` | école × année | **non** | Next.js |
| `AccreditationRecord` | école | **non** | Next.js |
| `ProgramPlacement` | programme | oui | aucun chemin d'écriture (abandonné, gardé) |
| `User` | — | — | Next.js |
| `ContributionInbox` | école, campus, programme (facultatifs) | `urls[]` | Next.js **et** backend Python |
| `PipelineJob` | école | — | backend Python seulement |

**Aucune table ne sait qui a modifié une donnée, ni quand.**

Le backend Python **lit** les tables de données (diff de la Phase 2) et
**écrit** `ContributionInbox` et `PipelineJob`. Ajouter une colonne obligatoire
à ces deux tables, ou renommer une colonne qu'il lit, casse le backend gelé.

---

## 6. Styles

- Pas de Tailwind. Tout le style est dans [`app/globals.css`](../../app/globals.css)
  (1 833 lignes) : thème sombre seulement, 21 variables CSS (`--bg-*`,
  `--text-*`, `--accent*`, `--danger*`, `--radius-*`…), des classes globales
  (`badge`, `admin-layout-wrapper`…).
- Environ 1 000 `className` sur 28 fichiers ; aucun dossier `components/`
  partagé.
- CSP posée par [`next.config.ts`](../../next.config.ts) :
  `style-src 'self' 'unsafe-inline'`.

---

## 7. Tests

`npm run test:ts` (`node --test`), en CI dans le job `ts-tests`.

- **Banc** (`test/helpers/`) : `fake-prisma.ts` (faux client), `prisma-schema.ts`
  (chaque requête du faux client relue contre le vrai schéma), `session.ts`
  (sessions simulées : aucune, `MODERATOR`, `ADMIN`), `requests.ts`, `fake-backend.ts`.
- **Contenu** : `test/api/admin-schools`, `admin-programs`, `admin-records`,
  `admin-guards`, `users`, `public-schools`, `v1`, `inbox-*` ;
  `test/proxy.test.ts`, `test/auth.test.ts`, `test/password.test.ts`.
- **Verrous** : `test/api-docs.test.ts` (`/api-docs` = réponses réelles),
  `test/page-titles.test.ts`, `test/silent-pages.test.ts`.
- `npm run smoke` : pages publiques et 15 `GET /api/v1/*` contre `npm run dev`,
  **sans session** ; lit la base visée, accord du propriétaire.

Les tests Python (`npm test`) couvrent le backend gelé : ils restent verts.

---

## 8. Pour aller plus loin

- Chantier qui a construit les onglets de gestion :
  [`features/school-content-management.md`](../features/school-content-management.md).
- Les quatre zones du front, à l'origine : [`architecture.md`](architecture.md) §7.
- Sécurité : [`architecture.md`](architecture.md) §10, README « Sécurité ».
- Déploiement : [`memory/memory-deploiement-vercel.md`](../memory/memory-deploiement-vercel.md).
