# Le gestionnaire de contenu — état du code

> **Relevé du 16 octobre 2026**, branche `gestion`, à la fin de l'étape 2 du
> plan (liste blanche, première connexion, écran des rôles ; l'étape 1 a posé
> les trois rôles, les gardes et la connexion obligatoire). Cette fiche décrit
> **ce que le code fait aujourd'hui** ; la cible est dans le plan
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
| `USER` | toute personne connectée | consulter le site, `/api-docs` et l'API v1 ; changer son nom affiché et son mot de passe sur « Mon compte » (`/account`). **Ne voit pas `/admin`** |
| `GESTIONNAIRE` | les anciens `MODERATOR` | en plus : le back-office du contenu (écoles, campus, programmes, tarifs, places, classements, chiffres clés, accréditations), créations et suppressions comprises (D19) |
| `ADMIN` | | en plus : les comptes (liste blanche, rôles, remise en première connexion, désactivation), et **seul l'IA** (inbox, `/admin/cron`, routes du backend) |

Trois niveaux d'accès (`AccessLevel`) : `signedIn` (toute session), `manager`
(gestionnaire ou admin), `admin`. `hasAccess(role, level)` les juge ;
`ROLE_LABELS` donne les libellés de l'interface.

### 2.2. Qui contrôle quoi

| Élément | Où | Ce qu'il fait |
|---|---|---|
| Connexion | [`app/api/auth/[...nextauth]/route.ts`](../../app/api/auth/[...nextauth]/route.ts), [`lib/sign-in.ts`](../../lib/sign-in.ts) | NextAuth v4, `CredentialsProvider` (champ `login`) : l'**adresse** de travail et le mot de passe (bcrypt) contre `User`. L'ancien identifiant (`username`) ne vaut que pour un compte qui n'a pas encore d'adresse (D3) ; seul un compte **actif** se connecte. Pas d'auto-inscription. Session **JWT de 8 h**. Le rôle est copié dans le jeton **à titre indicatif** (D1) ; la **version de session** du compte aussi, et elle, compte (D20) |
| Page de connexion | `app/(admin-auth)/admin/login/` | hors du layout admin (groupe de routes), pour éviter la boucle de redirection ; ouverte sans session. Après la connexion, revient au `callbackUrl` posé par le proxy s'il désigne un chemin du site ([`lib/callback-url.ts`](../../lib/callback-url.ts), pas de redirection ouverte, ni vers la connexion ni vers la première connexion), sinon `/admin/schools`. Renvoie vers la première connexion |
| Première connexion | `app/(admin-auth)/admin/first-login/`, [`app/api/first-login/route.ts`](../../app/api/first-login/route.ts) | G5 : la personne saisit l'adresse que l'admin a mise sur la liste, son nom affiché (prérempli depuis `prenom.nom@…`, D6) et son mot de passe ([`lib/password.ts`](../../lib/password.ts)) ; le compte passe d'invité à actif, puis la page la connecte. La route ne fait qu'une mise à jour visant l'adresse **dans l'état invité** : une adresse hors liste ne crée rien, et un compte actif ou désactivé reçoit le même refus (403). Ouverte sans session, **hors de `/api/auth/*`** exprès |
| Session | [`lib/auth.ts`](../../lib/auth.ts), `getSession()` | lit le jeton, puis **relit le compte en base par son id** à chaque appel (D1) : nom affiché, adresse et rôle viennent de la base. `null` sans session, sur un cookie illisible, si le compte n'existe plus, s'il **n'est pas actif** (invité après une remise à zéro, désactivé) ou si la version de session du jeton n'est pas celle du compte (jeton d'avant une remise à zéro, ou émis avant l'étape 2 : D20). Un rôle inconnu en base ne vaut que `USER`. Une panne de la base remonte (500), elle ne se déguise pas en refus |
| Gardes des API | `lib/auth.ts` | `guardSignedIn()` : 401 sans session. `guardManager()` : 401, puis 403 pour un `USER`. `guardAdmin()` : 401, puis 403 hors `ADMIN`. Chaque handler de `app/api/admin/**` en attend **une seule** ; l'ancienne garde « toute session » du back-office n'existe plus (piège 1) |
| Gardes des écrans | `lib/auth.ts`, `requirePage(level)` | rend la session, ou redirige : vers la connexion sans session, vers `/` pour un `USER`, vers `/admin/schools` pour un gestionnaire sur un écran `admin` |
| Proxy | [`proxy.ts`](../../proxy.ts) (tient lieu de middleware) | **session exigée sur tout le site** (G6), sauf `/admin/login`, `/admin/first-login`, `POST /api/first-login` et `/api/auth/*` (chemins dans [`lib/roles.ts`](../../lib/roles.ts)). Sans session : une page renvoie vers `/admin/login?callbackUrl=…`, une route `/api/*` répond 401 en JSON. Ne regarde que l'existence d'un jeton valide (contrôle « optimiste », doc Next 16), jamais le rôle ni l'état du compte. Matcher : tout sauf `_next/static`, `_next/image`, `favicon.ico`. Plafonds par [`lib/rate-limit.ts`](../../lib/rate-limit.ts) : connexion **et** première connexion sur un seul compteur (5 POST / 15 min / IP, avant tout ; alterner ne double pas les essais), `/api/v1/*` (60 / min / IP, requêtes connectées seulement, pré-vols `OPTIONS` non comptés) |
| Layout admin | [`app/admin/layout.tsx`](../../app/admin/layout.tsx) | `requirePage("manager")` : un `USER` est renvoyé vers le site (piège 2) |
| Écrans IA et comptes | `app/admin/inbox/layout.tsx`, `app/admin/cron/page.tsx`, `app/admin/users/page.tsx` | `requirePage("admin")` |
| « Mon compte » | [`app/account/page.tsx`](../../app/account/page.tsx) | `requirePage("signedIn")` : toute session, hors du back-office. Nom affiché et mot de passe, par `PATCH /api/admin/account` et `PATCH /api/admin/account/password`, qui ne prennent aucun identifiant |
| Menu | [`app/admin/nav.ts`](../../app/admin/nav.ts), `SidebarClient.tsx` | `navFor(role)` : un gestionnaire voit « Écoles & Campus » ; un admin voit aussi l'inbox, le cron et « Comptes ». Le menu ne fait que masquer : le contrôle est côté serveur. « Mon compte » est au pied du menu, hors de `navFor` |
| Déconnexion | `app/admin/SidebarClient.tsx`, [`app/SignOutButton.tsx`](../../app/SignOutButton.tsx) | dans le menu du back-office, et dans la barre du site (le bouton « Se déconnecter » a pris la place du lien « Contribuer » ; « Mon compte » le précède) |
| Mots de passe | [`lib/password.ts`](../../lib/password.ts) | politique unique (longueurs, borne bcrypt de 72 octets) |
| Adresses, noms, états | [`lib/accounts.ts`](../../lib/accounts.ts) | module sans dépendance : domaine imposé `WORK_EMAIL_DOMAIN` = `em-normandie.fr` (D5), adresses rangées en minuscules, nom affiché déduit de l'adresse et borné (2 à 80 caractères, D6), états `INVITED`, `ACTIVE`, `DISABLED` |
| Changements d'un compte | [`lib/account-admin.ts`](../../lib/account-admin.ts), `changeAccount` | relit le compte visé, laisse la route décider sur son état, puis écrit, dans une transaction **sérialisable** : **aucune opération ne laisse zéro admin actif** (les admins invités ne comptent pas). Deux changements concurrents : Postgres en refuse un (P2034), la route répond 409 « réessayez » |

Les écrans du back-office sont des coquilles client : leurs données viennent
d'API gardées. Le contrôle des écrans sert la navigation ; celui des API
protège les données.

**Reste accepté (D1, D20)** : un compte retiré, désactivé ou remis en première
connexion n'a plus accès au back-office, à « Mon compte » ni à aucune
écriture, mais garde la **lecture** du site et de l'API jusqu'à l'expiration de
son jeton (8 h au plus), puisque le proxy ne relit pas la base.

### 2.3. En base

`User` (migrations `20261016120000_three_roles` et
`20261016150000_whitelist_accounts`, appliquées sur la branche Neon `dev` le
16 octobre 2026 et sur `main`, la production, le 19 octobre, étape 3) :

| Colonne | Contenu |
|---|---|
| `email` | adresse de travail, unique, en minuscules ; vide seulement pour un compte d'avant la liste blanche (D3) |
| `username` | ancien identifiant, unique, facultatif : seuls les comptes d'avant la liste blanche en ont un ; il ne sert à la connexion que tant que l'adresse est vide |
| `display_name` | nom affiché (D6), choisi à la première connexion, modifiable sur « Mon compte » |
| `password_hash` | bcrypt ; vide tant que la personne n'a pas fait sa première connexion, et après une remise à zéro ou une désactivation |
| `role` | `USER` (défaut), `GESTIONNAIRE`, `ADMIN` : contrainte `User_role_check` (posée `NOT VALID`), qui a converti les `MODERATOR` en `GESTIONNAIRE` |
| `status` | `INVITED` (défaut), `ACTIVE`, `DISABLED` : contrainte `User_status_check` ; la migration a rendu `ACTIVE` les comptes existants |
| `first_login_at` | date de la première connexion (remise à vide par une remise à zéro) |
| `session_version` | défaut 0 ; recopiée dans le jeton à la connexion, augmentée par une remise à zéro ou une désactivation (D20) |

Quatre autres contraintes `CHECK` tiennent les invariants dont dépend le code :
un compte est actif **si et seulement si** il a un mot de passe ; un invité a
une adresse ; tout compte a une adresse ou un ancien identifiant ; l'adresse
est en minuscules. Relevé après la migration, sur `dev` (16 octobre) comme
sur `main` (19 octobre) : 1 `ADMIN` et 1 `GESTIONNAIRE`, actifs, sans adresse.

**Cycle de vie d'un compte** (G5, D4, D21) :

| Action | Qui | De | Vers |
|---|---|---|---|
| ajouter une adresse à la liste | admin | — | `INVITED` (`USER`) |
| première connexion | la personne | `INVITED` | `ACTIVE` |
| retirer de la liste | admin | `INVITED` | supprimé |
| remettre en première connexion | admin | `ACTIVE` | `INVITED` |
| désactiver | admin | `ACTIVE` | `DISABLED` |
| réactiver (remise en première connexion) | admin | `DISABLED` | `INVITED` |

Le rôle se change dans tous les états. Une adresse ajoutée devient un invité
`USER`. Un compte actif ou désactivé ne se supprime pas : son nom restera dans
l'historique des modifications (étape 5).

---

## 3. Écrans

### 3.1. Site (toute session)

| Chemin | Rôle | Données |
|---|---|---|
| `/` ([`app/page.tsx`](../../app/page.tsx)) | liste et recherche des écoles | client : `fetch('/api/schools')`, erreurs par [`lib/public-schools.ts`](../../lib/public-schools.ts) |
| `/schools/[id]` | fiche école (campus, programmes, chiffres clés, accréditations) | serveur, Prisma, ISR 1 h |
| `/schools/[id]/programs/[pid]` | fiche programme (tarifs, places, classements, rattachements) | serveur, Prisma, ISR 1 h |
| `/api-docs` | documentation de l'API v1 | statique, verrouillée par `test/api-docs.test.ts` |
| `/account` | « Mon compte » : adresse, rôle, nom affiché, mot de passe | serveur (`requirePage("signedIn")`), formulaires client |

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
| `/admin/users` | `admin` : les comptes (« Comptes » dans le menu) : ajouter une adresse à la liste, retirer un invité, changer un rôle, remettre en première connexion (ou réactiver), désactiver, renseigner l'adresse d'un compte ancien. Aucun e-mail envoyé | non |
| `/admin/cron` | `admin` : pilotage du backend local, passes dues, quotas Tavily, historique des jobs | **oui** |

---

## 4. Routes

Garde de chaque méthode à la fin de l'étape 2 (16 octobre 2026). `Gest.` =
`guardManager` (gestionnaire ou admin), `Admin` = `guardAdmin`, `Session` =
`guardSignedIn` (toute session). 53 méthodes : 33 `Gest.`, 18 `Admin`,
2 `Session`.

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
| `users` | GET Admin (la liste, invités compris, sans empreinte) · POST Admin (ajoute une adresse à la liste : invité `USER`, sans mot de passe, aucun e-mail ; D5) |
| `users/[id]` | DELETE Admin (retire un **invité** ; un compte qui a servi se désactive, D21 ; pas soi-même) |
| `users/[id]/role` | PATCH Admin (`USER`, `GESTIONNAIRE`, `ADMIN` ; le dernier admin actif ne se rétrograde pas) |
| `users/[id]/reset` | POST Admin (D4 : remise en première connexion, ou réactivation ; mot de passe effacé, sessions coupées ; pas soi-même, pas sans adresse) |
| `users/[id]/disable` | POST Admin (D21 : un compte actif ; sessions coupées ; pas soi-même, pas un invité) |
| `users/[id]/email` | PATCH Admin (D3 : l'adresse d'un compte qui n'en a pas ; l'ancien identifiant cesse alors de servir) |
| `account` | PATCH Session (son nom affiché, D6) |
| `account/password` | PATCH Session (son mot de passe, l'actuel exigé). Personne ne fixe plus le mot de passe d'un tiers (D4) : l'ancienne route `users/[id]/password` est retirée |

Les routes `users/[id]/role`, `reset`, `disable` et `email` passent par
`changeAccount` ([`lib/account-admin.ts`](../../lib/account-admin.ts)) : aucune
ne laisse zéro admin actif. Toutes écrivent une ligne `[audit]` dans le
journal.

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
- `app/api/first-login` : POST, **sans session** (proxy), au plafond de la
  connexion ; la seule route hors de `/api/auth/*` ouverte sans session (§2.2).
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
| `User` | — | — | Next.js (§2.3) |
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

- **Banc** (`test/helpers/`) : `fake-prisma.ts` (faux client ; garde les
  options d'un `$transaction`), `fake-users.ts` (une table `User` en mémoire,
  avec l'unicité et les contraintes de la migration), `prisma-schema.ts`
  (chaque requête du faux client relue contre le vrai schéma), `session.ts`
  (sessions simulées : aucune, `USER`, `GESTIONNAIRE`, `ADMIN`, règle et
  messages tirés de `lib/roles.ts` ; un profil inconnu lève), `access-policy.ts`
  (l'accès attendu de chaque route du back-office), `requests.ts`,
  `fake-backend.ts`.
- **Accès** (étapes 1 et 2) : `test/auth.test.ts` (la vraie `lib/auth.ts` :
  trois gardes, rôle relu en base, compte supprimé, rôle inconnu, compte non
  actif et version de session (D20), `requirePage`),
  `test/api/access-matrix.test.ts` (chaque handler × 4 profils, 212 cas),
  `test/api/admin-guards.test.ts` (analyse statique des gardes, absence de
  `guardAuth`), `test/proxy.test.ts` (chaque page et route de `app/` refusée
  sans session, hors connexion et NextAuth), `test/admin-pages.test.ts`
  (`requirePage` de chaque écran, menu par rôle), `test/callback-url.test.ts`,
  `test/roles-migration.test.ts` (contrainte, défaut, `lib/roles.ts`),
  `test/no-public-tickets.test.ts` (D2, piège 6).
- **Comptes** (étape 2) : `test/accounts.test.ts` (domaine, adresses, nom
  affiché, états), `test/accounts-migration.test.ts` (la migration, additive,
  et `schema.prisma`), `test/sign-in.test.ts` (connexion par l'adresse, D3,
  invité et désactivé refusés, version de session dans le jeton),
  `test/api/first-login.test.ts` (une adresse hors liste ne crée rien, seul un
  invité passe), `test/api/users.test.ts` (liste blanche, rôles, dernier admin,
  transaction sérialisable, D3, D4, D21), `test/api/account.test.ts` (« Mon
  compte »), et dans `test/proxy.test.ts` la première connexion libre et
  plafonnée avec la connexion.
- **Contenu** : `test/api/admin-schools`, `admin-programs`, `admin-records`
  (cas nominaux en `GESTIONNAIRE`, `USER` refusé), `public-schools`,
  `v1`, `inbox-*` (en `ADMIN`) ; `test/password.test.ts`.
- **Verrous** : `test/api-docs.test.ts` (`/api-docs` = réponses réelles),
  `test/page-titles.test.ts`, `test/silent-pages.test.ts`.
- `npm run smoke` : contre `npm run dev`, d'abord **le mur** sans session
  (connexion et première connexion 200, chaque page renvoyée vers la
  connexion, `/account` compris, `/api/schools` et les 15 `GET /api/v1/*` en
  401), puis, si `APPVC_ADMIN_PASSWORD` et `APPVC_ADMIN_EMAIL` (ou, tant que
  le compte n'a pas d'adresse, `APPVC_ADMIN_USERNAME`) sont posées, les pages
  et l'API **connecté** ; lit la base visée, accord du propriétaire.

Les tests Python (`npm test`) couvrent le backend gelé : ils restent verts.

---

## 8. Pour aller plus loin

- Chantier qui a construit les onglets de gestion :
  [`features/school-content-management.md`](../features/school-content-management.md).
- Les quatre zones du front, à l'origine : [`architecture.md`](architecture.md) §7.
- Sécurité : [`architecture.md`](architecture.md) §10, README « Sécurité ».
- Déploiement : [`memory/memory-deploiement-vercel.md`](../memory/memory-deploiement-vercel.md).
