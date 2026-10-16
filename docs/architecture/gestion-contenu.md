# Le gestionnaire de contenu — état du code

> **Relevé du 16 octobre 2026**, branche `gestion`, à la fin de l'étape 1 du
> plan (trois rôles, gardes, connexion obligatoire). Cette fiche décrit **ce
> que le code fait aujourd'hui** ; la cible est dans le plan
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

### 2.1. Les trois rôles

[`lib/roles.ts`](../../lib/roles.ts) (module sans dépendance, liste de
référence ; décision G4) :

| Rôle | Qui | Peut |
|---|---|---|
| `USER` | toute personne connectée | consulter le site, `/api-docs` et l'API v1 ; changer son mot de passe. **Ne voit pas `/admin`** |
| `GESTIONNAIRE` | les anciens `MODERATOR` | en plus : le back-office du contenu (écoles, campus, programmes, tarifs, places, classements, chiffres clés, accréditations), créations et suppressions comprises (D19) |
| `ADMIN` | | en plus : les comptes, et **seul l'IA** (inbox, `/admin/cron`, routes du backend) |

Trois niveaux d'accès (`AccessLevel`) : `signedIn` (toute session), `manager`
(gestionnaire ou admin), `admin`. `hasAccess(role, level)` les juge ;
`ROLE_LABELS` donne les libellés de l'interface.

### 2.2. Qui contrôle quoi

| Élément | Où | Ce qu'il fait |
|---|---|---|
| Connexion | [`app/api/auth/[...nextauth]/route.ts`](../../app/api/auth/[...nextauth]/route.ts) | NextAuth v4, `CredentialsProvider` : identifiant (`username`) et mot de passe (bcrypt) contre `User`. Pas d'auto-inscription. Session **JWT de 8 h**. Le rôle est copié dans le jeton à la connexion, **à titre indicatif** : il ne sert jamais à juger un accès (D1) |
| Page de connexion | `app/(admin-auth)/admin/login/` | hors du layout admin (groupe de routes), pour éviter la boucle de redirection ; seule page ouverte sans session. Après la connexion, revient au `callbackUrl` posé par le proxy s'il désigne un chemin du site ([`lib/callback-url.ts`](../../lib/callback-url.ts), pas de redirection ouverte), sinon `/admin/schools` |
| Session | [`lib/auth.ts`](../../lib/auth.ts), `getSession()` | lit le jeton, puis **relit le compte en base par son id** à chaque appel (D1) : nom et rôle viennent de la base. `null` sans session, sur un cookie illisible, ou si le compte n'existe plus. Un rôle inconnu en base ne vaut que `USER`. Une panne de la base remonte (500), elle ne se déguise pas en refus |
| Gardes des API | `lib/auth.ts` | `guardSignedIn()` : 401 sans session. `guardManager()` : 401, puis 403 pour un `USER`. `guardAdmin()` : 401, puis 403 hors `ADMIN`. Chaque handler de `app/api/admin/**` en attend **une seule** ; l'ancienne garde « toute session » du back-office n'existe plus (piège 1) |
| Gardes des écrans | `lib/auth.ts`, `requirePage(level)` | rend la session, ou redirige : vers la connexion sans session, vers `/` pour un `USER`, vers `/admin/schools` pour un gestionnaire sur un écran `admin` |
| Proxy | [`proxy.ts`](../../proxy.ts) (tient lieu de middleware) | **session exigée sur tout le site** (G6), sauf `/admin/login` et `/api/auth/*`. Sans session : une page renvoie vers `/admin/login?callbackUrl=…`, une route `/api/*` répond 401 en JSON. Ne regarde que l'existence d'un jeton valide (contrôle « optimiste », doc Next 16), jamais le rôle. Matcher : tout sauf `_next/static`, `_next/image`, `favicon.ico`. Plafonds par [`lib/rate-limit.ts`](../../lib/rate-limit.ts) : connexion (5 POST / 15 min / IP, avant tout), `/api/v1/*` (60 / min / IP, requêtes connectées seulement, pré-vols `OPTIONS` non comptés) |
| Layout admin | [`app/admin/layout.tsx`](../../app/admin/layout.tsx) | `requirePage("manager")` : un `USER` est renvoyé vers le site (piège 2) |
| Écrans IA et comptes | `app/admin/inbox/layout.tsx`, `app/admin/cron/page.tsx`, `app/admin/users/page.tsx` | `requirePage("admin")` |
| Menu | [`app/admin/nav.ts`](../../app/admin/nav.ts), `SidebarClient.tsx` | `navFor(role)` : un gestionnaire voit « Écoles & Campus » ; un admin voit aussi l'inbox, le cron et « Comptes ». Le menu ne fait que masquer : le contrôle est côté serveur |
| Déconnexion | `app/admin/SidebarClient.tsx`, [`app/SignOutButton.tsx`](../../app/SignOutButton.tsx) | dans le menu du back-office, et dans la barre du site (le bouton « Se déconnecter » a pris la place du lien « Contribuer ») |
| Mots de passe | [`lib/password.ts`](../../lib/password.ts) | politique unique (longueurs, borne bcrypt de 72 octets) |

Les écrans du back-office sont des coquilles client : leurs données viennent
d'API gardées. Le contrôle des écrans sert la navigation ; celui des API
protège les données.

**Reste accepté (D1)** : un compte supprimé n'a plus accès au back-office ni à
aucune écriture, mais garde la lecture du site et de l'API jusqu'à
l'expiration de son jeton (8 h au plus), puisque le proxy ne relit pas la base.

### 2.3. En base

`User` n'a que `username`, `password_hash`, `role` et `createdAt`. **Pas
d'e-mail** (étape 2). `role` est une chaîne, défaut `USER`, bornée par la
contrainte `CHECK` `User_role_check` aux trois rôles (migration
`20261016120000_three_roles`, posée `NOT VALID` comme les autres gardes
d'énumération). La migration a converti les `MODERATOR` en `GESTIONNAIRE`.
Appliquée sur la branche Neon `dev` le 16 octobre 2026 ; **pas encore sur
`main`** (étape 3).

L'écran actuel des comptes (`/admin/users`) crée des `GESTIONNAIRE`, rôle écrit
dans la route (D18), jusqu'à l'écran des rôles de l'étape 2. Aucun compte
`USER` n'existe encore.

---

## 3. Écrans

### 3.1. Site (toute session)

| Chemin | Rôle | Données |
|---|---|---|
| `/` ([`app/page.tsx`](../../app/page.tsx)) | liste et recherche des écoles | client : `fetch('/api/schools')`, erreurs par [`lib/public-schools.ts`](../../lib/public-schools.ts) |
| `/schools/[id]` | fiche école (campus, programmes, chiffres clés, accréditations) | serveur, Prisma, ISR 1 h |
| `/schools/[id]/programs/[pid]` | fiche programme (tarifs, places, classements, rattachements) | serveur, Prisma, ISR 1 h |
| `/api-docs` | documentation de l'API v1 | statique, verrouillée par `test/api-docs.test.ts` |

Les pages en cache ISR ne lisent pas la session : le proxy passe avant le
cache, et le mur tient (plan, piège 4). `/contribute` est retirée (D2) ; le
signalement de l'étape 6 la remplacera.

### 3.2. Back-office

| Chemin | Niveau | IA ? |
|---|---|---|
| `/admin/schools` | `manager` : liste, création et suppression des écoles | non |
| `/admin/schools/[id]/manage` | `manager` : **la gestion de contenu d'une école**, 7 onglets (`manage/tabs/`) : `SchoolInfoTab`, `CampusProgramsTab`, `PricingTab`, `CapacitiesTab`, `RankingsTab`, `StatsTab`, `AccreditationsTab` ; sélecteurs `ProgramSelector`, `YearSelector` | non |
| `/admin/schools/[id]/campuses` | `manager` : les campus d'une école | non |
| `/admin/inbox` | `admin` : la zone tampon, tickets du pipeline IA et contributions passées par l'IA, à valider ou rejeter | **oui** |
| `/admin/users` | `admin` : comptes (« Comptes » dans le menu) ; crée des `GESTIONNAIRE` (D18) | non |
| `/admin/cron` | `admin` : pilotage du backend local, passes dues, quotas Tavily, historique des jobs | **oui** |

---

## 4. Routes

Garde de chaque méthode à la fin de l'étape 1 (16 octobre 2026). `Gest.` =
`guardManager` (gestionnaire ou admin), `Admin` = `guardAdmin`, `Session` =
`guardSignedIn` (toute session). 48 méthodes : 33 `Gest.`, 14 `Admin`,
1 `Session`.

La table de référence est [`test/helpers/access-policy.ts`](../../test/helpers/access-policy.ts) :
`test/api/admin-guards.test.ts` vérifie que chaque handler attend la garde de
son niveau, et une seule ; `test/api/access-matrix.test.ts` appelle chaque
handler sans session, en `USER`, en `GESTIONNAIRE` et en `ADMIN` avec la vraie
`lib/auth.ts`. Une route ajoutée tombe en `Gest.` par défaut. Toute
modification se reporte ici.

### 4.1. Gestion de contenu (`app/api/admin/`)

| Route | Méthodes |
|---|---|
| `schools` | GET Gest. · POST Gest. (D19) |
| `schools/[id]` | GET Gest. · PUT Gest. · DELETE Gest. (D19 ; confirmation par le nom) |
| `schools/[id]/manage` | GET Gest. (tout ce que les onglets affichent) |
| `schools/[id]/campuses` | GET Gest. · POST Gest. |
| `campuses/[id]` | PUT Gest. · DELETE Gest. (D19) |
| `schools/[id]/programs` | GET Gest. · POST Gest. |
| `programs/[id]` | PUT Gest. · DELETE Gest. (D19) |
| `schools-with-programs` | GET Gest. |
| `schools/[id]/pricing` · `programs/[id]/pricing` · `pricing/[id]` | GET Gest. · PUT Gest. · DELETE Gest. |
| `schools/[id]/capacities` · `program-campuses/[id]/capacity` · `capacities/[id]` | GET Gest. · POST Gest. · PUT Gest. · DELETE Gest. |
| `schools/[id]/rankings` · `programs/[id]/rankings` · `rankings/[id]` | GET Gest. · POST Gest. · PUT Gest. · DELETE Gest. |
| `schools/[id]/stats` · `schools/[id]/stats/[recordId]` | GET Gest. · PUT Gest. · DELETE Gest. |
| `schools/[id]/accreditations` · `accreditations/[id]` | GET Gest. · POST Gest. · PUT Gest. · DELETE Gest. |
| `users` | GET Admin · POST Admin (crée un `GESTIONNAIRE`, D18) |
| `users/[id]` | DELETE Admin |
| `users/[id]/password` | PATCH Session (soi-même, mot de passe actuel exigé ; un tiers : `ADMIN` seulement, contrôlé dans la route) |

Corps de requête : [`lib/request-body.ts`](../../lib/request-body.ts)
(défaut connu : un JSON mal formé rend 500 sur ces routes).

### 4.2. Inbox et IA

Tout est réservé à `ADMIN` : les tickets de l'inbox viennent tous du pipeline
IA ou passent par lui.

| Route | Méthodes | Remarque |
|---|---|---|
| `inbox` · `inbox/[id]` | GET Admin | liste et détail des tickets ; sources plafonnées par [`lib/ticket-sources.ts`](../../lib/ticket-sources.ts) |
| `inbox/[id]/validate` | PUT Admin | **écrit les données** (`Campus`, `Program`, `ProgramCampus`, `PricingRecord`, `RankingRecord`, `CapacityRecord`…) dans une transaction |
| `inbox/[id]/reject` | PUT Admin | |
| `inbox/[id]/create-programs` | POST Admin | depuis un ticket `Program_Discovery` (Phase 1) |
| `inbox/[id]/attachments` | PUT Admin | rattachement campus collecté par l'IA |
| `inbox/purge` | DELETE Admin | |
| `trigger-research` · `run-due-passes` | POST Admin | **appellent le backend** |
| `pipeline-status` | GET Admin | **appelle le backend** |
| `pipeline-jobs` | GET Admin | historique, lu en base |

### 4.3. Lecture du site

Session exigée par le proxy (401 en JSON sans session) ; les routes elles-mêmes
ne lisent pas la session, ce qui garde leur cache ISR.

- `app/api/schools/*` : 3 routes GET, ISR 1 h, utilisées par l'accueil.
- `app/api/v1/*` : 15 routes GET, plafonnées à 60 requêtes par minute et par
  IP. Référence : [`API-rest.md`](API-rest.md).
- `app/api/contribute` : **retirée** (D2). Aucun fichier de `app/` ni de `lib/`
  ne crée plus de ticket `ContributionInbox` (`test/no-public-tickets.test.ts`,
  piège 6) : seul le backend gelé en écrit.

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
| `User` | — | — | Next.js (rôle : §2.3) |
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
  (sessions simulées : aucune, `USER`, `GESTIONNAIRE`, `ADMIN`, règle et
  messages tirés de `lib/roles.ts` ; un profil inconnu lève), `access-policy.ts`
  (l'accès attendu de chaque route du back-office), `requests.ts`,
  `fake-backend.ts`.
- **Accès** (étape 1) : `test/auth.test.ts` (la vraie `lib/auth.ts` : trois
  gardes, rôle relu en base, compte supprimé, rôle inconnu, `requirePage`),
  `test/api/access-matrix.test.ts` (chaque handler × 4 profils, 192 cas),
  `test/api/admin-guards.test.ts` (analyse statique des gardes, absence de
  `guardAuth`), `test/proxy.test.ts` (chaque page et route de `app/` refusée
  sans session, hors connexion et NextAuth), `test/admin-pages.test.ts`
  (`requirePage` de chaque écran, menu par rôle), `test/callback-url.test.ts`,
  `test/roles-migration.test.ts` (contrainte, défaut, `lib/roles.ts`),
  `test/no-public-tickets.test.ts` (D2, piège 6).
- **Contenu** : `test/api/admin-schools`, `admin-programs`, `admin-records`
  (cas nominaux en `GESTIONNAIRE`, `USER` refusé), `users`, `public-schools`,
  `v1`, `inbox-*` (en `ADMIN`) ; `test/password.test.ts`.
- **Verrous** : `test/api-docs.test.ts` (`/api-docs` = réponses réelles),
  `test/page-titles.test.ts`, `test/silent-pages.test.ts`.
- `npm run smoke` : contre `npm run dev`, d'abord **le mur** sans session
  (connexion 200, chaque page renvoyée vers la connexion, `/api/schools` et
  les 15 `GET /api/v1/*` en 401), puis, si `APPVC_ADMIN_USERNAME` et
  `APPVC_ADMIN_PASSWORD` sont posées, les pages et l'API **connecté** ; lit la
  base visée, accord du propriétaire.

Les tests Python (`npm test`) couvrent le backend gelé : ils restent verts.

---

## 8. Pour aller plus loin

- Chantier qui a construit les onglets de gestion :
  [`features/school-content-management.md`](../features/school-content-management.md).
- Les quatre zones du front, à l'origine : [`architecture.md`](architecture.md) §7.
- Sécurité : [`architecture.md`](architecture.md) §10, README « Sécurité ».
- Déploiement : [`memory/memory-deploiement-vercel.md`](../memory/memory-deploiement-vercel.md).
