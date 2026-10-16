# API REST (v1) — spécification et état réel

> **Mise à jour** : 14 octobre 2026 — revérifiée contre le code et couverte par
> `test/api/v1.test.ts` (15 routes `app/api/v1`). Les sections marquées
> **« État réel »** décrivent ce que fait le code aujourd'hui, là où il s'écarte
> de l'intention initiale.
> **15 octobre 2026** : la page `/api-docs` (`app/api-docs/endpoints.ts`)
> décrit enfin cette API, paramètres et exemples de réponse compris ;
> `test/api-docs.test.ts` la confronte aux routes (`architecture.md` §7.3).
> **16 octobre 2026** (plan gestion-contenu, étape 1, décision G6) : l'API
> **exige une session**, comme tout le site. Voir *Authentification*.

## Objectif

Exposer en lecture les données validées (écoles, campus, programmes, tarifs,
capacités, classements, statistiques, accréditations) **aux personnes
connectées** ; l'API doit rester performante et **protéger la base Neon**, qui
est sur un palier gratuit. L'objectif d'origine, une API publique pour des
partenaires, est suspendu par G6 : des clés d'API pourront s'ajouter si un
usage externe apparaît.

## Pile technique

- **Framework** : Next.js App Router (Route Handlers `app/api/v1/...`) — `next@16.3.8` (depuis le 14 octobre 2026, correctif de sécurité)
- **Langage** : TypeScript
- **Accès BDD** : Prisma ORM — `prisma@7.10.0`
- **Hébergement cible** : Vercel (non déployé à ce jour)

> **La montée en `next@16.3.4` (1er septembre 2026) n'est pas cosmétique pour
> cette API.** Les versions antérieures portaient un avis de *bypass de
> middleware / proxy en App Router*. Or le plafond de 60 req/min décrit
> ci-dessous vit dans `proxy.ts`, donc dans le middleware : le contourner, c'était
> aspirer la base Neon sans jamais croiser un 429. Voir
> [`architecture.md`](architecture.md), *Sécurité des dépendances*.

---

## Authentification *(plan gestion-contenu, étape 1)*

- **Session obligatoire** : `proxy.ts` exige un jeton de session NextAuth
  valide sur tout le site, l'API v1 comprise (seules `/admin/login` et
  `/api/auth/*` restent libres). C'est la session du site : un cookie posé par
  la connexion, pas une clé d'API.
- **Sans session : 401** en JSON, `{ "error": "Non authentifié. Veuillez vous
  connecter." }`, sans redirection. Un pré-vol `OPTIONS` sans session est
  refusé de même.
- **Tous les rôles** (`USER`, `GESTIONNAIRE`, `ADMIN`) lisent l'API : le proxy
  ne regarde que l'existence de la session, pas le rôle.
- Les routes elles-mêmes ne lisent pas la session : le contrôle est entier dans
  le proxy (`test/proxy.test.ts` énumère chaque route de `app/` et vérifie
  qu'elle est refusée sans session).
- Conséquence : l'API s'appelle depuis le navigateur d'une personne connectée
  (même origine). Un script (`curl`, Python) ou un autre site n'a pas de
  session ; `/api-docs` le dit dans sa fiche « Authentification ».

## Protection de la base — ce qui protège réellement

### Limitation de débit *(ajoutée à l'étape 4 de la remédiation)*

L'API était **entièrement hors du périmètre du middleware** : ni authentifiée,
ni limitée. Un seul client pouvait aspirer la base et saturer le palier Neon.
Elle est depuis plafonnée, et depuis l'étape 1 du plan gestion-contenu
authentifiée.

| Portée | Plafond | Implémentation |
|--------|---------|----------------|
| `/api/v1/:path*` | **60 requêtes / minute / IP** | `proxy.ts` → `lib/rate-limit.ts`, seau `v1:` |

- Le plafond ne compte que les requêtes **connectées** : un appel refusé (401)
  ne consomme pas le quota de l'IP, que des collègues derrière le même réseau
  partagent.
- Les pré-vols CORS (`OPTIONS`) ne consomment pas de quota.
- Dépassement → **429** avec un en-tête `Retry-After`.
- L'IP est déterminée par `clientIp()`, qui interroge `x-vercel-forwarded-for`
  puis `x-real-ip` **avant** `x-forwarded-for` — ce dernier étant contrôlable
  par le client.
- Le compteur s'appuie sur **Upstash Redis** si `UPSTASH_REDIS_REST_URL` et
  `UPSTASH_REDIS_REST_TOKEN` sont définies. **Sinon il retombe en mémoire, et le
  plafond ne tient pas sur une plateforme sans état.**

### Cache — l'intention et la réalité

**Intention initiale** : `export const revalidate = 3600` sur chaque route, la
première requête frappant la base et les suivantes étant servies par le CDN.

**État réel** : la directive est bien présente dans les 15 routes, **mais elle
ne s'applique pas**. Tous les handlers reçoivent `request` et lisent
`new URL(request.url).searchParams` : en App Router, cela force le rendu
dynamique et neutralise `revalidate`. Le build le confirme — les routes `/api/v1`
sortent toutes en `ƒ (Dynamic)`, aucune en `○ (Static)`.

**Conséquence** : chaque appel atteint la base. C'est la limitation de débit,
et non le cache, qui protège aujourd'hui Neon.

**Piste** si le cache devient nécessaire : passer par
`unstable_cache` / `revalidateTag` autour des requêtes Prisma, plutôt que de
compter sur le cache de segment de route — inopérant dès qu'un paramètre de
requête est lu.

### Bornes sur les collections *(étape 4)*

| Type de route | Protection |
|---------------|------------|
| Collections racine — `/v1/schools`, `/v1/programs`, `/v1/rankings` | **paginées** via `parsePagination` (`limit` plafonné à 100, défaut 20, 50 pour `/rankings`). Une valeur hors bornes est ramenée dans les bornes (`page=0` → 1, `limit=1000` → 100) ; vide ou non numérique, elle reprend le défaut. Jusqu'au 14 octobre 2026, `?page=abc` donnait `NaN`, que Prisma refusait : 500 |
| Sous-collections — les 7 routes rattachées à une entité parente | **plafond dur `take: 500`** |
| `/v1/compare/programs` | 5 identifiants maximum, **dédupliqués** |

Le plafond de 500 a été préféré à la pagination pour les sous-collections : les
paginer aurait changé leur forme de réponse — un tableau nu devient
`{ data, pagination }` — et cassé tout consommateur existant. La valeur est très
au-dessus de tout volume légitime : elle borne une requête pathologique sans
tronquer de donnée réelle.

---

## Points d'entrée (15 routes)

Toutes sous `/api/v1/`. Seules les écoles `status == "ACTIVE"` sont exposées.

### Écoles

| Méthode | Endpoint | Description | Paramètres | Forme |
|---|---|---|---|---|
| `GET` | `/api/v1/schools` | Liste des écoles actives | `?search=&page=1&limit=20` | `{ data, pagination }` |
| `GET` | `/api/v1/schools/[id]` | Détail d'une école | — | objet |
| `GET` | `/api/v1/schools/[id]/stats` | Statistiques d'une année (la plus récente par défaut) ; aucune → 404 « Statistiques introuvables » | `?year=2025` | objet |
| `GET` | `/api/v1/schools/[id]/accreditations` | Accréditations | — | tableau, `take: 500` |

### Campus

| Méthode | Endpoint | Description | Forme |
|---|---|---|---|
| `GET` | `/api/v1/schools/[id]/campuses` | Campus d'une école | tableau, `take: 500` |
| `GET` | `/api/v1/campuses/[id]` | Détail d'un campus + ses programmes | objet |

### Programmes

| Méthode | Endpoint | Description | Paramètres | Forme |
|---|---|---|---|---|
| `GET` | `/api/v1/schools/[id]/programs` | Programmes de l'école | `?campus_id=` | tableau, `take: 500` |
| `GET` | `/api/v1/programs/[id]` | Détail d'un programme | — | objet |
| `GET` | `/api/v1/programs` | Recherche globale | `?search=&admission_exam=&alternance=&page=&limit=` | `{ data, pagination }` |

> **Modèle** : un programme appartient à une **école**, pas à un campus. Le
> filtre `campus_id` passe par la table d'association `ProgramCampus`.

### Tarifs, classements, capacités

| Méthode | Endpoint | Description | Forme |
|---|---|---|---|
| `GET` | `/api/v1/programs/[id]/pricing` | Historique tarifaire | tableau, `take: 500` |
| `GET` | `/api/v1/schools/[id]/pricing` | Tarifs de tous les programmes ; chaque ligne porte `program` (`id`, `name`, `campuses`) | tableau, `take: 500` |
| `GET` | `/api/v1/programs/[id]/rankings` | Classements d'un programme | tableau, `take: 500` |
| `GET` | `/api/v1/rankings` | Tableau global, écoles `ACTIVE` ; chaque ligne porte `program` (`id`, `name`, `school`, `campuses`) | `?ranking_name=&year=&page=&limit=` | `{ data, pagination }` |
| `GET` | `/api/v1/programs/[id]/capacity` | Places disponibles | tableau, `take: 500` |

> **Capacité** : elle est rattachée à un couple **(programme, campus)** via
> `ProgramCampus`, jamais au programme seul. La réponse expose donc le campus.

> **État réel — `/schools/[id]/pricing` et `/rankings` répondaient toujours 500
> jusqu'au 14 octobre 2026.** Elles filtraient par `program.campus`, relation
> disparue quand un programme a cessé d'appartenir à un campus ; Prisma refusait
> la requête. Elles passent désormais par l'école du programme, et exposent ses
> campus en liste (`program.campuses`), comme `/programs`. Aucun client n'a pu
> recevoir l'ancienne forme.

### Comparaison

| Méthode | Endpoint | Paramètres |
|---|---|---|
| `GET` | `/api/v1/compare/programs` | `?ids=uuid1,uuid2,uuid3` — **5 maximum** |

Les identifiants sont **dédupliqués** avant la requête. Sans cela, `?ids=X,X`
renvoyait un `404 introuvable` pour un programme parfaitement valide, la route
comparant la longueur de la liste au nombre de résultats.

---

## Endpoint public de contribution — retiré

**Retiré le 16 octobre 2026** (plan gestion-contenu, étape 1, décision D2) :
la page `/contribute` et `POST /api/contribute` n'existent plus. Ce qui suit
décrit l'endpoint tel qu'il était, pour l'historique ; le signalement de
l'étape 6 du plan le remplacera, sans IA.

`POST /api/contribute` (retiré)

| Contrainte | Valeur |
|------------|--------|
| Débit | 5 requêtes / 20 s / IP (middleware) |
| `schoolId` | requis, école existante **et `ACTIVE`** |
| `categories` | tableau non vide, dédupliqué, **liste blanche** : `Pricing`, `Ranking`, `Capacity`, `SchoolStats`, `Accreditation` |
| `urls` | tableau non vide, **5 maximum**, `https:` obligatoire, 2048 caractères max |
| Domaine des URLs | doit appartenir au **domaine officiel de l'école** ou à `CONTRIBUTION_ALLOWED_DOMAINS` |
| Hôtes internes | rejetés (boucle locale, RFC1918, lien-local, CGNAT, `.local`, `.internal`) |
| `userText` | 2 000 caractères maximum |
| `campusId`, `programId`, `programCampusId` | optionnels, **vérifiés comme appartenant à `schoolId`** |
| Écriture | un ticket par catégorie, dans **une seule transaction** |

La restriction de domaine existe parce que chaque ticket déclenche une
extraction Tavily **facturée** : sans elle, un utilisateur pouvait faire dépenser
des crédits sur des cibles arbitraires.

---

## CORS et erreurs

- **CORS** : `Access-Control-Allow-Origin: *` sur `/api/v1` (`lib/utils.ts`),
  inchangé. Il n'ouvre plus rien : un appel d'un autre site part sans le cookie
  de session (ou, s'il l'emporte, le navigateur refuse une réponse avec
  identifiants sous `*`), et reçoit 401.
- **Format d'erreur** : `{ "error": "description" }`.

| Code | Cas |
|------|-----|
| `401` | pas de session (proxy) |
| `400` | paramètre invalide, corps de requête non conforme |
| `404` | identifiant inexistant ou école non `ACTIVE` |
| `429` | plafond de débit dépassé (en-tête `Retry-After`) |
| `500` | erreur interne — message générique, détail en `console.error` |

---

## Tables exclues de toute réponse

- `ContributionInbox` — zone tampon interne, jamais exposée
- `User` — authentification du back-office
- `PipelineJob` — suivi interne des passes du pipeline

> **Pas encore exposés** : le détail année par année d'un programme sur un
> campus (`ProgramCampusAttachment`), la note de campus d'un programme
> (`Program.campus_policy_note`) et les lieux hors du parc (`ProgramPlacement`).
> Les 26 lignes-années en production ne sont lisibles que dans la base.

> `CronTarget` figurait dans cette liste ; **la table a été supprimée du projet**
> (migration `20260701100000_remove_cron_target`).

---

## Critères de validation

- Les réponses correspondent au schéma Prisma.
- Sans session, chaque route répond 401 (`test/proxy.test.ts`, `npm run smoke`).
- Seules les écoles `ACTIVE` sont exposées.
- Les en-têtes CORS sont appliqués.
- Recherche et filtres fonctionnent sur les routes paginées.
- La comparaison accepte jusqu'à 5 programmes, identifiants dupliqués compris.
- **Le plafond de 60 requêtes/minute se déclenche** — vérifié : 66 appels
  successifs donnent 60 réponses `200` puis des `429`.
- **Le cache ISR ne fonctionne pas** ; ne pas s'appuyer dessus tant que le point
  n'est pas repris (voir plus haut).
