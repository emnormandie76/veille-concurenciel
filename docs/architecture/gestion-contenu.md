# Le gestionnaire de contenu — état du code

> **Relevé du 16 octobre 2026**, branche `gestion`, à la fin de l'étape 2 du
> plan (liste blanche, première connexion, écran des rôles ; l'étape 1 a posé
> les trois rôles, les gardes et la connexion obligatoire), **mis à jour le
> 19 octobre** : site en ligne (étape 3), charte graphique et composants de
> base (étape 4 : §3 et §6), **et le 20 octobre** : sources et auteur de
> chaque modification (étape 5 : §2.3, §3, §4, §5, §6, §7), puis le formulaire
> de signalement (étape 6 : §2, §3, §4, §5, §6, §7), puis l'historique des
> recherches IA (étape 7 : §2.3, §3.2, §4.2, §5, §7), puis les admissions
> des programmes (étape 8 : §2, §3, §4, §5, §6, §7). Cette fiche décrit
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
| `USER` | toute personne connectée | consulter le site, `/api-docs` et l'API v1 ; **signaler une information** depuis une fiche (étape 6) et en suivre la suite ; changer son nom affiché et son mot de passe sur « Mon compte » (`/account`). **Ne voit pas `/admin`** |
| `GESTIONNAIRE` | les anciens `MODERATOR` | en plus : le back-office du contenu (écoles, campus, programmes, tarifs, places, classements, chiffres clés, accréditations, et depuis l'étape 8 les admissions des programmes), créations et suppressions comprises (D19), et **les signalements** (`/admin/reports`, D31) |
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
| Proxy | [`proxy.ts`](../../proxy.ts) (tient lieu de middleware) | **session exigée sur tout le site** (G6), sauf `/admin/login`, `/admin/first-login`, `POST /api/first-login` et `/api/auth/*` (chemins dans [`lib/roles.ts`](../../lib/roles.ts)). Sans session : une page renvoie vers `/admin/login?callbackUrl=…`, une route `/api/*` répond 401 en JSON. Ne regarde que l'existence d'un jeton valide (contrôle « optimiste », doc Next 16), jamais le rôle ni l'état du compte. Matcher : tout sauf `_next/static`, `_next/image`, `favicon.ico`. Plafonds par [`lib/rate-limit.ts`](../../lib/rate-limit.ts) : connexion **et** première connexion sur un seul compteur (5 POST / 15 min / IP, avant tout ; alterner ne double pas les essais), `/api/v1/*` (60 / min / IP, requêtes connectées seulement, pré-vols `OPTIONS` non comptés). Le plafond du signalement est dans sa route, par compte (ligne suivante) |
| Signalement | [`app/api/admin/reports/route.ts`](../../app/api/admin/reports/route.ts), [`lib/content-reports.ts`](../../lib/content-reports.ts) | `POST` en `guardSignedIn` : l'auteur est le compte de la session, jamais le corps. **10 envois par heure et par compte** (D35 : l'équipe sort par la même IP), par `checkRateLimit("report:<compte>")` de `lib/rate-limit.ts`, compté une fois le corps lu et avant toute lecture en base ; au-delà, 429 avec `Retry-After`. Le seul plafond hors du proxy, parce que le proxy ne connaît pas le compte |
| Layout admin | [`app/admin/layout.tsx`](../../app/admin/layout.tsx) | `requirePage("manager")` : un `USER` est renvoyé vers le site (piège 2) |
| Écrans IA et comptes | `app/admin/inbox/layout.tsx`, `app/admin/cron/page.tsx`, `app/admin/users/page.tsx` | `requirePage("admin")` |
| « Mon compte » | [`app/account/page.tsx`](../../app/account/page.tsx) | `requirePage("signedIn")` : toute session, hors du back-office. Nom affiché et mot de passe, par `PATCH /api/admin/account` et `PATCH /api/admin/account/password`, qui ne prennent aucun identifiant. « Vos signalements » (étape 6, D36) : la page lit en base les signalements **de la session**, et eux seuls |
| Menu | [`app/admin/nav.ts`](../../app/admin/nav.ts), `SidebarClient.tsx` | `navFor(role)` : un gestionnaire voit « Écoles & Campus » et « Signalements » (étape 6) ; un admin voit aussi l'inbox, le cron et « Comptes ». Le menu ne fait que masquer : le contrôle est côté serveur. « Mon compte » est au pied du menu, hors de `navFor` |
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

Depuis l'étape 5, les neuf tables de données pointent vers `User` par
`updated_by_id` (§5), en `ON DELETE RESTRICT` (D24) : la base refuse de
supprimer un compte qui figure comme auteur. Depuis l'étape 6, `ContentReport`
aussi, par `author_id` et `handled_by_id`, en `RESTRICT` (D38) : un compte qui
a envoyé ou traité un signalement ne se supprime pas non plus. Depuis
l'étape 7, `ResearchLaunch` aussi, par `triggered_by_id`, en `RESTRICT`
(D42) : un compte qui a lancé une recherche IA ne se supprime pas.

**Cycle de vie d'un compte** (G5, D4, D21) :

| Action | Qui | De | Vers |
|---|---|---|---|
| ajouter une adresse à la liste | admin | — | `INVITED` (`USER`) |
| première connexion | la personne | `INVITED` | `ACTIVE` |
| retirer de la liste | admin | `INVITED` qui n'a modifié aucune donnée, ni envoyé ni traité de signalement, ni lancé de recherche IA | supprimé |
| remettre en première connexion | admin | `ACTIVE` | `INVITED` |
| désactiver | admin | `ACTIVE` ou `INVITED` (D24) | `DISABLED` |
| réactiver (remise en première connexion) | admin | `DISABLED` | `INVITED` |

Le rôle se change dans tous les états. Une adresse ajoutée devient un invité
`USER`. Un compte actif ou désactivé ne se supprime pas (D21), ni un invité qui
a déjà modifié une donnée (un compte remis en première connexion, D4),
envoyé ou traité un signalement (D38), ou lancé une recherche IA (D42) : la
base le refuse et « Retirer » répond 409 ; il se désactive (D24). Son nom
reste affiché dans « Modifié par », quel que soit son état (D25).

---

## 3. Écrans

### 3.1. Site (toute session)

| Chemin | Rôle | Données |
|---|---|---|
| `/` ([`app/page.tsx`](../../app/page.tsx)) | liste et recherche des écoles | client : `fetch('/api/schools')`, erreurs par [`lib/public-schools.ts`](../../lib/public-schools.ts) |
| `/schools/[id]` | fiche école (campus, programmes, chiffres clés, accréditations) | serveur, Prisma, ISR 1 h |
| `/schools/[id]/programs/[pid]` | fiche programme (admissions depuis l'étape 8, tarifs, places, classements, rattachements) | serveur, Prisma, ISR 1 h |
| `/api-docs` | documentation de l'API v1 | statique, verrouillée par `test/api-docs.test.ts` |
| `/schools/[id]/report` | « Signaler une information » (étape 6) : la cible (l'école, un de ses campus ou de ses programmes ; `?program=` la choisit depuis la fiche programme), la catégorie, le message, un lien facultatif | serveur (`requirePage("signedIn")`, Prisma : une école active seulement), formulaire client ; envoi par `POST /api/admin/reports` |
| `/account` | « Mon compte » : adresse, rôle, nom affiché, mot de passe ; « Vos signalements » (étape 6, D36) : date, cible, catégorie, état, réponse | serveur (`requirePage("signedIn")`), formulaires client |

Les pages en cache ISR ne lisent pas la session : le proxy passe avant le
cache, et le mur tient (plan, piège 4). `/contribute` est retirée (D2) ; le
signalement l'a remplacée (étape 6, ci-dessous).

**Signaler une information** (étape 6, G8, D33) : les fiches école et programme
portent un lien « Signaler une information », à leur ancien style
(`btn btn-secondary`), vers `/schools/[id]/report` (depuis une fiche
programme : `?program=<id>`). Le formulaire est dans la charte ; les fiches
ne lisent toujours pas la session et gardent leur cache. Aucune IA : le
signalement va dans `ContentReport`, jamais dans l'inbox (D13, piège 6).
L'auteur suit la suite donnée sur « Mon compte » (D36) ; aucun e-mail.

**Provenance affichée** (étape 5) : une ligne « Source ↗ · Modifié par … le … »
([`app/schools/SourceLine.tsx`](../../app/schools/SourceLine.tsx)) sous
l'en-tête de l'école, ses chiffres clés et chacune de ses accréditations ; sous
l'en-tête du programme, dans une colonne « Source » des tarifs, sous chaque
classement et sur chaque carte de places. Le texte vient de
`describeProvenance` ([`lib/provenance.ts`](../../lib/provenance.ts)) :
« Modifié par X le 19 octobre 2026 », « Validé par X le …, depuis une
recherche IA » (D11), « … après un signalement » (étape 6) ; rien pour une
donnée non suivie. X est le nom affiché, sinon « Compte sans nom », jamais
l'adresse ni l'identifiant (D25) : les pages ne lisent de l'auteur que
`display_name`, et la fiche école, composant client, reçoit le texte déjà
préparé (`forDisplay`). Seul un lien `http(s)` est cliquable (`sourceHref`,
D27), en nouvel onglet (`noopener noreferrer`). La provenance d'un campus ne
s'affiche pas sur le site (la fiche ne montre que son nom) : elle se lit dans
le gestionnaire (§3.2) ; celle d'un rattachement reste en base (aucun écran
ne les montre). L'API v1 ne rend que la date, ni l'auteur ni l'origine (D25,
revue le 20 octobre).

**Admissions** (étape 8, D16, D51) : la fiche programme ouvre sur une section
« Admissions », avant les tarifs : une ligne par entrée possible, dans l'ordre
de l'année d'entrée puis du niveau (« Entrée en 3e année avec un Bac+2, sur
concours », texte de `describeEntry`, [`lib/program-entries.ts`](../../lib/program-entries.ts)),
sa note (le concours, les diplômes acceptés) et sa `SourceLine` ; « Aucune
donnée d'admission disponible. » sinon. À l'ancien style de la fiche (D51).
L'étiquette du concours (`admission_exam`) reste dans l'en-tête, inchangée
(D47).

**Cache** (D26, piège 4) : après chaque écriture réussie du contenu, la route
appelle `revalidateContent()` ([`lib/content-cache.ts`](../../lib/content-cache.ts)),
qui invalide `/schools` et `/api/schools` en `layout` : toutes les fiches
école et programme et les trois routes de l'accueil se régénèrent à la visite
suivante, au lieu d'attendre l'heure de l'ISR. Un échec de la revalidation
est journalisé (`[cache]`), il n'annule pas l'écriture.

### 3.2. Back-office

| Chemin | Niveau | IA ? |
|---|---|---|
| `/admin/schools` | `manager` : liste, création et suppression des écoles | non |
| `/admin/schools/[id]/manage` | `manager` : **la gestion de contenu d'une école**, 8 onglets (`manage/tabs/`) : `SchoolInfoTab`, `CampusProgramsTab`, `PricingTab`, `CapacitiesTab`, `RankingsTab`, `StatsTab`, `AccreditationsTab`, et depuis l'étape 8 `AdmissionsTab` (« Admissions », D50 : une carte par entrée d'un programme, filtre par programme, année d'entrée, niveau requis et voie choisis dans les listes de `lib/program-entries.ts`, note, lien source ; compteur dans l'onglet) ; sélecteurs `ProgramSelector`, `YearSelector`. Un champ « URL de la source » dans chaque formulaire de saisie : tarifs, places et classements (déjà là), chiffres clés, accréditations et programme (étape 5, D12) ; « Source 🔗 » sur la carte d'une accréditation. Sous chaque donnée (l'école, chaque campus, programme, tarif, place, classement, accréditation, les chiffres clés de l'année), « Modifié par X le 19 octobre 2026 » : le nom et la date de la dernière modification, sans l'origine (D29, [`LastEdit`](../../app/admin/schools/[id]/LastEdit.tsx)). Les pourcentages des chiffres clés acceptent toutes les décimales (D30 : la base en tient à deux). `?tab=` ouvre un onglet (`info`, `accreditations`, `stats`, `campus-programs`, `pricing`, `rankings`, `capacities`, `admissions`) : la vue des signalements y renvoie (étape 6 ; la catégorie « Admissions » mène au 8e onglet, D52). La barre d'onglets, plus large que l'écran, défile en largeur (comme à 7 onglets) | non |
| `/admin/schools/[id]/campuses` | `manager` : les campus d'une école, avec « Modifié par … le … » (D29) | non |
| `/admin/reports` | `manager` (étape 6, D31) : « Signalements », en attente (les plus anciens d'abord) et fermés (les 100 derniers). Pour chacun : l'école, la cible (« supprimé » si le campus ou le programme n'existe plus, D37), la catégorie, le message, le lien (`sourceHref`), le nom affiché de l'auteur (D39) ; « Ouvrir l'onglet de gestion » (l'onglet de la catégorie), « Traiter » et « Rejeter » (dialogue, réponse facultative pour l'auteur). Fermer un signalement ne date aucune donnée (D32) | non |
| `/admin/inbox` | `admin` : la zone tampon, tickets du pipeline IA et contributions passées par l'IA, à valider ou rejeter | **oui** |
| `/admin/users` | `admin` : les comptes (« Comptes » dans le menu) : ajouter une adresse à la liste, retirer un invité, changer un rôle, remettre en première connexion (ou réactiver), désactiver (un actif ou un invité, D24), renseigner l'adresse d'un compte ancien. Aucun e-mail envoyé | non |
| `/admin/cron` | `admin` : pilotage du backend local, passes dues, quotas Tavily, historique des jobs. Depuis l'étape 7, l'historique a une colonne « Lancé par » : le nom affiché du lanceur (D25), ou « non suivi », avec sa raison au survol (D44) ; à l'ancien style de l'écran (D45) | **oui** |

**Écrans à la charte graphique** (étape 4, §6) : la connexion et la première
connexion (gabarit `AuthShell`), « Mon compte » (`SiteShell`) et « Comptes »
(`AdminPage`, dialogues natifs) ; depuis l'étape 6, le formulaire de
signalement (`SiteShell`) et « Signalements » (`AdminPage`, onglets et
dialogue). Les autres gardent l'ancien style jusqu'à l'étape 9.

---

## 4. Routes

Garde de chaque méthode à la fin de l'étape 2 (16 octobre 2026), inchangée à
l'étape 5 (aucune route ajoutée) ; l'étape 6 ajoute les trois méthodes des
signalements (§4.1 bis) ; l'étape 7 n'en ajoute aucune (les routes IA
existantes écrivent et lisent le journal des lancements, §4.2) ; l'étape 8
ajoute les quatre des admissions (§4.1). `Gest.` = `guardManager` (gestionnaire ou admin),
`Admin` = `guardAdmin`, `Session` = `guardSignedIn` (toute session).
60 méthodes : 39 `Gest.`, 18 `Admin`, 3 `Session`.

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
| `schools/[id]/entries` · `programs/[id]/entries` · `program-entries/[id]` | GET Gest. (les admissions des programmes de l'école, `?programId=`) · POST Gest. (une entrée d'un programme) · PUT Gest. (l'entrée entière) · DELETE Gest. Étape 8, D50, au motif des classements ; l'envoi est lu par `readEntry` avant toute lecture en base (400, rien d'écrit) ; une entrée en double (même année, niveau et voie dans le programme) → 400 ; le corps illisible → 400 (`readJsonObject`) |
| `users` | GET Admin (la liste, invités compris, sans empreinte) · POST Admin (ajoute une adresse à la liste : invité `USER`, sans mot de passe, aucun e-mail ; D5) |
| `users/[id]` | DELETE Admin (retire un **invité** ; un compte qui a servi se désactive, D21 ; un invité qui figure comme auteur aussi : 409, D24, comme l'auteur ou le traitant d'un signalement, D38 ; pas soi-même) |
| `users/[id]/role` | PATCH Admin (`USER`, `GESTIONNAIRE`, `ADMIN` ; le dernier admin actif ne se rétrograde pas) |
| `users/[id]/reset` | POST Admin (D4 : remise en première connexion, ou réactivation ; mot de passe effacé, sessions coupées ; pas soi-même, pas sans adresse) |
| `users/[id]/disable` | POST Admin (D21 : un compte actif, ou un invité (D24) ; sessions coupées ; pas soi-même, pas un compte déjà désactivé) |
| `users/[id]/email` | PATCH Admin (D3 : l'adresse d'un compte qui n'en a pas ; l'ancien identifiant cesse alors de servir) |
| `account` | PATCH Session (son nom affiché, D6) |
| `account/password` | PATCH Session (son mot de passe, l'actuel exigé). Personne ne fixe plus le mot de passe d'un tiers (D4) : l'ancienne route `users/[id]/password` est retirée |

Les routes `users/[id]/role`, `reset`, `disable` et `email` passent par
`changeAccount` ([`lib/account-admin.ts`](../../lib/account-admin.ts)) : aucune
ne laisse zéro admin actif. Toutes écrivent une ligne `[audit]` dans le
journal.

Corps de requête : [`lib/request-body.ts`](../../lib/request-body.ts)
(défaut connu : un JSON mal formé rend 500 sur ces routes).

**Provenance des écritures** (étape 5, D10, D11) : chaque `POST`, `PUT` et
`upsert` du contenu ajoute `...provenance(session.user.id, "MANUAL")`
([`lib/provenance.ts`](../../lib/provenance.ts)) : l'auteur vient de la
session que la garde a relue en base, **jamais du corps** de la requête ; la
date est celle du serveur. Un `PUT` qui ne touche que les campus d'un
programme le date aussi. Les routes de saisie lisent `source_url` par
`readSourceUrl` (D27) : vide, pas de lien ; sinon une adresse `http(s)` de
2 048 caractères au plus, sinon 400 « Rien n'a été écrit », avant toute
écriture. Après une écriture réussie, suppressions comprises,
`revalidateContent()` (§3.1).

**Provenance lue** (D29) : les dix routes de lecture qui nourrissent les
écrans de gestion d'une école (`schools/[id]`, `manage`, `campuses`,
`programs`, `pricing`, `capacities`, `rankings`, `stats`, `accreditations`,
et depuis l'étape 8 `entries`)
lisent l'auteur par son seul nom affiché (`AUTHOR_SELECT`) et rendent, sur
chaque ligne, `last_edit` : « Modifié par X le … », ou `null` pour une ligne
non suivie (`forManager`, `describeLastEdit`). Ni l'identifiant de l'auteur
ni l'origine ne partent vers le navigateur.

### 4.1 bis. Signalements (étape 6)

| Route | Méthodes |
|---|---|
| `reports` | POST **Session** (envoyer un signalement : l'auteur est la session, jamais le corps ; une école active, un campus ou un programme **de cette école** sinon 400, le nom de la cible lu en base ; catégorie, message de 10 à 2 000 caractères, lien D27 (D34) ; 10 par heure et par compte, D35 ; 201) · GET Gest. (`{ open, closed }` : en attente du plus ancien au plus récent, puis les 100 derniers fermés ; l'auteur et le traitant par leur nom affiché seul, D39 ; ni identifiant de compte ni adresse) |
| `reports/[id]` | PATCH Gest. (`RESOLVED` ou `REJECTED`, réponse facultative de 1 000 caractères au plus ; le traitant est la session, la date celle du serveur ; seul un signalement en attente se ferme : 409 s'il l'est déjà, 404 s'il n'existe pas) |

Aucune de ces routes n'écrit dans `ContributionInbox` ni n'appelle un modèle
d'IA (D13, piège 6 ; `test/no-public-tickets.test.ts`). Fermer un
signalement ne date aucune donnée du contenu (D32). L'API v1 n'expose rien
des signalements.

### 4.2. Inbox et IA

Tout est réservé à `ADMIN` : les tickets de l'inbox viennent tous du pipeline
IA ou passent par lui.

| Route | Méthodes | Remarque |
|---|---|---|
| `inbox` · `inbox/[id]` | GET Admin | liste et détail des tickets ; sources plafonnées par [`lib/ticket-sources.ts`](../../lib/ticket-sources.ts) |
| `inbox/[id]/validate` | PUT Admin | **écrit les données** (`Campus`, `Program`, `ProgramCampus`, `PricingRecord`, `RankingRecord`, `CapacityRecord`, `SchoolStatsRecord`, `AccreditationRecord`) dans une transaction, avec la provenance `AI` et l'admin qui valide pour auteur (D11) ; le `source_url` des tickets Chiffres clés et Accréditations est enfin écrit (D12). Un campus ou un programme déjà là n'est daté que si la validation lui écrit un champ (`stampUpdate`) |
| `inbox/[id]/reject` | PUT Admin | |
| `inbox/[id]/create-programs` | POST Admin | depuis un ticket `Program_Discovery` (Phase 1) ; provenance `AI` sur les programmes créés, un programme déjà là garde son auteur |
| `inbox/[id]/attachments` | PUT Admin | rattachement campus collecté par l'IA ; provenance `AI` sur les lignes et sur la note de campus du programme |
| `inbox/purge` | DELETE Admin | |
| `trigger-research` · `run-due-passes` | POST Admin | **appellent le backend**. Étape 7 : un lancement réel s'écrit d'abord au journal `ResearchLaunch` (D14, D41), puis son issue (ci-dessous) ; une simulation des passes dues ne s'écrit pas |
| `pipeline-status` | GET Admin | **appelle le backend** |
| `pipeline-jobs` | GET Admin | historique, lu en base ; depuis l'étape 7, chaque job porte `triggered_by` : le nom affiché de son lanceur, ou `null` |

**Journal des lancements** (étape 7, [`lib/research-launches.ts`](../../lib/research-launches.ts)
pour les règles, [`lib/research-launch-log.ts`](../../lib/research-launch-log.ts)
pour la base). Next.js tient seul `ResearchLaunch` (D14) ; le backend gelé ne
le connaît pas, et **Next.js n'écrit jamais `PipelineJob`** (piège 5).

- **La trace d'abord** (D41) : la route écrit le lancement « en attente »
  (`PENDING`) avant l'appel au backend, au nom de la session (jamais du
  corps), à l'heure de la base. Si cette écriture échoue : 500, **rien ne
  part**. Après la réponse, l'issue s'y ajoute : `STARTED` (recherche ciblée :
  200 avec l'id du job ; passes dues : 202 au statut `planned`),
  `NOT_STARTED` (refus du backend, rapport final sans passe, backend
  injoignable), `UNKNOWN` (délai dépassé, réponse illisible : la demande a pu
  partir), avec le code HTTP et le message. Si cette seconde écriture échoue,
  la demande est partie : la réponse du backend revient telle quelle, l'erreur
  est journalisée (`[research-launch]`), et le lancement reste en attente,
  sans job relié. Une ligne `[audit]` dit chaque lancement noté.
- **Le lanceur d'un job** (lecture de `pipeline-jobs`) : une recherche ciblée
  par l'id de job que le backend a rendu (lancements `STARTED`) ; une passe
  due par la **fenêtre** de son lancement (D40) : la réponse 202 ne porte
  aucun id de job, et les jobs `rotation` naissent après elle, un par un.
  Chaque lancement de passes dues qui a pu partir (tout sauf `NOT_STARTED`)
  reçoit les jobs `rotation` nés à partir de son heure et avant le suivant,
  au plus `max_passes` ; le verrou du backend (409 si une exécution réelle
  tourne) empêche deux exécutions de se mêler. Un job d'avant le journal, de
  l'ancien cron, ou lancé hors de l'écran (appel direct au backend avec le
  jeton, guide de test) n'a pas de lanceur : « non suivi » (D44), jamais une
  devinette. Un job dont le lancement est resté en attente ou inconnu est
  aussi « non suivi » ; le lancement se lit en base.
- **La purge** (D43) : le backend supprime ses jobs terminés (7 jours pour
  une recherche ciblée Phase 2, 400 pour un passage complet) ; le journal,
  lui, reste. L'écran ne montre que les 30 derniers jobs encore en base ; un
  lancement dont le job est purgé se lit en base, pas à l'écran.

### 4.3. Lecture du site

Session exigée par le proxy (401 en JSON sans session) ; les routes elles-mêmes
ne lisent pas la session, ce qui garde leur cache ISR.

- `app/api/schools/*` : 3 routes GET, ISR 1 h, utilisées par l'accueil.
- `app/api/v1/*` : 15 routes GET, plafonnées à 60 requêtes par minute et par
  IP ; de la provenance, la date seule (`updated_at`, D25 revue le
  20 octobre). Depuis l'étape 8, le détail d'un programme et la comparaison
  portent ses admissions (`entries`, D53). Référence : [`API-rest.md`](API-rest.md).
- `app/api/first-login` : POST, **sans session** (proxy), au plafond de la
  connexion ; la seule route hors de `/api/auth/*` ouverte sans session (§2.2).
- `app/api/contribute` : **retirée** (D2), remplacée par le signalement
  (§4.1 bis). Aucun fichier de `app/` ni de `lib/` ne crée plus de ticket
  `ContributionInbox` (`test/no-public-tickets.test.ts`, piège 6) : seul le
  backend gelé en écrit.

---

## 5. Tables

Schéma : [`prisma/schema.prisma`](../../prisma/schema.prisma) ; référence :
[`bdd.md`](bdd.md) ; vue d'ensemble pour l'équipe : le doc « Données stockées
sur les écoles » du propriétaire.

| Table | Rattachée à | Lien source | Écrite par |
|---|---|---|---|
| `School` | — | non (le domaine officiel en tient lieu) | Next.js |
| `Campus` | école | non | Next.js |
| `Program` | école (pas un campus) | oui (étape 5, D12) | Next.js |
| `ProgramCampus` | programme × campus | non | Next.js |
| `ProgramCampusAttachment` | programme × campus × année d'études | oui | Next.js, depuis l'inbox seulement (`inbox/[id]/attachments`) |
| `PricingRecord` | programme × année scolaire | oui | Next.js |
| `CapacityRecord` | programme × campus × année scolaire | oui | Next.js |
| `RankingRecord` | programme × année × média | oui | Next.js |
| `SchoolStatsRecord` | école × année | oui (étape 5, D12) | Next.js |
| `AccreditationRecord` | école | oui (étape 5, D12) | Next.js |
| `ProgramPlacement` | programme | oui | aucun chemin d'écriture (abandonné, gardé) |
| `ProgramEntry` | programme × année d'entrée × niveau requis × voie | oui (étape 8, D49) | Next.js (onglet « Admissions », étape 8) |
| `User` | — | — | Next.js (§2.3) |
| `ContributionInbox` | école, campus, programme (facultatifs) | `urls[]` | Next.js **et** backend Python |
| `PipelineJob` | école | — | backend Python seulement (Next.js la lit, ne l'écrit jamais : D14) |
| `ResearchLaunch` | lanceur (`User`) ; un job par son id, sans clé | — | Next.js seulement (`trigger-research`, `run-due-passes`, étape 7) |
| `ContentReport` | école ; campus ou programme facultatif | oui (facultatif) | Next.js seulement (`/api/admin/reports`, étape 6) |

**Provenance** (étape 5, migration `20261019120000_content_provenance`,
appliquée sur `dev` et sur `main` le 20 octobre) : les neuf tables
de données, de `School` à `ProgramCampusAttachment` (pas `ProgramCampus`, une
arête sans contenu propre, ni `ProgramPlacement`, sans chemin d'écriture),
portent la **dernière** modification : `updated_by_id` (clé vers `User`,
`RESTRICT`, D24), `updated_at` et `updated_via` (`MANUAL`, `AI`, `REPORT` :
contrainte `CHECK`). Les trois sont vides ensemble (ligne « non suivie »,
écrite avant la migration et jamais modifiée depuis) ou pleines ensemble
(contrainte `CHECK`). Une suppression ne laisse pas de trace ; il n'y a pas
d'historique complet (D10). Depuis l'étape 8, `ProgramEntry` porte la même
provenance (D49).

**Admissions** (étape 8, migration `20261020180000_program_entries`,
appliquée sur `dev` le 20 octobre ; `main` à la prochaine mise en
production) : `ProgramEntry` (D16) dit, pour un programme, en quelle année on
entre (`entry_year`, 1 à 5), avec quel niveau (`required_level`, 0 pour le
Bac à 5 pour Bac+5) et par quelle voie (`route`, cinq valeurs, `UNSPECIFIED`
par défaut), avec une note de 500 caractères au plus et un lien source ;
une seule ligne par année, niveau et voie dans un programme (index unique).
Un programme supprimé emporte ses entrées (`CASCADE`). `admission_exam`, sur
`Program`, reste tel quel (D47). La même migration élargit
`ContentReport_category_check` à `ADMISSIONS` (D52). Listes et contraintes :
`bdd.md` §4.

**Signalements** (étape 6, migration `20261020120000_content_reports`,
appliquée sur `dev` et sur `main` le 20 octobre) : `ContentReport` (D13) garde l'auteur,
l'école, la cible (`target_type`, le nom à l'envoi `target_label`, la clé du
campus ou du programme), la catégorie, le message, le lien, l'état (`OPEN`,
`RESOLVED`, `REJECTED`), la réponse, qui l'a traité et quand. Une école
supprimée emporte ses signalements ; un campus ou un programme supprimé
laisse le sien à l'école, avec son nom (D37). Contraintes et clés : `bdd.md`
§4.

**Journal des lancements** (étape 7, migration
`20261020150000_research_launches`, appliquée sur `dev` et sur `main` le
20 octobre) :
`ResearchLaunch` (D14) garde qui a lancé quoi (le corps envoyé au backend),
quand (l'heure de la base, `CURRENT_TIMESTAMP`, comme `PipelineJob.started_at`
que le backend écrit : la fenêtre de D40 compare les deux), l'issue (D41), le
code HTTP, le message, et l'id du job d'une recherche ciblée, **sans clé vers
`PipelineJob`** (une clé bloquerait la purge du backend). Contraintes et clé :
`bdd.md` §4.

Le backend Python **lit** les tables de données (diff de la Phase 2) et
**écrit** `ContributionInbox` et `PipelineJob`. Il ne connaît ni
`ContentReport`, ni `ResearchLaunch`, ni `ProgramEntry`. Ajouter une colonne obligatoire
à ces deux tables, ou renommer une colonne qu'il lit, casse le backend gelé.

---

## 6. Styles

Deux mondes jusqu'à l'étape 9 du plan (G7, piège 10). Référence :
[`charte-graphique.md`](charte-graphique.md).

| | Écrans | Où |
|---|---|---|
| **La charte** (étape 4 : maquette A « Registre », D8 composants maison, D9 clair) | connexion, première connexion, « Comptes » (`/admin/users`), « Mon compte » (`/account`) ; étape 6 : le formulaire de signalement (`/schools/[id]/report`), « Signalements » (`/admin/reports`) | Tailwind CSS v4 ; jetons et base dans [`app/charte.css`](../../app/charte.css) ; composants dans [`components/ui/`](../../components/ui/) ; gabarits dans [`components/layout/`](../../components/layout/) (`SiteShell`, `AuthShell`, `AdminPage`) |
| **L'ancien style** | tous les autres : accueil, fiches, `/api-docs`, écoles et onglets de gestion, inbox, `/admin/cron`, menu latéral du back-office | [`app/globals.css`](../../app/globals.css), inchangé, rangé dans la couche `legacy` : thème sombre, 21 variables CSS, classes globales (`badge`, `admin-layout-wrapper`…) ; `styled-jsx` dans quelques écrans |

- [`app/globals.css`](../../app/globals.css) est le point d'entrée : ordre des
  couches `theme, legacy, base, components, utilities`, thème et utilitaires de
  Tailwind **sans preflight**, `@source` limités aux dossiers des écrans repris
  (`components/`, `app/(admin-auth)/admin/`, `app/admin/users/`,
  `app/account/`, et depuis l'étape 6 `app/schools/[id]/report/` et
  `app/admin/reports/` ; Tailwind lit `[id]` à la lettre, le dossier existant) ; `block` et `fill-accent`, homonymes de classes de
  `/admin/cron`, ne sont jamais générés.
- La racine de chaque gabarit porte la classe `charte` : la base de la charte
  n'agit que dans ce sous-arbre. Le menu latéral du back-office reste l'ancien
  (décision du 19 octobre) ; `.admin-content-area:has(.charte)` peint la zone
  de contenu d'un écran repris au fond de la charte.
- Polices par `next/font` (`app/layout.tsx`) : Inter pour l'ancien style,
  IBM Plex Sans, Sans Condensed et Mono pour la charte.
- Les ajouts de l'étape 5 aux anciens écrans (champs « URL de la source »,
  ligne `SourceLine` des fiches, « Source 🔗 » des accréditations, ligne
  `LastEdit` du gestionnaire) suivent
  **l'ancien style** de chaque écran, avec ses `style` en ligne, sans règle
  ajoutée à `globals.css` (D28) ; ils passeront à la charte avec leurs
  écrans, à l'étape 9. De même le lien « Signaler une information » des
  fiches (étape 6, D33), en `btn btn-secondary`, et, à l'étape 8 (D51),
  l'onglet « Admissions » (`AdmissionsTab`, sur les motifs de l'onglet
  Accréditations : cartes, fenêtre) et la section « Admissions » de la fiche
  programme (`ranking-item` et `SourceLine`) ; leur texte vient de
  `lib/program-entries.ts`, sans style.
- Deux défauts des composants de l'étape 4, vus au contrôle visuel de
  l'étape 6 et corrigés : les onglets (`Tabs`) montraient une barre de
  défilement verticale (le filet du bas est désormais une ombre intérieure) ;
  le dialogue (`Dialog`) se refermait aussitôt ouvert sous `next dev`
  (effets rejoués par React : un `close` natif n'est suivi que si le
  dialogue est resté fermé).
- CSP posée par [`next.config.ts`](../../next.config.ts), inchangée :
  `style-src 'self' 'unsafe-inline'` ; aucune violation sur un build de
  production (19 octobre).

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
  `fake-backend.ts`, `provenance.ts` (`contentOf` vérifie puis retire la
  provenance d'une écriture, pour que l'attendu d'un test dise le contenu ;
  `installContentCache` remplace `next/cache`, dont `revalidatePath` lève hors
  de Next). `fake-users.ts` sait aussi qu'un compte est auteur : sa
  suppression lève P2003, comme la clé `RESTRICT`.
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
- **Provenance** (étape 5) : `test/provenance.test.ts` (`lib/provenance.ts` :
  origines, lien source contrôlé et protégé, texte et date en français, nom
  de l'auteur), `test/provenance-migration.test.ts` (la migration, additive,
  ses clés et contraintes, `schema.prisma`, sans `@updatedAt`),
  `test/api/provenance.test.ts` (chaque écriture des neuf tables, routes de
  gestion et de l'inbox, porte l'auteur de la session et non celui du corps ;
  les tables non suivies n'en reçoivent pas ; revalidation après une écriture
  réussie seulement), `test/api/source-url.test.ts` (D27 sur chaque saisie,
  D12), `test/api/v1-provenance.test.ts` (chaque route v1 et chaque
  enregistrement imbriqué : la date, ni auteur ni origine, rien de l'auteur
  lu), `test/api/manager-provenance.test.ts` (les neuf lectures du
  gestionnaire : « Modifié par … le … », le nom seul, ni origine ni
  identifiant ; chaque route d'une école qu'appellent ses écrans est
  couverte), `test/manager-screens.test.ts` (`LastEdit` sur chaque écran de
  gestion ; D30, les pourcentages en `step="any"`),
  `test/provenance-pages.test.ts` (les fiches rendues : source, « Modifié
  par », pas d'adresse ni de lien hors `http(s)`) ; dans `users.test.ts`, D24.
- **Signalements** (étape 6) : `test/content-reports.test.ts`
  (`lib/content-reports.ts` : corps lu et borné, longueur comptée comme
  Postgres, lien D27, décision, onglet de chaque catégorie, ce que voient le
  gestionnaire et l'auteur), `test/content-reports-migration.test.ts` (une
  table neuve, rien d'autre ; contraintes et clés alignées sur le code et
  `schema.prisma`), `test/api/reports.test.ts` (les trois méthodes : auteur
  et traitant de la session, cible de l'école, école active, plafond par
  compte après la lecture du corps, rien dans l'inbox, 409 sur un
  signalement fermé), `test/reports-pages.test.ts` (les liens des fiches,
  la page du formulaire, « Vos signalements », la vue des gestionnaires,
  `?tab=`) ; dans `users.test.ts`, D38 ; le menu et le niveau de l'écran
  dans `admin-pages.test.ts`.
- **Journal des lancements** (étape 7) : `test/research-launches.test.ts`
  (`lib/research-launches.ts` : l'issue de chaque réponse, le message borné,
  la fenêtre des passes dues et sa borne N), `test/research-launches-migration.test.ts`
  (une table neuve, rien vers `PipelineJob` ; contraintes alignées sur le
  code, `launched_at` à l'heure de la base, clé `RESTRICT`, `schema.prisma` ;
  aucun fichier de `app/` ni de `lib/` n'écrit `PipelineJob`) ; dans
  `test/api/trigger-research.test.ts` et `run-due-passes.test.ts`, la trace
  d'abord (écrite avant l'appel, au nom de la session ; rien ne part si elle
  échoue ; la réponse revient telle quelle si l'issue ne s'écrit pas ; une
  simulation ne s'écrit pas) ; dans `pipeline-jobs.test.ts`, le lanceur de
  chaque job (par l'id, par la fenêtre, « non suivi », le nom seul) ; dans
  `pipeline-history.test.ts`, « non suivi » et la colonne de l'écran ; dans
  `users.test.ts`, D42.
- **Admissions** (étape 8) : `test/program-entries.test.ts`
  (`lib/program-entries.ts` : listes, libellés, phrase de chaque entrée,
  lecture d'un envoi bornée, note comptée comme Postgres, lien D27, rien de
  l'auteur ni du programme lu dans le corps), `test/program-entries-migration.test.ts`
  (une table neuve, la seule suppression est la contrainte des catégories
  qu'elle remplace ; contraintes alignées sur le code, provenance de
  l'étape 5, clés `CASCADE` et `RESTRICT`, `schema.prisma`, `Program` non
  touchée), `test/api/program-entries.test.ts` (les quatre méthodes : auteur
  de la session, programme de l'URL, envoi illisible ou doublon → 400 sans
  écriture, P2002, 404, revalidation, rien dans l'inbox) ; scénarios ajoutés
  à `api/provenance`, `api/source-url`, `api/manager-provenance` (la lecture
  de l'onglet), `manager-screens` (l'onglet, ses routes, ses listes, l'ancien
  style), `api/v1-provenance` et `api/v1` (les admissions imbriquées),
  `provenance-pages` (la section de la fiche) ; `content-reports`,
  `content-reports-migration` et `reports-pages` suivent D52 et D50.
- **Verrous** : `test/api-docs.test.ts` (`/api-docs` = réponses réelles),
  `test/page-titles.test.ts`, `test/silent-pages.test.ts`.
- **Charte** (étape 4) : `test/ui-components.test.ts` (le HTML rendu par
  React côté serveur : libellés, aides et erreurs reliés, rôles des messages,
  onglets au modèle ARIA et leur clavier, dialogue nommé, boutons qui
  n'envoient pas un formulaire par défaut, racine `charte` des gabarits),
  `test/charte.test.ts` (compilation de `app/globals.css` par PostCSS et
  Tailwind : pas de preflight, aucune règle hors couche, aucun utilitaire
  homonyme d'une ancienne classe, chaque fichier qui emploie la charte lu par
  `@source` ; les écrans repris sans ancienne classe ni `style` en ligne ;
  jetons et contrastes identiques à `charte-graphique.md` §2 et §3).
- `npm run smoke` : contre `npm run dev`, d'abord **le mur** sans session
  (connexion et première connexion 200, chaque page renvoyée vers la
  connexion, `/account` et le formulaire de signalement compris, `/api/schools` et les 15 `GET /api/v1/*` en
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
