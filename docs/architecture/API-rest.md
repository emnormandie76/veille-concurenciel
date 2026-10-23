# API REST (v1) — spécification et état réel

> Ce que font les 15 routes de `app/api/v1`, tenues par `test/api/v1.test.ts`.
> La page `/api-docs` (`app/api-docs/endpoints.ts`) décrit la même API,
> paramètres et exemples de réponse compris, et `test/api-docs.test.ts` la
> confronte aux routes. Les décisions citées (G6, D25…) sont celles du plan
> [`features/gestion-contenu.md`](../features/gestion-contenu.md).

## Objectif

Exposer en lecture les données validées (écoles, campus, programmes, tarifs,
capacités, classements, statistiques, accréditations, admissions) **aux
personnes connectées** (G6) ; l'API doit rester performante et **protéger la
base Neon**, qui est sur un palier gratuit. Des clés d'API pourront s'ajouter
si un usage externe apparaît.

## Pile technique

- **Framework** : Next.js 16 App Router (Route Handlers `app/api/v1/...`),
  `next@16.4.2`
- **Langage** : TypeScript
- **Accès BDD** : Prisma 7 (`prisma@7.10.0`), en WebSocket
- **Hébergement** : Vercel, avec le site (<https://app-vc-emn.vercel.app>)

Le plafond de débit et la session vivent dans `proxy.ts` : une faille de
contournement du proxy dans Next.js les annulerait d'un coup. D'où la
surveillance des avis de sécurité de `next` (gestion des dépendances :
[`gestion-contenu.md`](gestion-contenu.md) §8.3).

---

## Authentification

- **Session obligatoire** : `proxy.ts` exige un jeton de session NextAuth
  valide sur tout le site, l'API v1 comprise (seules la connexion, la première
  connexion et `/api/auth/*` restent libres). C'est la session du site : un
  cookie posé par la connexion (adresse de travail et mot de passe), pas une
  clé d'API. Le proxy ne regarde que le jeton : un compte désactivé ou remis
  en première connexion garde la lecture de l'API jusqu'à l'expiration du sien
  (8 h au plus, décision D20).
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

### Limitation de débit

| Portée | Plafond | Implémentation |
|--------|---------|----------------|
| `/api/v1/:path*` | **60 requêtes / minute / IP** | `proxy.ts` → `lib/rate-limit.ts`, seau `v1:` |

- Le plafond ne compte que les requêtes **connectées** : un appel refusé (401)
  ne consomme pas le quota de l'IP, que des collègues derrière le même réseau
  partagent.
- Les pré-vols CORS (`OPTIONS`) ne consomment pas de quota.
- Dépassement → **429** avec un en-tête `Retry-After`.
- L'IP est déterminée par `clientIp()`, qui interroge `x-vercel-forwarded-for`
  puis `x-real-ip` **avant** `x-forwarded-for`, ce dernier étant contrôlable
  par le client.
- Le compteur s'appuie sur **Upstash Redis** si `UPSTASH_REDIS_REST_URL` et
  `UPSTASH_REDIS_REST_TOKEN` sont définies. **Sinon il retombe en mémoire, et le
  plafond ne tient pas sur une plateforme sans état.**

### Cache — l'intention et la réalité

**Intention** : `export const revalidate = 3600` sur chaque route, la première
requête frappant la base et les suivantes étant servies par le CDN.

**État réel** : la directive est bien présente dans les 15 routes, **mais elle
ne s'applique pas**. Tous les handlers reçoivent `request` et lisent
`new URL(request.url).searchParams` : en App Router, cela force le rendu
dynamique et neutralise `revalidate`. Le build le confirme : les routes
`/api/v1` sortent toutes en `ƒ (Dynamic)`, aucune en `○ (Static)`.

**Conséquence** : chaque appel atteint la base. C'est la limitation de débit,
et non le cache, qui protège Neon.

**Piste** si le cache devient nécessaire : passer par
`unstable_cache` / `revalidateTag` autour des requêtes Prisma, plutôt que de
compter sur le cache de segment de route, inopérant dès qu'un paramètre de
requête est lu.

### Bornes sur les collections

| Type de route | Protection |
|---------------|------------|
| Collections racine — `/v1/schools`, `/v1/programs`, `/v1/rankings` | **paginées** via `parsePagination` (`limit` plafonné à 100, défaut 20, 50 pour `/rankings`). Une valeur hors bornes est ramenée dans les bornes (`page=0` → 1, `limit=1000` → 100) ; vide ou non numérique, elle reprend le défaut |
| Sous-collections — les 7 routes rattachées à une entité parente | **plafond dur `take: 500`** |
| `/v1/compare/programs` | 5 identifiants maximum, **dédupliqués** |

Le plafond de 500 a été préféré à la pagination pour les sous-collections : les
paginer aurait changé leur forme de réponse (un tableau nu devient
`{ data, pagination }`) et cassé tout consommateur existant. La valeur est très
au-dessus de tout volume légitime : elle borne une requête pathologique sans
tronquer de donnée réelle.

---

## Provenance de chaque donnée

Chaque ressource exposée (école, campus, programme, chiffres clés,
accréditation, tarif, classement, capacité), et chaque enregistrement imbriqué
(les places et les admissions d'un programme dans `/programs/[id]` ; ses
places, tarifs, classements et admissions dans `/compare/programs`), porte
**`updated_at`** : la date de sa dernière modification (ISO 8601), ou `null`
pour une donnée **non suivie** (écrite avant le 20 octobre 2026 et jamais
modifiée depuis). Seule la dernière modification est connue (D10).

**Ni l'auteur ni l'origine** (D25) : une donnée rendue par l'API est tenue
pour vérifiée. Le nom de la personne qui l'a modifiée ou validée, et l'origine
de la modification (saisie, recherche IA), restent en base ; ils s'affichent
sur le site et dans le gestionnaire, jamais dans l'API. Les routes ne lisent
même pas l'auteur.

Les simples renvois (l'école d'un programme, le campus d'une capacité, le
programme d'un tarif) ne portent pas de date : elle se lit sur la ressource
elle-même.

**`source_url`** est porté par les tarifs, classements, capacités, chiffres
clés, accréditations, programmes (D12) et admissions (D49), `null` quand aucun
lien n'est connu. Une saisie à la main n'est acceptée qu'en `http(s)`,
2 048 caractères au plus (D27) ; les liens plus anciens sont rendus tels quels.

`/api-docs` décrit ces deux champs dans sa présentation et dans chaque exemple
de réponse ; `test/api-docs.test.ts` et `test/api/v1-provenance.test.ts` les
confrontent aux routes, et le second vérifie qu'aucun champ d'auteur ni
d'origine ne sort.

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
| `GET` | `/api/v1/programs/[id]` | Détail d'un programme : son école, ses campus et leurs places, ses admissions (`entries`) | — | objet |
| `GET` | `/api/v1/programs` | Recherche globale | `?search=&admission_exam=&alternance=&page=&limit=` | `{ data, pagination }` |

> **Modèle** : un programme appartient à une **école**, pas à un campus. Le
> filtre `campus_id` passe par la table d'association `ProgramCampus`.

> **Admissions** (D16, D48, D53) : `entries` est un tableau, dans l'ordre de
> l'année d'entrée puis du niveau, une ligne par entrée possible : `entry_year`
> (l'année du programme où l'on entre, de 1 à 5), `required_level` (0 pour le
> Bac, de 1 à 5 pour Bac+1 à Bac+5), `route` (`PARCOURSUP`, `EXAM` pour un
> concours, `TITLE` pour une admission sur titre, `INTERNATIONAL`,
> `UNSPECIFIED`), `note` (le concours, les diplômes acceptés), `source_url` et
> `updated_at`. Vide quand aucune entrée n'est connue. `admission_exam` (le
> concours, en texte libre) reste à côté, et le filtre `?admission_exam=` de
> `/programs` aussi (D47). Ni l'auteur ni l'origine (D25).

### Tarifs, classements, capacités

| Méthode | Endpoint | Description | Forme |
|---|---|---|---|
| `GET` | `/api/v1/programs/[id]/pricing` | Historique tarifaire | tableau, `take: 500` |
| `GET` | `/api/v1/schools/[id]/pricing` | Tarifs de tous les programmes ; chaque ligne porte `program` (`id`, `name`, `campuses`) | tableau, `take: 500` |
| `GET` | `/api/v1/programs/[id]/rankings` | Classements d'un programme | tableau, `take: 500` |
| `GET` | `/api/v1/rankings` | Tableau global, écoles `ACTIVE` ; chaque ligne porte `program` (`id`, `name`, `school`, `campuses`) ; `?ranking_name=&year=&page=&limit=` | `{ data, pagination }` |
| `GET` | `/api/v1/programs/[id]/capacity` | Places disponibles | tableau, `take: 500` |

> **Capacité** : elle est rattachée à un couple **(programme, campus)** via
> `ProgramCampus`, jamais au programme seul. La réponse expose donc le campus.
> Les filtres par école passent par l'école du programme, jamais par un campus.

### Comparaison

| Méthode | Endpoint | Paramètres |
|---|---|---|
| `GET` | `/api/v1/compare/programs` | `?ids=uuid1,uuid2,uuid3` — **5 maximum** |

Chaque programme y porte son école, ses campus et leurs places, ses tarifs,
ses classements et ses admissions (`entries`).

Les identifiants sont **dédupliqués** avant la requête : sans cela, `?ids=X,X`
renverrait un `404 introuvable` pour un programme valide, la route comparant
la longueur de la liste au nombre de résultats.

---

## CORS et erreurs

- **CORS** : `Access-Control-Allow-Origin: *` sur `/api/v1` (`lib/utils.ts`).
  Il n'ouvre rien : un appel d'un autre site part sans le cookie de session
  (ou, s'il l'emporte, le navigateur refuse une réponse avec identifiants sous
  `*`), et reçoit 401.
- **Format d'erreur** : `{ "error": "description" }`, et rien d'autre.

| Code | Cas |
|------|-----|
| `401` | pas de session (proxy) |
| `400` | paramètre invalide (ex. plus de 5 identifiants à comparer, `?year=abc`) |
| `404` | identifiant inexistant ou école non `ACTIVE` |
| `429` | plafond de débit dépassé (en-tête `Retry-After`) |
| `500` | erreur interne — message générique, détail en `console.error` |

---

## Tables exclues de toute réponse

- `ContributionInbox` — zone tampon interne, jamais exposée
- `User` — authentification ; l'auteur d'une donnée n'est pas exposé (D25)
- `PipelineJob`, `ResearchLaunch` — suivi interne de l'IA
- `ContentReport` — les signalements restent au back-office

> **Pas exposés** : le détail année par année d'un programme sur un campus
> (`ProgramCampusAttachment`), la note de campus d'un programme
> (`Program.campus_policy_note`) et les lieux hors du parc (`ProgramPlacement`).

---

## Critères de validation

- Les réponses correspondent au schéma Prisma.
- Sans session, chaque route répond 401 (`test/proxy.test.ts`, `npm run smoke`).
- Seules les écoles `ACTIVE` sont exposées.
- Les en-têtes CORS sont appliqués.
- Recherche et filtres fonctionnent sur les routes paginées.
- La comparaison accepte jusqu'à 5 programmes, identifiants dupliqués compris.
- Chaque ressource et chaque enregistrement imbriqué porte sa date
  (`updated_at`), sans auteur ni origine (`test/api/v1-provenance.test.ts`),
  admissions comprises.
- **Le plafond de 60 requêtes par minute se déclenche** : vérifié à la main,
  le premier 429 arrive à la 61e requête ([`gestion-contenu.md`](gestion-contenu.md)
  §8.4).
- **Le cache ISR ne fonctionne pas** ; ne pas s'appuyer dessus tant que le point
  n'est pas repris (voir plus haut).
