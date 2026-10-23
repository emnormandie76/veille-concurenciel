# Le gestionnaire de contenu — état du code

> Ce que fait le code de la branche `gestion` et de `main`, la production,
> qui la suit par avance rapide. Chaque étape du plan
> [`features/gestion-contenu.md`](../features/gestion-contenu.md) la tient à
> jour ; les décisions citées (G1 à G9, D1 à D115) et les pièges y sont
> expliqués. Point d'entrée pour travailler sur le site : la partie IA, gelée,
> vit sur la branche `local` (§1).

---

## 1. Ce que c'est

Le site Next.js 16 (`app/`) porte tout le gestionnaire de contenu : la
consultation, le back-office qui crée, modifie et supprime les données des
écoles, et l'API v1. Il lit et écrit la base Neon par Prisma
([`lib/prisma.ts`](../../lib/prisma.ts), WebSocket sur le port 443).

**Il ne joint aucun backend.** La console IA (`/admin/cron`), ses routes
(`trigger-research`, `run-due-passes`, `pipeline-status`, `pipeline-jobs`,
`schools-with-programs`), le backend Python et ses tests vivent sur la
branche **`local`**, un instantané de `gestion` à la fin de l'étape 10
(`e4ba0c5`), lancé sur le poste de l'admin (D100, D101). Sur `gestion` et
`main`, aucun code ne lit `FASTAPI_URL` ni `INTERNAL_API_TOKEN`, et aucune
commande ne lance le backend : rien ne peut payer Tavily ni Gemini
(`test/no-ai-backend.test.ts`). **L'inbox reste en ligne**, avec la
validation des tickets IA (§4.2) : elle ne lit et n'écrit que la base. On ne
fusionne jamais `gestion` dans `local` (le retrait s'y appliquerait) : un
correctif s'y reporte par `cherry-pick`.

Le backend de `local` partage la base : il écrit `ContributionInbox` et
`PipelineJob`, et les routes de `local` écrivent `ResearchLaunch` ; les trois
tables restent au schéma (§5).

---

## 2. Authentification et accès

### 2.1. Les trois rôles

[`lib/roles.ts`](../../lib/roles.ts) (module sans dépendance, liste de
référence ; décision G4) :

| Rôle | Qui | Peut |
|---|---|---|
| `USER` | toute personne connectée | consulter le site, `/api-docs` et l'API v1 ; **signaler une information** depuis une fiche et en suivre la suite ; changer son nom affiché et son mot de passe sur « Mon compte » (`/account`) ; lire **l'aide** (`/help`), le guide de son rôle (D108). **Ne voit pas `/admin`** |
| `GESTIONNAIRE` | qui tient le contenu à jour | en plus : le back-office du contenu (écoles, campus, programmes, tarifs, places, classements, chiffres clés, accréditations, admissions), créations et suppressions comprises (D19), et **les signalements** (`/admin/reports`, D31) |
| `ADMIN` | qui gère les accès | en plus : les comptes (liste blanche, rôles, remise en première connexion, désactivation), et **seul l'IA** : l'inbox (la console vit sur la branche `local`, D100) |

Trois niveaux d'accès (`AccessLevel`) : `signedIn` (toute session), `manager`
(gestionnaire ou admin), `admin`. `hasAccess(role, level)` les juge ;
`ROLE_LABELS` donne les libellés de l'interface.

### 2.2. Qui contrôle quoi

| Élément | Où | Ce qu'il fait |
|---|---|---|
| Connexion | [`app/api/auth/[...nextauth]/route.ts`](../../app/api/auth/[...nextauth]/route.ts), [`lib/sign-in.ts`](../../lib/sign-in.ts) | NextAuth v4, `CredentialsProvider` (champ `login`) : l'**adresse** de travail et le mot de passe (bcrypt) contre `User`. L'ancien identifiant (`username`) ne vaut que pour un compte qui n'a pas encore d'adresse (D3) ; seul un compte **actif** se connecte. Pas d'auto-inscription. Session **JWT de 8 h**. Le rôle est copié dans le jeton **à titre indicatif** (D1) ; la **version de session** du compte aussi, et elle, compte (D20) |
| Page de connexion | `app/(admin-auth)/admin/login/` | hors du layout admin (groupe de routes), pour éviter la boucle de redirection ; ouverte sans session. Après la connexion, revient au `callbackUrl` posé par le proxy s'il désigne un chemin du site ([`lib/callback-url.ts`](../../lib/callback-url.ts), pas de redirection ouverte, ni vers la connexion ni vers la première connexion), sinon `/admin/schools`. Renvoie vers la première connexion |
| Première connexion | `app/(admin-auth)/admin/first-login/`, [`app/api/first-login/route.ts`](../../app/api/first-login/route.ts) | G5 : la personne saisit l'adresse que l'admin a mise sur la liste, son nom affiché (prérempli depuis `prenom.nom@…`, D6) et son mot de passe ([`lib/password.ts`](../../lib/password.ts)) ; le compte passe d'invité à actif, puis la page la connecte. La route ne fait qu'une mise à jour visant l'adresse **dans l'état invité** : une adresse hors liste ne crée rien, et un compte actif ou désactivé reçoit le même refus (403). Ouverte sans session, **hors de `/api/auth/*`** exprès |
| Session | [`lib/auth.ts`](../../lib/auth.ts), `getSession()` | lit le jeton, puis **relit le compte en base par son id** à chaque appel (D1) : nom affiché, adresse et rôle viennent de la base. `null` sans session, sur un cookie illisible, si le compte n'existe plus, s'il **n'est pas actif** (invité après une remise à zéro, désactivé) ou si la version de session du jeton n'est pas celle du compte (jeton d'avant une remise à zéro : D20). Un rôle inconnu en base ne vaut que `USER`. Une panne de la base remonte (500), elle ne se déguise pas en refus |
| Gardes des API | `lib/auth.ts` | `guardSignedIn()` : 401 sans session. `guardManager()` : 401, puis 403 pour un `USER`. `guardAdmin()` : 401, puis 403 hors `ADMIN`. Chaque handler de `app/api/admin/**` en attend **une seule** (piège 1) |
| Gardes des écrans | `lib/auth.ts`, `requirePage(level)` | rend la session, ou redirige : vers la connexion sans session, vers `/` pour un `USER`, vers `/admin/schools` pour un gestionnaire sur un écran `admin` |
| Proxy | [`proxy.ts`](../../proxy.ts) (tient lieu de middleware) | **session exigée sur tout le site** (G6), sauf `/admin/login`, `/admin/first-login`, `POST /api/first-login` et `/api/auth/*` (chemins dans [`lib/roles.ts`](../../lib/roles.ts)). Sans session : une page renvoie vers `/admin/login?callbackUrl=…`, une route `/api/*` répond 401 en JSON. Ne regarde que l'existence d'un jeton valide (contrôle « optimiste », doc Next 16), jamais le rôle ni l'état du compte. Matcher : tout sauf `_next/static`, `_next/image`, `favicon.ico`. Plafonds de débit : §8.1 |
| Signalement | [`app/api/admin/reports/route.ts`](../../app/api/admin/reports/route.ts), [`lib/content-reports.ts`](../../lib/content-reports.ts) | `POST` en `guardSignedIn` : l'auteur est le compte de la session, jamais le corps. **10 envois par heure et par compte** (D35 : l'équipe sort par la même IP), par `checkRateLimit("report:<compte>")` de `lib/rate-limit.ts`, compté une fois le corps lu et avant toute lecture en base ; au-delà, 429 avec `Retry-After`. Le seul plafond hors du proxy, parce que le proxy ne connaît pas le compte |
| Layout admin | [`app/admin/layout.tsx`](../../app/admin/layout.tsx) | `requirePage("manager")` : un `USER` est renvoyé vers le site (piège 2) |
| Écrans IA et comptes | `app/admin/inbox/layout.tsx`, `app/admin/users/page.tsx` | `requirePage("admin")` |
| « Mon compte » | [`app/account/page.tsx`](../../app/account/page.tsx) | `requirePage("signedIn")` : toute session, hors du back-office. Nom affiché et mot de passe, par `PATCH /api/admin/account` et `PATCH /api/admin/account/password`, qui ne prennent aucun identifiant. « Vos signalements » (D36) : la page lit en base les signalements **de la session**, et eux seuls |
| Aide | [`app/help/page.tsx`](../../app/help/page.tsx), [`guides.tsx`](../../app/help/guides.tsx) | `requirePage("signedIn")` : toute session ; le guide du rôle relu en base (D1), et lui seul (`guideFor`, D108) ; la page n'est pas en cache |
| Lien « Back-office » de la barre du site | [`components/layout/SiteShell.tsx`](../../components/layout/SiteShell.tsx), [`BackOfficeLink.tsx`](../../components/layout/BackOfficeLink.tsx), [`back-office-access.ts`](../../components/layout/back-office-access.ts), [`app/api/admin/account/back-office/route.ts`](../../app/api/admin/account/back-office/route.ts) | D104 : sur toutes les pages du site, pour un gestionnaire ou un admin, jamais pour un `USER`. Une page qui lit la session le dit au gabarit (`showBackOffice`) ; les autres (accueil, fiches en cache, `/api-docs`) laissent la barre demander à `GET /api/admin/account/back-office` (`guardSignedIn`, rôle relu en base, D1), qui ne rend que `{ backOffice: true \| false }`, en `private, no-store`. Le lien ne fait que montrer le chemin : le layout `/admin` contrôle l'accès |
| Menu | [`app/admin/nav.ts`](../../app/admin/nav.ts), `SidebarClient.tsx` | `navFor(role)` : un gestionnaire voit « Écoles & Campus » et « Signalements » ; un admin voit aussi l'inbox et « Comptes ». Le menu ne fait que masquer : le contrôle est côté serveur. « Aide » (D109) et « Mon compte » sont au pied du menu, hors de `navFor`. Texte seul (D93), `aria-current="page"` sur l'entrée de l'écran affiché ; sous 1 024 px, replié derrière un bouton « Menu » (D94). `AdminMenu`, sa partie sans état, se rend côté serveur (`test/admin-frame.test.ts`) |
| Déconnexion | `app/admin/SidebarClient.tsx`, [`app/SignOutButton.tsx`](../../app/SignOutButton.tsx) | dans le menu du back-office, et dans la barre du site, après « Mon compte » |
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
`20261016150000_whitelist_accounts`) :

| Colonne | Contenu |
|---|---|
| `email` | adresse de travail, unique, en minuscules ; vide seulement pour un compte d'avant la liste blanche (D3) |
| `username` | ancien identifiant, unique, facultatif : seuls les comptes d'avant la liste blanche en ont un ; il ne sert à la connexion que tant que l'adresse est vide |
| `display_name` | nom affiché (D6), choisi à la première connexion, modifiable sur « Mon compte » |
| `password_hash` | bcrypt ; vide tant que la personne n'a pas fait sa première connexion, et après une remise à zéro ou une désactivation |
| `role` | `USER` (défaut), `GESTIONNAIRE`, `ADMIN` : contrainte `User_role_check` (posée `NOT VALID`) |
| `status` | `INVITED` (défaut), `ACTIVE`, `DISABLED` : contrainte `User_status_check` |
| `first_login_at` | date de la première connexion (remise à vide par une remise à zéro) |
| `session_version` | défaut 0 ; recopiée dans le jeton à la connexion, augmentée par une remise à zéro ou une désactivation (D20) |

Quatre autres contraintes `CHECK` tiennent les invariants dont dépend le code :
un compte est actif **si et seulement si** il a un mot de passe ; un invité a
une adresse ; tout compte a une adresse ou un ancien identifiant ; l'adresse
est en minuscules.

Plusieurs tables pointent vers `User`, toutes en `ON DELETE RESTRICT` : la
base refuse de supprimer un compte qui y figure. Ce sont les neuf tables de
données et `ProgramEntry`, par `updated_by_id` (§5, D24) ; `ContentReport`,
par `author_id` et `handled_by_id` (D38) ; `ResearchLaunch`, par
`triggered_by_id` (D42 ; seule la branche `local` écrit ce journal).

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

Tous les écrans sont dans la charte graphique, chacun dans son gabarit
(§6, [`charte-graphique.md`](charte-graphique.md)).

### 3.1. Site (toute session)

| Chemin | Rôle | Données |
|---|---|---|
| `/` ([`app/page.tsx`](../../app/page.tsx)) | liste et recherche des écoles | client : `fetch('/api/schools')`, écoles `ACTIVE` seulement, erreurs par [`lib/public-schools.ts`](../../lib/public-schools.ts) ; les programmes de chaque école par `programs_count`, comme sa fiche (D75) |
| `/schools/[id]` | fiche école (campus, programmes, chiffres clés, accréditations) | serveur, Prisma, ISR 1 h ; une école non `ACTIVE` rend 404 |
| `/schools/[id]/programs/[pid]` | fiche programme (admissions, tarifs, places, classements, rattachements) | serveur, Prisma, ISR 1 h |
| `/api-docs` | documentation de l'API v1 | statique, verrouillée par `test/api-docs.test.ts` |
| `/schools/[id]/report` | « Signaler une information » : la cible (l'école, un de ses campus ou de ses programmes ; `?program=` la choisit depuis la fiche programme), la catégorie, le message, un lien facultatif | serveur (`requirePage("signedIn")`, Prisma : une école active seulement), formulaire client ; envoi par `POST /api/admin/reports` |
| `/account` | « Mon compte » : adresse, rôle, nom affiché, mot de passe ; « Vos signalements » (D36) : date, cible, catégorie, état, réponse | serveur (`requirePage("signedIn")`), formulaires client |
| `/help` | « Aide » (D108) : le guide du rôle de la session, et lui seul (l'utilisateur, le gestionnaire ou l'administrateur) : un sommaire, puis ses sections, coupées de captures d'écran (D111) | serveur (`requirePage("signedIn")`, rôle relu en base, D1), sans cache ; le texte est dans le code (`app/help/guides.tsx`) |

Les pages en cache ISR ne lisent pas la session : le proxy passe avant le
cache, et le mur tient (plan, piège 4).

Toutes les pages du site sont sur le gabarit `SiteShell`. La fiche école a
trois onglets (Programmes, Statistiques, Accréditations), au modèle ARIA de la
charte, et des filtres (boutons enfoncés, `aria-pressed`) ; `/api-docs` a
trois colonnes (une seule sur un téléphone) et un panneau d'exemples en clair
(onglets cURL, JavaScript, Python, D59). Les deux champs de recherche ont un
libellé visible (D58). Aucun émoji (D56).

**La barre du site** (`SiteShell`) : Écoles, API, Back-office pour qui y a
droit, Aide (D109), Mon compte, Se déconnecter. Le lien « Back-office » est sur **toutes
les pages, dès la connexion**, pour un gestionnaire ou un admin, jamais pour
un `USER` (D104) :

- « Mon compte », l'aide et le formulaire de signalement lisent la session
  (relue en base, D1) : ils passent `showBackOffice`, et le lien est dans leur
  HTML ;
- l'accueil, les deux fiches et `/api-docs` ne la lisent pas (cache ISR, page
  statique) : ils ne passent rien, et la barre pose `BackOfficeLink`, un
  composant client qui demande à `GET /api/admin/account/back-office` (§4.1)
  si le compte a accès au back-office. Le HTML du serveur n'a jamais le lien :
  rien n'apparaît puis disparaît pour un `USER` ; pour un gestionnaire, le
  lien arrive avec la réponse au premier chargement de l'onglet ;
- la réponse est gardée en mémoire le temps de l'onglet
  (`back-office-access.ts`, lue par `useSyncExternalStore`) et revérifiée à
  chaque page : d'une page à l'autre, le lien reste en place ; un rôle retiré
  le fait partir à la page suivante. Dans le doute (session finie, erreur,
  réseau), pas de lien. Une déconnexion recharge la page et vide la mémoire.
  Coût : une lecture du compte en base par page vue, la même que celle de
  toute garde ; les pages, elles, gardent leur cache.

Sur un téléphone (390 px), depuis l'ajout d'« Aide » (étape 14), la barre
passe sur deux lignes, avec ou sans « Back-office » : celle d'un `USER`
gagne une ligne, et le contenu ne descend plus quand le lien d'un
gestionnaire arrive au premier chargement de l'onglet (relevé du
23 octobre). Sur grand écran, les entrées glissent vers la gauche, sans
changer de hauteur.

**Signaler une information** (G8, D33) : les fiches école et programme
portent un lien « Signaler une information », en bouton secondaire
(`buttonClasses`), vers `/schools/[id]/report` (depuis une fiche programme :
`?program=<id>`). Les fiches ne lisent pas la session et gardent leur cache.
Aucune IA : le signalement va dans `ContentReport`, jamais dans l'inbox (D13,
piège 6). L'auteur suit la suite donnée sur « Mon compte » (D36) ; aucun
e-mail.

**Provenance affichée** : une ligne « Source ↗ · Modifié par … le … »
([`app/schools/SourceLine.tsx`](../../app/schools/SourceLine.tsx)) sous
l'en-tête de l'école, ses chiffres clés et chacune de ses accréditations ; sous
l'en-tête du programme, dans une colonne « Source » des tarifs, sous chaque
classement et sur chaque carte de places. Le texte vient de
`describeProvenance` ([`lib/provenance.ts`](../../lib/provenance.ts)) :
« Modifié par X le 19 octobre 2026 », « Validé par X le …, depuis une
recherche IA » (D11), « … après un signalement » (prévu pour l'origine
`REPORT`, qu'aucun code n'écrit : D32) ; rien pour une donnée non suivie. X est le nom affiché, sinon « Compte sans nom », jamais l'adresse ni
l'identifiant (D25) : les pages ne lisent de l'auteur que `display_name`, et
la fiche école, composant client, reçoit le texte déjà préparé
(`forDisplay`). Seul un lien `http(s)` est cliquable (`sourceHref`, D27), en
nouvel onglet (`noopener noreferrer`). La provenance d'un campus ne s'affiche
pas sur le site (la fiche ne montre que son nom) : elle se lit dans le
gestionnaire (§3.2) ; celle d'un rattachement reste en base (aucun écran ne
les montre). L'API v1 ne rend que la date, ni l'auteur ni l'origine (D25).

**Admissions** (D16) : la fiche programme ouvre sur une section
« Admissions », avant les tarifs : une ligne par entrée possible, dans l'ordre
de l'année d'entrée puis du niveau (« Entrée en 3e année avec un Bac+2, sur
concours », texte de `describeEntry`, [`lib/program-entries.ts`](../../lib/program-entries.ts)),
sa note (le concours, les diplômes acceptés) et sa `SourceLine` ; « Aucune
donnée d'admission disponible. » sinon. L'étiquette du concours
(`admission_exam`) reste dans l'en-tête (D47).

**L'aide** (étape 14, D108 à D115) : « Aide », dans la barre et au pied du
menu du back-office (D109), mène à `/help`, où chacun ne lit que le guide de
son rôle. Le texte, avec les libellés exacts de l'interface, est dans
[`app/help/guides.tsx`](../../app/help/guides.tsx) ; aucun nom
d'application, « le site » (D115). Neuf captures d'écran, sous
`public/help/`, préfixées par le guide qui les montre (D111) : prises sur la
base `dev`, sans adresse, sans le compte de test ni le nom d'un collègue ;
servies derrière la connexion, comme tout le site, en `next/image`
`unoptimized` (l'optimiseur d'images les demanderait sans session, et le
proxy les lui refuserait). Les trois Word de `docs/guide/` sont un autre
texte (D112), sur les mêmes captures : un changement d'écran se reporte
dans la page, dans les Word et, au besoin, dans les captures.

**Cache** (D26, piège 4) : après chaque écriture réussie du contenu, la route
appelle `revalidateContent()` ([`lib/content-cache.ts`](../../lib/content-cache.ts)),
qui invalide `/schools` et `/api/schools` en `layout` : toutes les fiches
école et programme et les trois routes de l'accueil se régénèrent à la visite
suivante, au lieu d'attendre l'heure de l'ISR. Un échec de la revalidation
est journalisé (`[cache]`), il n'annule pas l'écriture.

### 3.2. Back-office

| Chemin | Niveau | IA ? |
|---|---|---|
| `/admin/schools` | `manager` : liste, création et suppression des écoles ; recherche libellée « Rechercher une école » (D65) ; badge de statut d'un ton par statut (D66, `school-status.ts`) | non |
| `/admin/schools/[id]/manage` | `manager` : **la gestion de contenu d'une école**, 8 onglets (`manage/tabs/`) : `SchoolInfoTab`, `CampusProgramsTab`, `PricingTab`, `CapacitiesTab`, `RankingsTab`, `StatsTab`, `AccreditationsTab`, `AdmissionsTab` (D50 : une carte par entrée d'un programme, filtre par programme, année d'entrée, niveau requis et voie choisis dans les listes de `lib/program-entries.ts`, note, lien source ; compteur dans l'onglet) ; sélecteurs `ProgramSelector`, `YearSelector`. Un champ « URL de la source » dans chaque formulaire de saisie (D12) ; un lien « Source » en `http(s)` seulement sur la carte d'une accréditation et dans les tableaux des classements et des capacités (D72). Sous chaque donnée (l'école, chaque campus, programme, tarif, place, classement, accréditation, admission, les chiffres clés de l'année), « Modifié par X le 19 octobre 2026 » : le nom et la date de la dernière modification, sans l'origine (D29, [`LastEdit`](../../app/admin/schools/[id]/LastEdit.tsx)). Les pourcentages des chiffres clés acceptent toutes les décimales (D30 : la base en tient à deux). `?tab=` ouvre un onglet (`info`, `accreditations`, `stats`, `campus-programs`, `pricing`, `rankings`, `capacities`, `admissions`) : la vue des signalements y renvoie (la catégorie « Admissions » mène au 8e onglet, D52). En-tête `AdminPage` avec lien de retour et badge de statut ; onglets `Tabs` au modèle ARIA (« Rubriques de l'école », identifiants `manage-tab-<onglet>` et `manage-panel-<onglet>`), une ligne qui tient à 1 440 px et défile en largeur plus étroit (D62) ; seul l'onglet choisi est monté. Dialogues natifs, l'erreur d'une fenêtre dans la fenêtre (D67) ; la suppression d'une année de chiffres clés et celle d'un tarif confirmées dans un dialogue (D63) ; « Nouvelle année » et « Copier depuis : » libellés (D65). Le statut d'une accréditation en case à cocher (D64), son type en français sur sa carte (« International », « État », « Label », `manage/accreditation-type.ts` ; la base, les routes et l'API v1 gardent `international`, `state`, `label`). Une carte par campus et un tableau des programmes ; l'alternance et l'expatriation d'un programme en cases à cocher (D69), ses campus en cases dans un groupe légendé ; l'onglet Tarifs montre une vue à la fois, le tableau ou la grille d'un programme (D70) ; le rang d'un classement en ton de catégorie par palier, sans médaille (D68, `manage/ranking-badge.ts`) ; la modification rapide des places au clavier, son erreur sous le champ (D71) ; l'en-tête d'une carte passe à la ligne quand son titre est long (D73) | non |
| `/admin/schools/[id]/campuses` | `manager` : les campus d'une école, avec « Modifié par … le … » (D29) ; dialogues natifs, erreur dans la fenêtre (D67) | non |
| `/admin/reports` | `manager` (D31) : « Signalements », en attente (les plus anciens d'abord) et fermés (les 100 derniers). Pour chacun : l'école, la cible (« supprimé » si le campus ou le programme n'existe plus, D37), la catégorie, le message, le lien (`sourceHref`), le nom affiché de l'auteur (D39) ; « Ouvrir l'onglet de gestion » (l'onglet de la catégorie), « Traiter » et « Rejeter » (dialogue, réponse facultative pour l'auteur). Fermer un signalement ne date aucune donnée (D32) | non |
| `/admin/inbox` | `admin` : la zone tampon, tickets du pipeline IA et contributions passées par l'IA, à valider ou rejeter (§4.2). Requêtes, textes et identifiants tenus par `test/inbox-screen.test.ts` (règle 10). `AdminPage`, filtres libellés « Statut » et « Catégorie » (D58, D65), un tableau ; le détail d'un ticket dans un dialogue natif collé à droite, 600 px, fermé par Échap, « Fermer » ou un clic à côté (D76, `Dialog` `placement="side"`) ; un ton de badge par état (D77, `inbox/ticket-tones.ts`) ; ni émoji ni ✓, ✕, ⚠ en tête des textes, les « ✕ » seuls en boutons d'icône nommés (D78) ; un lien d'un ticket cliquable en `http(s)` seulement, sinon du texte (D79, `sourceHref`) ; le bandeau des contributions `Pending_AI` au ton « info » (D80, D106) ; la purge confirmée dans un dialogue, son erreur dans la fenêtre (D67). Le contenu venu de l'IA et du web s'affiche en texte (aucun `dangerouslySetInnerHTML`) | **oui** |
| `/admin/users` | `admin` : les comptes (« Comptes » dans le menu) : ajouter une adresse à la liste, retirer un invité, changer un rôle, remettre en première connexion (ou réactiver), désactiver (un actif ou un invité, D24), renseigner l'adresse d'un compte ancien. Aucun e-mail envoyé | non |

`/admin/cron` n'existe pas sur cette branche : la console IA vit sur `local`
(D100), et le chemin répond 404.

**Le cadre du back-office** (`app/admin/layout.tsx` : le menu, puis un
`main`) : le menu est sombre (D92), son entrée choisie en
`aria-current="page"` ; sous 1 024 px, une barre et un bouton « Menu » le
replient (D94) ; le rôle sous le nom, en texte (D95). Le contrôle d'accès du
layout (`requirePage("manager")`) passe avant tout.

---

## 4. Routes

`Gest.` = `guardManager` (gestionnaire ou admin), `Admin` = `guardAdmin`,
`Session` = `guardSignedIn` (toute session). **56 méthodes : 38 `Gest.`,
14 `Admin`, 4 `Session`.**

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
| `schools/[id]/pricing` · `programs/[id]/pricing` · `pricing/[id]` | GET Gest. · PUT Gest. · DELETE Gest. |
| `schools/[id]/capacities` · `program-campuses/[id]/capacity` · `capacities/[id]` | GET Gest. · POST Gest. · PUT Gest. · DELETE Gest. |
| `schools/[id]/rankings` · `programs/[id]/rankings` · `rankings/[id]` | GET Gest. · POST Gest. · PUT Gest. · DELETE Gest. |
| `schools/[id]/stats` · `schools/[id]/stats/[recordId]` | GET Gest. · PUT Gest. · DELETE Gest. |
| `schools/[id]/accreditations` · `accreditations/[id]` | GET Gest. · POST Gest. · PUT Gest. · DELETE Gest. |
| `schools/[id]/entries` · `programs/[id]/entries` · `program-entries/[id]` | GET Gest. (les admissions des programmes de l'école, `?programId=`) · POST Gest. (une entrée d'un programme) · PUT Gest. (l'entrée entière) · DELETE Gest. (D50) ; l'envoi est lu par `readEntry` avant toute lecture en base (400, rien d'écrit) ; une entrée en double (même année, niveau et voie dans le programme) → 400 ; le corps illisible → 400 (`readJsonObject`) |
| `users` | GET Admin (la liste, invités compris, sans empreinte) · POST Admin (ajoute une adresse à la liste : invité `USER`, sans mot de passe, aucun e-mail ; D5) |
| `users/[id]` | DELETE Admin (retire un **invité** ; un compte qui a servi se désactive, D21 ; un invité qui figure comme auteur aussi : 409, D24, comme l'auteur ou le traitant d'un signalement, D38 ; pas soi-même) |
| `users/[id]/role` | PATCH Admin (`USER`, `GESTIONNAIRE`, `ADMIN` ; le dernier admin actif ne se rétrograde pas) |
| `users/[id]/reset` | POST Admin (D4 : remise en première connexion, ou réactivation ; mot de passe effacé, sessions coupées ; pas soi-même, pas sans adresse) |
| `users/[id]/disable` | POST Admin (D21 : un compte actif, ou un invité (D24) ; sessions coupées ; pas soi-même, pas un compte déjà désactivé) |
| `users/[id]/email` | PATCH Admin (D3 : l'adresse d'un compte qui n'en a pas ; l'ancien identifiant cesse alors de servir) |
| `account` | PATCH Session (son nom affiché, D6) |
| `account/password` | PATCH Session (son mot de passe, l'actuel exigé). Personne ne fixe le mot de passe d'un tiers (D4) |
| `account/back-office` | GET Session (D104 : la barre du site demande si le compte de la session a accès au back-office ; rôle relu en base par la garde, D1 ; rend `{ backOffice: true }` pour un gestionnaire ou un admin, `{ backOffice: false }` pour un `USER`, rien d'autre, en `Cache-Control: private, no-store` ; aucune lecture en base hors la relecture du compte) |

Les routes `users/[id]/role`, `reset`, `disable` et `email` passent par
`changeAccount` ([`lib/account-admin.ts`](../../lib/account-admin.ts)) : aucune
ne laisse zéro admin actif. Toutes écrivent une ligne `[audit]` dans le
journal.

Corps de requête : [`lib/request-body.ts`](../../lib/request-body.ts). Une
valeur numérique fournie mais illisible rend 400 en nommant le champ, avant
toute écriture (`readOptionalNumbers`) : une faute de frappe n'efface pas une
valeur. Défaut connu et accepté : un JSON mal formé rend 500 sur le CRUD admin
et `create-programs`, sans rien écrire.

**Provenance des écritures** (D10, D11) : chaque `POST`, `PUT` et `upsert` du
contenu ajoute `...provenance(session.user.id, "MANUAL")`
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
`entries`) lisent l'auteur par son seul nom affiché (`AUTHOR_SELECT`) et
rendent, sur chaque ligne, `last_edit` : « Modifié par X le … », ou `null`
pour une ligne non suivie (`forManager`, `describeLastEdit`). Ni
l'identifiant de l'auteur ni l'origine ne partent vers le navigateur.

### 4.1 bis. Signalements

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
IA ou passent par lui (statuts, catégories et charges d'un ticket :
[`bdd.md`](bdd.md) §5).

| Route | Méthodes | Remarque |
|---|---|---|
| `inbox` · `inbox/[id]` | GET Admin | liste et détail des tickets ; sources plafonnées par [`lib/ticket-sources.ts`](../../lib/ticket-sources.ts) : trois liens au plus, sans doublon (un `www.` de tête ne distingue pas deux adresses) |
| `inbox/[id]/validate` | PUT Admin | **écrit les données** (`Campus`, `Program`, `ProgramCampus`, `PricingRecord`, `RankingRecord`, `CapacityRecord`, `SchoolStatsRecord`, `AccreditationRecord`) dans une transaction, avec la provenance `AI` et l'admin qui valide pour auteur (D11), et le `source_url` des tickets Chiffres clés et Accréditations (D12). Un campus ou un programme déjà là n'est daté que si la validation lui écrit un champ (`stampUpdate`) |
| `inbox/[id]/reject` | PUT Admin | |
| `inbox/[id]/create-programs` | POST Admin | depuis un ticket `Program_Discovery` ; provenance `AI` sur les programmes créés, un programme déjà là garde son auteur |
| `inbox/[id]/attachments` | PUT Admin | rattachement campus collecté par l'IA ; provenance `AI` sur les lignes et sur la note de campus du programme |
| `inbox/purge` | DELETE Admin | supprime les tickets `Validated` et/ou `Rejected`, après confirmation ; les autres restent |

**Valider un ticket** (`validate`) :

- **un corps illisible est refusé (400), avant toute lecture en base** : un
  JSON mal formé, ou une valeur qui n'est pas un objet ; un corps absent ou
  `{}` écrit le ticket tel quel (`readOptionalJsonObject`) ;
- **les écritures et la clôture du ticket dans une seule transaction**
  (délai 60 s), les upserts **sérialisés** : `tx` n'a qu'une connexion, un
  `Promise.all` n'y gagne rien et dépasse le délai sous charge. Toute erreur
  annule tout ;
- **le ticket n'est clos que si une donnée a réellement été écrite** ; sinon
  422, avec le détail des entrées écartées, et le ticket reste ouvert. Les
  entrées écartées sont renvoyées dans `skipped`, avec un motif par entrée,
  même en cas de succès partiel ;
- **une découverte** (`Program_Discovery` portant `discovered_campuses`, que
  l'admin corrige dans un formulaire répéteur) : upsert des `Campus` puis des
  `Program` sur `(schoolId, name)` (un programme commun à N campus est créé
  une fois), puis des arêtes `ProgramCampus`. `validate` refuse les deux
  autres charges d'un `Program_Discovery` (le rattachement campus, le rapport
  rangé), et lit pour cela la charge **enregistrée**, pas le corps ;
- **une capacité** : le campus doit être identifiable, en quatre cas :
  `campus_id` fourni · `campus_name` fourni (correspondance exacte,
  insensible à la casse) · une seule association · **plusieurs associations
  sans campus précisé → entrée écartée**, avec motif. Refuser vaut mieux que
  corrompre.

**Écrire un rattachement campus** (`attachments`) : jamais d'arête créée
(chaque ligne est résolue sur `programId_campusId`, arête absente →
`edge_missing`, rien d'écrit ; le type de la transaction ne déclare ni
`create` ni `delete`) ; idempotent (une ligne identique n'émet rien) ; jamais
de suppression (une ligne que la page ne publie plus ressort en `stale` et
reste) ; la note de campus du programme dans la même transaction ; le ticket
ne passe `Validated` que si une ligne ou une note est résolue, sinon 422 qui
décompte les conflits ; corps illisible → 400.

**Ce qui reste de la console IA** : rien, sinon le bandeau des contributions
`Pending_AI` de l'inbox (`describePendingAi`,
[`lib/pipeline-history.ts`](../../lib/pipeline-history.ts)), qui dit qu'elles
attendent le prochain lancement du backend, sur le poste de l'admin (D106).
La table `ResearchLaunch` reste au schéma, avec ses contraintes et sa clé
`RESTRICT` vers `User` (D42, `test/research-launches-migration.test.ts`) ;
sur cette branche, aucun code ne l'écrit ni ne la lit, et **aucun n'écrit
`PipelineJob`** (piège 5, même test).

### 4.3. Lecture du site

Session exigée par le proxy (401 en JSON sans session) ; les routes elles-mêmes
ne lisent pas la session, ce qui garde leur cache ISR. Erreurs au format
`{ "error": "…" }`.

- `app/api/schools/*` : 3 routes GET, ISR 1 h, utilisées par l'accueil ;
  écoles `ACTIVE` seulement. La liste rend pour chaque école
  `programs_count`, tous ses programmes avec ou sans campus (D75).
- `app/api/v1/*` : 15 routes GET, plafonnées à 60 requêtes par minute et par
  IP ; de la provenance, la date seule (`updated_at`, D25). Le détail d'un
  programme et la comparaison portent ses admissions (`entries`, D53).
  Référence : [`API-rest.md`](API-rest.md).
- `app/api/first-login` : POST, **sans session** (proxy), au plafond de la
  connexion ; la seule route hors de `/api/auth/*` ouverte sans session (§2.2).

Aucun fichier de `app/` ni de `lib/` ne crée de ticket `ContributionInbox`
(`test/no-public-tickets.test.ts`, piège 6) : seul le backend de `local` en
écrit.

---

## 5. Tables

Schéma : [`prisma/schema.prisma`](../../prisma/schema.prisma) ; référence :
[`bdd.md`](bdd.md) ; vue d'ensemble pour l'équipe : le doc « Données stockées
sur les écoles » du propriétaire.

| Table | Rattachée à | Lien source | Écrite par |
|---|---|---|---|
| `School` | — | non (le domaine officiel en tient lieu) | Next.js |
| `Campus` | école | non | Next.js |
| `Program` | école (pas un campus) | oui (D12) | Next.js |
| `ProgramCampus` | programme × campus | non | Next.js |
| `ProgramCampusAttachment` | programme × campus × année d'études | oui | Next.js, depuis l'inbox seulement (`inbox/[id]/attachments`) |
| `PricingRecord` | programme × année scolaire | oui | Next.js |
| `CapacityRecord` | programme × campus × année scolaire | oui | Next.js |
| `RankingRecord` | programme × année × média | oui | Next.js |
| `SchoolStatsRecord` | école × année | oui (D12) | Next.js |
| `AccreditationRecord` | école | oui (D12) | Next.js |
| `ProgramPlacement` | programme | oui | aucun chemin d'écriture (abandonné, gardé) |
| `ProgramEntry` | programme × année d'entrée × niveau requis × voie | oui (D49) | Next.js (onglet « Admissions ») |
| `User` | — | — | Next.js (§2.3) |
| `ContributionInbox` | école, campus, programme (facultatifs) | `urls[]` | Next.js (l'inbox) **et** le backend Python de `local` |
| `PipelineJob` | école | — | le backend Python de `local` seulement ; cette branche ne la lit ni ne l'écrit (D100 ; jamais écrite par Next.js : D14) |
| `ResearchLaunch` | lanceur (`User`) ; un job par son id, sans clé | — | les routes de lancement de `local` (`trigger-research`, `run-due-passes`) ; cette branche ne la touche pas |
| `ContentReport` | école ; campus ou programme facultatif | oui (facultatif) | Next.js seulement (`/api/admin/reports`) |

**Provenance** (migration `20261019120000_content_provenance`) : les neuf
tables de données, de `School` à `ProgramCampusAttachment` (pas
`ProgramCampus`, une arête sans contenu propre, ni `ProgramPlacement`, sans
chemin d'écriture), et `ProgramEntry` (D49) portent la **dernière**
modification : `updated_by_id` (clé vers `User`, `RESTRICT`, D24),
`updated_at` et `updated_via` (`MANUAL`, `AI`, `REPORT` : contrainte
`CHECK`). Les trois sont vides ensemble (ligne « non suivie », écrite avant la
migration et jamais modifiée depuis) ou pleines ensemble (contrainte `CHECK`).
Une suppression ne laisse pas de trace ; il n'y a pas d'historique complet
(D10).

**Admissions** (migration `20261020180000_program_entries`) : `ProgramEntry`
(D16) dit, pour un programme, en quelle année on entre (`entry_year`, 1 à 5),
avec quel niveau (`required_level`, 0 pour le Bac à 5 pour Bac+5) et par
quelle voie (`route`, cinq valeurs, `UNSPECIFIED` par défaut), avec une note
de 500 caractères au plus et un lien source ; une seule ligne par année,
niveau et voie dans un programme (index unique). Un programme supprimé
emporte ses entrées (`CASCADE`). `admission_exam`, sur `Program`, reste tel
quel (D47). La même migration élargit `ContentReport_category_check` à
`ADMISSIONS` (D52). Listes et contraintes : `bdd.md` §4.

**Signalements** (migration `20261020120000_content_reports`) :
`ContentReport` (D13) garde l'auteur, l'école, la cible (`target_type`, le nom
à l'envoi `target_label`, la clé du campus ou du programme), la catégorie, le
message, le lien, l'état (`OPEN`, `RESOLVED`, `REJECTED`), la réponse, qui l'a
traité et quand. Une école supprimée emporte ses signalements ; un campus ou
un programme supprimé laisse le sien à l'école, avec son nom (D37).
Contraintes et clés : `bdd.md` §4.

**Journal des lancements** (migration `20261020150000_research_launches`) :
`ResearchLaunch` (D14) garde qui a lancé quoi (le corps envoyé au backend),
quand (l'heure de la base, `CURRENT_TIMESTAMP`, comme
`PipelineJob.started_at` que le backend écrit : la fenêtre de D40 compare les
deux), l'issue (D41), le code HTTP, le message, et l'id du job d'une
recherche ciblée, **sans clé vers `PipelineJob`** (une clé bloquerait la
purge du backend). Seule la branche `local` l'écrit ; la table reste au
schéma (D101).

Le backend Python de `local` (il partage la base) **lit** les tables de
données (diff de la Phase 2) et **écrit** `ContributionInbox` et
`PipelineJob`. Il ne connaît ni `ContentReport`, ni `ResearchLaunch`, ni
`ProgramEntry`. Ajouter une colonne obligatoire à ces deux tables, ou
renommer une colonne qu'il lit, casse le backend gelé (piège 5).

---

## 6. Styles

Tout le site est dans la charte graphique (G7 : maquette A « Registre », D8
composants maison, D9 clair). Référence :
[`charte-graphique.md`](charte-graphique.md).

| | Où |
|---|---|
| Point d'entrée | [`app/globals.css`](../../app/globals.css) : Tailwind CSS v4 **entier** (thème, preflight, utilitaires ; `@import "tailwindcss" source(none)`), puis la charte ; `@source` : `app/` et `components/` seulement ; couches de Tailwind (`theme, base, components, utilities`) |
| Jetons et base | [`app/charte.css`](../../app/charte.css) : les jetons (`--charte-*`, `@theme inline`), puis, après le preflight, la base **du document** (D96) : fond `page`, encre, 14 px et lissage sur `body`, `color-scheme` clair, bordures au filet, curseur des boutons, focus visible, fond voilé des dialogues, gras des `optgroup` |
| Composants et gabarits | [`components/ui/`](../../components/ui/) ; [`components/layout/`](../../components/layout/) (`SiteShell`, `AuthShell`, `AdminPage`) ; le cadre du back-office dans `app/admin/layout.tsx` et `SidebarClient.tsx` |
| Polices | `next/font` (`app/layout.tsx`) : IBM Plex Sans, Sans Condensed et Mono ; le preflight fait de Plex Sans la police du document et de Plex Mono celle des `<code>` |

`test/charte.test.ts` garde la règle : aucune autre feuille de style, ni bloc
`styled-jsx` ou `<style>`, ni `style` en ligne, ni couleur littérale, ni
émoji (D56) ; chaque classe écrite en clair est un utilitaire généré ; chaque
écran est dans son gabarit ; les jetons et les contrastes sont ceux de la
charte. `components/ui/ProgressBar.tsx` reste dans la charte, testé, sans
écran qui l'emploie sur cette branche (la console qui s'en sert vit sur
`local`).

La CSP posée par [`next.config.ts`](../../next.config.ts) a
`style-src 'self' 'unsafe-inline'` : Tailwind produit une feuille statique au
build, servie par le site ; aucune violation sur un build de production
(§8.2).

---

## 7. Tests

`npm test` et `npm run test:ts` lancent la même suite (`node --test`,
1 199 tests au 23 octobre 2026, D105), en CI dans le job `ts-tests` (§9.4).
Les tests Python vivent sur la branche `local`, avec le backend (D101).

- **Banc** (`test/helpers/`) : `fake-prisma.ts` (faux client ; garde les
  options d'un `$transaction`), `fake-users.ts` (une table `User` en mémoire,
  avec l'unicité et les contraintes de la migration ; la suppression d'un
  compte auteur lève P2003, comme la clé `RESTRICT`), `prisma-schema.ts`
  (chaque requête du faux client relue contre le vrai schéma), `session.ts`
  (sessions simulées : aucune, `USER`, `GESTIONNAIRE`, `ADMIN`, règle et
  messages tirés de `lib/roles.ts` ; un profil inconnu lève), `access-policy.ts`
  (l'accès attendu de chaque route du back-office), `requests.ts`,
  `provenance.ts` (`contentOf` vérifie puis retire la provenance d'une
  écriture, pour que l'attendu d'un test dise le contenu ;
  `installContentCache` remplace `next/cache`, dont `revalidatePath` lève hors
  de Next). Mode d'emploi : §9.3.
- **Accès** : `test/auth.test.ts` (la vraie `lib/auth.ts` : trois gardes,
  rôle relu en base, compte supprimé, rôle inconnu, compte non actif et
  version de session (D20), `requirePage`), `test/api/access-matrix.test.ts`
  (chaque handler × 4 profils), `test/api/admin-guards.test.ts` (analyse
  statique des gardes ; chaque ligne de la table d'accès désigne un handler
  qui existe), `test/proxy.test.ts` (chaque page et route de `app/` refusée
  sans session, hors connexion et NextAuth ; la première connexion libre et
  plafonnée avec la connexion), `test/admin-pages.test.ts` (`requirePage` de
  chaque écran, menu par rôle), `test/callback-url.test.ts`,
  `test/roles-migration.test.ts` (contrainte, défaut, `lib/roles.ts`),
  `test/no-public-tickets.test.ts` (piège 6).
- **Comptes** : `test/accounts.test.ts` (domaine, adresses, nom affiché,
  états), `test/accounts-migration.test.ts` (la migration, additive, et
  `schema.prisma`), `test/sign-in.test.ts` (connexion par l'adresse, D3,
  invité et désactivé refusés, version de session dans le jeton),
  `test/api/first-login.test.ts` (une adresse hors liste ne crée rien, seul un
  invité passe), `test/api/users.test.ts` (liste blanche, rôles, dernier admin,
  transaction sérialisable, D3, D4, D21, D24, D38, D42),
  `test/api/account.test.ts` (« Mon compte »), `test/password.test.ts`.
- **Contenu** : `test/api/admin-schools`, `admin-programs`, `admin-records`
  (cas nominaux en `GESTIONNAIRE`, `USER` refusé, 400, 404), `public-schools`,
  `v1` (les 15 routes : forme, CORS, `OPTIONS`, 404, erreur Prisma → 500 sans
  le message interne, bornes de pagination), `inbox-*` (en `ADMIN`),
  `test/request-body.test.ts`.
- **Provenance** : `test/provenance.test.ts` (`lib/provenance.ts` : origines,
  lien source contrôlé et protégé, texte et date en français, nom de
  l'auteur), `test/provenance-migration.test.ts` (la migration, additive, ses
  clés et contraintes, `schema.prisma`, sans `@updatedAt`),
  `test/api/provenance.test.ts` (chaque écriture des neuf tables, routes de
  gestion et de l'inbox, porte l'auteur de la session et non celui du corps ;
  les tables non suivies n'en reçoivent pas ; revalidation après une écriture
  réussie seulement), `test/api/source-url.test.ts` (D27 sur chaque saisie,
  D12), `test/api/v1-provenance.test.ts` (chaque route v1 et chaque
  enregistrement imbriqué : la date, ni auteur ni origine, rien de l'auteur
  lu), `test/api/manager-provenance.test.ts` (les lectures du gestionnaire :
  « Modifié par … le … », le nom seul, ni origine ni identifiant),
  `test/manager-screens.test.ts` (les écrans de gestion : `LastEdit` partout ;
  D30, les pourcentages en `step="any"` ; les huit onglets dans le gabarit ;
  D63, D64, D66, D68, D69, D71, D72, D73 ; le type d'une accréditation en
  français, la valeur de la base envoyée), `test/provenance-pages.test.ts`
  (les fiches rendues : source, « Modifié par », pas d'adresse ni de lien hors
  `http(s)` ; la note d'un tarif sous ses montants, D74).
- **Signalements** : `test/content-reports.test.ts` (`lib/content-reports.ts` :
  corps lu et borné, longueur comptée comme Postgres, lien D27, décision,
  onglet de chaque catégorie, ce que voient le gestionnaire et l'auteur),
  `test/content-reports-migration.test.ts` (une table neuve ; contraintes et
  clés alignées sur le code et `schema.prisma`), `test/api/reports.test.ts`
  (les trois méthodes : auteur et traitant de la session, cible de l'école,
  école active, plafond par compte après la lecture du corps, rien dans
  l'inbox, 409 sur un signalement fermé), `test/reports-pages.test.ts` (les
  liens des fiches, en bouton secondaire, la page du formulaire, « Vos
  signalements », la vue des gestionnaires, `?tab=`).
- **Journal des lancements** : `test/research-launches-migration.test.ts`
  (une table neuve, rien vers `PipelineJob` ; contraintes alignées sur les
  listes que la branche `local` écrit, écrites en clair ; `launched_at` à
  l'heure de la base, clé `RESTRICT`, `schema.prisma` ; aucun fichier de
  `app/` ni de `lib/` n'écrit `PipelineJob`). Les tests du lancement vivent
  sur `local`.
- **Admissions** : `test/program-entries.test.ts` (`lib/program-entries.ts` :
  listes, libellés, phrase de chaque entrée, lecture d'un envoi bornée, note
  comptée comme Postgres, lien D27, rien de l'auteur ni du programme lu dans
  le corps), `test/program-entries-migration.test.ts` (une table neuve, la
  seule suppression est la contrainte des catégories qu'elle remplace ;
  contraintes alignées sur le code, provenance, clés `CASCADE` et `RESTRICT`,
  `schema.prisma`, `Program` non touchée), `test/api/program-entries.test.ts`
  (les quatre méthodes : auteur de la session, programme de l'URL, envoi
  illisible ou doublon → 400 sans écriture, P2002, 404, revalidation, rien
  dans l'inbox).
- **Inbox** : `test/inbox-screen.test.ts` (la source de la page : les
  9 requêtes, adresse, méthode et corps ; les 16 identifiants ; D76 à D80 ;
  D58, D65, D67) ; `test/ticket-sources.test.ts` (le bloc « Sources ») ;
  `test/contribution.test.ts` (les statuts, catégories et origines de
  `lib/contribution.ts` contre les contraintes de `ContributionInbox`,
  posées par la seule migration
  `20260902120000_inbox_relations_and_enum_guards` ; D107) ;
  `test/api/inbox-*`.
- **Séparation de l'IA** (D100, D101, D105) : `test/no-ai-backend.test.ts`
  (ni `app/admin/cron` ni les cinq routes de la console ; aucun lien ni appel
  vers elles ; aucun code ne lit `FASTAPI_URL` ni le jeton du backend ; ni
  `npm run backend`, ni `npm run local`, ni `pytest.ini`, ni
  `scripts/start-local.ps1`, aucun script npm qui lance Python ;
  `npm test` = `npm run test:ts` ; la CI sans job Python, et sans les mots
  qui le trahiraient).
- **Cadre et menu du back-office** : `test/admin-frame.test.ts` (le layout :
  `requirePage("manager")` d'abord, le menu, un `main` qui peut rétrécir ; le
  menu rendu côté serveur par `AdminMenu` : les entrées de `navFor` dans
  l'ordre, `aria-current="page"` sur la seule entrée de l'écran affiché ; D92
  à D95 ; ni `styled-jsx`, ni `style` en ligne, ni couleur littérale).
- **La barre du site** (D104) : `test/api/account-back-office.test.ts` (la
  route sous la vraie `lib/auth.ts` : 401 sans session et rien de lu ; « non »
  pour un `USER`, « oui » pour un gestionnaire et un admin ; le rôle de la
  base et non celui du jeton ; un compte non actif, remis à zéro ou
  supprimé : 401 ; la seule clé `backOffice`, en `private, no-store`),
  `test/site-bar.test.ts` (le lien seulement sur un 200 qui dit `true` ; la
  mémoire de l'onglet ; jamais de lien dans le HTML d'une page qui ne lit pas
  la session ; la barre ne lit pas la session ; « Aide » avant « Mon
  compte », D109).
- **L'aide** (D108 à D115) : `test/help-page.test.ts` (la page sous la vraie
  `lib/auth.ts` : chacun le guide de son rôle et lui seul, le rôle de la base
  et non du jeton, un compte non actif renvoyé à la connexion ; le sommaire ;
  chaque libellé cité, `<Ui>…</Ui>`, relu mot pour mot contre le code des
  écrans ; ni fonction disparue, ni commande, ni secret ; le guide de l'admin
  et la console IA, D114 ; chaque capture sous `public/help/`, à ses
  dimensions, avec un texte de remplacement, et chacun ne voit que celles de
  son guide), `test/admin-frame.test.ts` (« Aide » au pied du menu, hors de
  `navFor`), `test/page-titles.test.ts` (les titres fixes, « Aide »
  compris).
- **Verrous** : `test/api-docs.test.ts` (`/api-docs` = réponses réelles),
  `test/page-titles.test.ts`, `test/silent-pages.test.ts` (aucun `catch` muet
  dans l'accueil ni l'inbox ; D75).
- **Charte** : `test/ui-components.test.ts` (le HTML rendu par React côté
  serveur : libellés, aides et erreurs reliés, rôles des messages, onglets au
  modèle ARIA et leur clavier, dialogue nommé et ses deux placements, boutons
  qui n'envoient pas un formulaire par défaut, gabarits avec un seul `h1`,
  `Badge` `wrap`, `Table` `id`, `TabPanel` caché, `ProgressBar`),
  `test/charte.test.ts` (compilation de `app/globals.css` par PostCSS et
  Tailwind ; jetons et contrastes identiques aux §2 et §3 de la charte ; le
  preflight présent, `[hidden]` compris ; la base sur le document ; les règles
  du §6 ci-dessus).
- **Outillage** : `test/migration-plan.test.ts` (le lanceur de migrations,
  [`bdd.md`](bdd.md) §4), `test/smoke-checks.test.ts` (les règles du smoke,
  §9.3), `test/rate-limit.test.ts` (Upstash simulé, repli mémoire),
  `test/utils.test.ts`, `test/prisma-schema.test.ts`.

`npm run smoke` (§9.3) se joue à la main, contre `npm run dev` : d'abord **le
mur** sans session, puis les pages et l'API **connecté** ; il lit la base
visée, avec l'accord du propriétaire.

---

## 8. Sécurité

L'accès (connexion, gardes, rôle relu en base) est au §2 ; les points à
connaître avant de contribuer sont dans le README, « Sécurité ».

### 8.1. Limitation de débit

**Une seule implémentation : [`lib/rate-limit.ts`](../../lib/rate-limit.ts).**

| Portée | Plafond | Où |
|---|---|---|
| connexion **et** première connexion (POST), un seul compteur | 5 / 15 min / IP, avant tout ; alterner ne double pas les essais | `proxy.ts` |
| `/api/v1/*` | 60 / min / IP, requêtes connectées seulement, pré-vols `OPTIONS` non comptés | `proxy.ts` |
| envoi d'un signalement | 10 / heure / compte (D35) | sa route (§2.2) |

- **L'appelant** : `clientIp()` interroge `x-vercel-forwarded-for`, puis
  `x-real-ip`, **avant** `x-forwarded-for`, que le client écrit lui-même :
  s'y fier seul rendrait le plafond contournable.
- **Le magasin** : Upstash Redis (REST) si `UPSTASH_REDIS_REST_URL` et
  `UPSTASH_REDIS_REST_TOKEN` sont posées ; **repli mémoire sinon**, qui
  ralentit une attaque sans la bloquer (chaque démarrage à froid repart d'un
  compteur vide), avec un avertissement au premier usage. Les noms comptent :
  `KV_REST_API_*`, ceux de l'ancien Vercel KV, ne sont pas lus.
- **`withAuth` de next-auth court-circuite tout chemin `/api/auth`** : c'est
  pourquoi `proxy.ts` plafonne la connexion **avant** de déléguer à `withAuth`.
  Une montée de `next-auth` qui changerait ce comportement ferait disparaître
  le plafond sans qu'aucun test le voie : relire `proxy.ts` (contrôles du
  §8.4).

### 8.2. En-têtes

Posés par [`next.config.ts`](../../next.config.ts) sur `/:path*` :

| En-tête | Valeur |
|---|---|
| `Content-Security-Policy` | `default-src 'self'` · `script-src 'self' 'unsafe-inline'` · `style-src 'self' 'unsafe-inline'` · `img-src 'self' data: blob:` · `font-src 'self' data:` · `connect-src 'self'` · `object-src 'none'` · `base-uri 'self'` · `form-action 'self'` · `frame-ancestors 'none'` · `upgrade-insecure-requests` |
| `X-Frame-Options` | `DENY` (doublon volontaire, navigateurs anciens) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (D23 : `preload` gardé ; il engage le domaine pour des mois) |

**`'unsafe-inline'` reste sur `script-src`** : Next.js injecte l'amorçage
d'hydratation en ligne. Le retirer impose une CSP à nonce générée dans
`proxy.ts` (chantier ouvert, §8.3). `'unsafe-eval'` n'est ajouté qu'en
développement. Aucune violation n'a été relevée, en développement comme sur
un build de production.

### 8.3. Le reste

- **La base** : Next.js passe par `@neondatabase/serverless` en WebSocket
  (443) et ne lit pas `DB_DRIVER` ; les migrations et leur lanceur :
  [`bdd.md`](bdd.md) §4. Aucun message n'affiche une URL de connexion :
  `db-migrate.ts` ne montre que l'hôte.
- **Le contenu externe** (tickets de l'IA, liens saisis) s'affiche en texte,
  sans `dangerouslySetInnerHTML` ; un lien n'est cliquable qu'en `http(s)`
  (`sourceHref`, D27, D79).
- **L'IA** : les règles `wrap_source()` et `user_text` (README, « Sécurité »)
  portent sur le backend, qui vit sur `local`.
- **Les dépendances** : la CI ne bloque que sur une vulnérabilité
  **critique** (`npm audit --audit-level=critical`). Les hautes restantes
  (relevé du 23 octobre 2026 : 9 hautes, 0 critique) sont toutes tirées par
  la CLI Prisma (`prisma`, `@prisma/config`, `deepmerge-ts`, `mysql2`, un
  pilote que le projet n'emploie pas) ou par l'outillage de lint
  (`micromatch`, `braces`, `fast-glob`, sous `eslint-config-next`) ; aucune
  n'est servie au navigateur ni exécutée par l'API. Le seul correctif proposé
  est un `npm audit fix --force`, refusé : il redescendrait Prisma en 6, sans
  `@prisma/adapter-neon` 7. À surveiller : `npm ls deepmerge-ts mysql2` ;
  quand une version 7 de Prisma les embarque à jour, `npm update prisma`
  suffit, toujours sans `--force`. Le 23 octobre, un avis critique sur
  `next` 16.0.0 à 16.4.0 a bloqué la CI : `next` monté en 16.4.2
  (`eslint-config-next` laissé en 16.3.8), puis les contrôles du §8.4
  rejoués sur un build de production.
- **Chantiers ouverts** : la CSP à nonce ; les vulnérabilités ci-dessus ; une
  base de CI éphémère pour le contrôle des migrations
  ([mémo Vercel](../memory/memory-deploiement-vercel.md), « Base de CI
  éphémère »).

### 8.4. Contrôles d'exécution non automatisés

`tsc`, ESLint et les tests ne voient jamais passer une vraie session. Après
toute montée de version de `next` ou de `next-auth`, ces contrôles se font à
la main, `npm run dev` lancé (puis sur un build de production pour la CSP),
avec l'accord du propriétaire :

| # | Contrôle | Attendu |
|---|---|---|
| 1 | une page du back-office sans session | 307 vers `/admin/login?callbackUrl=…` |
| 2 | connexion réelle | la session s'ouvre ; le back-office répond selon le rôle |
| 3 | 6 POST de connexion | les 5 premiers passent, le 6e rend 429 |
| 4 | une route `/api/admin/*` sans session | 401, avant toute lecture en base |
| 5 | en-têtes sur `/admin/login` | les six du §8.2 |
| 6 | ~65 appels rapides sur `/api/v1/schools?limit=1` | 429 au-delà de 60 par minute |
| 7 | console du navigateur sur le site et le back-office | aucune violation CSP |

Isoler les compteurs : passer chaque contrôle avec un `x-real-ip` distinct,
sinon la connexion du n°2 consomme un essai du n°3. En développement, le
compteur est en mémoire : les n°3 et n°6 restent valables sur une instance.
`/admin` n'est pas une page (404) : le n°1 se mène sur `/admin/schools`.

---

## 9. Outillage, build et CI

### 9.1. Build et dépendances

`npm run build` = **`prisma generate && next build`** : Prisma 7 n'a plus de
hook `postinstall`, et sans cet appel un build neuf partirait sans client
Prisma ou avec un client périmé. `dotenv` est une dépendance de production :
`lib/prisma.ts` l'importe au runtime. Les commandes : README, « Commandes ».

### 9.2. ESLint

`eslint.config.mjs`, au format plat (`eslint-config-next` 16 exporte des
configurations plates). Politique : une base qui passe, la dette visible.

| Règle | Traitement | Raison |
|---|---|---|
| `react/no-unescaped-entities` | désactivée | apostrophes du texte français ; `&apos;` rendrait les libellés illisibles |
| `react-hooks/immutability`, `set-state-in-effect`, `purity` | `warn` | règles du compilateur React ; les corriger demande de reprendre les composants un par un |
| `@typescript-eslint/no-explicit-any` | `warn` | dette chiffrable, donc résorbable |

**0 erreur, 93 avertissements** au 23 octobre 2026.

### 9.3. Écrire et lancer les tests

- **Une route** se teste en important son handler et en l'appelant avec une
  `Request` et `{ params: Promise.resolve({ id }) }` (dans Next 16, `params`
  est une promesse). `@/lib/prisma` et `@/lib/auth` sont remplacés par
  `mock.module` de `node:test`, ce qui exige
  `--experimental-test-module-mocks` (dans `npm run test:ts`) ; on passe
  l'option `exports` (`namedExports` est dépréciée).
- **L'ordre d'import** : les aides en tête du fichier, la route par un
  `import()` dans `before()` ; un import statique serait évalué avant le
  remplacement.
- **Les transactions** : le faux n'a pas de vrai rollback, mais retient ce
  qu'une transaction en échec annule (`db.rolledBack`) ; `db.writes()` ne
  rend que ce qu'une base aurait gardé. Dans la forme tableau, une écriture
  vue dans `db.calls` n'est pas forcément tenue.
- **Le schéma** : `schemaErrors(db.calls)` relit chaque requête du faux
  contre le modèle du client généré (`Prisma.dmmf`, sans base) : un champ
  disparu fait échouer le test, même derrière un `where: any` (piège 8).
- **Les gardes** : `test/api/admin-guards.test.ts` lit chaque
  `app/api/admin/**/route.ts` avec le compilateur TypeScript : chaque handler
  exporté doit **attendre** la garde de son niveau (une garde sans `await`
  rend une promesse, et la route s'ouvrirait), aucun fichier ne touche
  `getServerSession`, une forme d'export illisible est refusée.
- **Aucun test ne sort du processus** : `fake-prisma.ts` pose une
  `DATABASE_URL` morte (`127.0.0.1:9`), et la suite a été rejouée sous garde
  réseau (connexions et DNS refusés hors de `127.0.0.1`), sans aucune
  tentative. **Aucun test ne lit l'horloge** : un test qui dépend de la date
  réelle finit par casser sur un push innocent ; on la fige.
- **Le smoke** (`npm run smoke`, `scripts/smoke-local.ts`) : contre
  `npm run dev` déjà lancé, adresse locale seulement (sinon code 2 ; code 1
  sur un échec) ; des GET seulement, mais sur la base que vise le poste, donc
  avec l'accord du propriétaire. D'abord le mur sans session (pages renvoyées
  vers la connexion, `/api/schools` et les 15 `GET /api/v1/*` en 401), puis,
  si `APPVC_ADMIN_PASSWORD` et `APPVC_ADMIN_EMAIL` (ou, pour un compte sans
  adresse, `APPVC_ADMIN_USERNAME`) sont posées, les pages et l'API connecté.
  Une page d'erreur se reconnaît à ses marques hors `<script>` (`next dev`
  sérialise la phrase de la page 404 dans la charge de chaque page). Pas en
  CI, faute de base ; ses règles (`scripts/lib/smoke-checks.ts`) sont testées.

### 9.4. Intégration continue

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), sur chaque push
et sur les PR vers `main`, deux jobs, Node 24 comme le poste :

| Job | Étapes |
|---|---|
| `validate` | `npm ci` · **`prisma generate`** · `tsc` · ESLint · `prisma validate` · `prisma migrate status` · garde-fou « pas de synchro du schéma hors migration » · `npm audit --audit-level=critical` |
| `ts-tests` | `npm ci` · `prisma generate` · `npm run test:ts` |

- **`prisma generate` précède `tsc`** : `npm ci` ne génère pas le client, et
  sans lui `tsc` tombe en cascade d'erreurs sur tous les callbacks Prisma.
- **`prisma migrate status`** interroge la base partagée (secrets
  `DATABASE_URL`, `DIRECT_URL`) et ne fait échouer le job que sur `main` et
  sur les PR vers `main` : ailleurs, il affiche son verdict. C'est un
  palliatif ; le correctif est une base éphémère (§8.3).
- **Le garde-fou** cherche le motif en classes de caractères
  (`prisma[[:space:]]+db[[:space:]]+push`) : écrit en littéral, il se
  trouverait lui-même dans `ci.yml` et échouerait toujours. **Ne jamais le
  réécrire en littéral.**
- **`ts-tests` reçoit une `DATABASE_URL` factice** : `prisma.config.ts` exige
  la variable dès son chargement, même pour `prisma generate`, qui ne se
  connecte pas ; le vrai secret n'a rien à faire dans un job qui ne touche
  jamais la base. La génération y est indispensable : `prisma-schema.ts` lit
  le client généré.
- `test/no-ai-backend.test.ts` refuse dans `ci.yml` tout job Python et les
  mots qui en trahiraient un, commentaires compris (D101).

---

## 10. Pour aller plus loin

- Le plan, ses décisions et son journal :
  [`features/gestion-contenu.md`](../features/gestion-contenu.md).
- La charte graphique : [`charte-graphique.md`](charte-graphique.md).
- La base : [`bdd.md`](bdd.md) ; l'API v1 : [`API-rest.md`](API-rest.md).
- La production : [`memory/memory-deploiement-vercel.md`](../memory/memory-deploiement-vercel.md).
- Les cas limites : [`../edgecase.md`](../edgecase.md).
- La partie IA, gelée, sur la branche `local` :
  `git show local:docs/architecture/architecture.md`. Les commentaires du code
  qui citent « le plan backend-local » (ses décisions, ses défauts F1 à F7,
  ses étapes) renvoient au plan gelé de l'IA, lisible de même :
  `git show local:docs/features/backend-local.md`.
