# Veille Concurrentiel — gestionnaire de contenu de l'enseignement supérieur

Le gestionnaire de contenu des données sur les écoles françaises : campus,
programmes, tarifs, classements, capacités d'accueil, accréditations,
statistiques et admissions. Des collègues de l'équipe (adresses
`@em-normandie.fr`) consultent les données, des gestionnaires les tiennent à
jour, des admins gèrent les accès. En ligne : <https://app-vc-emn.vercel.app>.

| | Rôle | Branche |
|---|---|---|
| **Next.js 16** (`app/`, `lib/`) | site et back-office du contenu, derrière une connexion obligatoire (rôles `USER`, `GESTIONNAIRE`, `ADMIN`) ; API `/api/v1` réservée aux personnes connectées ; l'inbox, où l'admin valide les tickets de l'IA | `gestion`, `main` (la production) et `local` |
| **FastAPI** (`backend/`) et sa console (`/admin/cron`) | la recherche IA, **gelée** : recherche Tavily, extraction par la cascade Gemini, traitement des contributions ; lancée à la main sur le poste de l'admin, les recherches partent sur demande | **`local` seulement** |

Ils partagent une base **PostgreSQL (Neon)**. Cette branche n'a que Next.js :
aucun code n'y joint le backend, aucune commande ne le lance. Le plan du
chantier : [`docs/features/gestion-contenu.md`](docs/features/gestion-contenu.md) ;
l'index de la documentation : [`docs/README.md`](docs/README.md).

---

## Démarrage rapide

```bash
# 1. Dépendances
npm install

# 2. Configuration
cp .env.example .env.local                # renseigner les valeurs
# Réseau où le port 5432 est fermé (seuls 80 et 443 sortent) :
# DB_DRIVER=neon-ws dans .env.development.local. Poste local seulement,
# jamais sur Vercel.

# 3. Base de données
npx prisma generate
npm run db:status                         # état des migrations (lecture seule)
npm run db:migrate                        # applique l'historique complet
npx prisma db seed                        # base vierge seulement : exige SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD

# 4. Lancement
npm run dev                               # http://localhost:3000
```

Le back-office est sur `/admin`, la connexion sur `/admin/login`.

### Comptes

Détail : [`docs/architecture/gestion-contenu.md`](docs/architecture/gestion-contenu.md) §2.

- **Pas d'inscription libre, pas d'envoi d'e-mail.** Un admin ajoute l'adresse
  de travail d'un collègue à la liste blanche (`/admin/users`, « Ajouter une
  adresse »), puis le prévient lui-même. Seules les adresses
  `@em-normandie.fr` sont acceptées (constante `WORK_EMAIL_DOMAIN` de
  `lib/accounts.ts`).
- **Première connexion** sur `/admin/first-login` : la personne saisit cette
  adresse, son nom affiché et son mot de passe ; son compte devient actif, en
  `USER` sauf si l'admin a déjà changé son rôle.
- **Connexion** sur `/admin/login`, par l'adresse et le mot de passe. Un compte
  créé avant la liste blanche se connecte encore par son ancien identifiant,
  tant que l'admin n'a pas renseigné son adresse (« Renseigner l'adresse »).
- **Mot de passe oublié** : l'admin remet le compte en première connexion ; il
  ne fixe jamais le mot de passe d'un autre. Chacun change le sien, et son nom
  affiché, sur « Mon compte » (`/account`).
- **Un collègue qui part** : l'admin désactive son compte (sessions coupées,
  nom gardé pour l'historique) ; un invité qui ne s'est jamais connecté se
  retire de la liste. Il reste toujours au moins un administrateur actif.

> **Aucun mot de passe par défaut n'existe.** `prisma db seed` échoue tant que
> `SEED_ADMIN_EMAIL` (une adresse `@em-normandie.fr`) et `SEED_ADMIN_PASSWORD`
> (12 caractères minimum) ne sont pas renseignées. Il ne sert qu'à une base
> vierge : jamais sur la base partagée, qui a déjà ses comptes.

> **Port 5432 fermé ?** Avec `DB_DRIVER=neon-ws`, tout passe par le proxy
> WebSocket de Neon (443) : `npm run db:status` et `npm run db:migrate` par
> `@neondatabase/serverless`. Next.js est déjà en WebSocket et ne lit pas
> la variable. Sans elle, rien ne change : la CLI Prisma se connecte en
> 5432. Le premier déploiement d'une base vide exige la CLI
> Prisma, donc le 5432.

### La partie IA

Le backend FastAPI, la console `/admin/cron`, `npm run local`,
`npm run backend` et les tests Python vivent sur la branche `local` : son
README dit comment les lancer. Lancer le backend peut payer (Tavily, la
cascade Gemini) : règle 7 de `CLAUDE.md`.

---

## Variables d'environnement

La liste complète, commentée et classée par exécution, est dans
[`.env.example`](.env.example). Les pièges à connaître :

| Variable | Piège |
|----------|-------|
| `FASTAPI_URL`, `INTERNAL_API_TOKEN` et les variables du backend (`GEMINI_API_KEY`, `TAVILY_API_KEY*`, `CRON_*`…) | **Lues par aucun code de cette branche** : seule la branche `local` s'en sert, sur le poste (son `.env.example`). Jamais sur Vercel (mémo Vercel §1.3). |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Sans magasin partagé, la limitation de débit retombe en mémoire — elle ralentit une attaque mais ne la bloque pas sur une plateforme sans état. Ces noms exacts : `KV_REST_API_*` ne sont pas lus. |

**Déploiement** : seul Next.js va sur Vercel (offre Hobby), depuis `main` ;
la partie IA reste sur le poste, branche `local`, que Vercel ne construit pas.
Ce qui est en ligne, les variables à poser et à ne jamais poser, la base, la
bascule du poste entre les branches Neon, livrer une version :
[`docs/memory/memory-deploiement-vercel.md`](docs/memory/memory-deploiement-vercel.md).

---

## Commandes

| Commande | Effet |
|----------|-------|
| `npm run dev` | serveur de développement Next.js |
| `npm run build` / `npm start` | build et exécution de production |
| `npm run lint` | ESLint (configuration plate, `eslint.config.mjs`) |
| `npm run lint:fix` | idem, avec correction automatique |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | la suite TypeScript, comme `npm run test:ts` (D105 ; les tests Python vivent sur la branche `local`) |
| `npm run test:ts` | suite TypeScript (`node --test`) : fonctions de `lib/` et routes Next.js |
| `npm run smoke` | smoke local, **à la main** et avec l'accord du propriétaire : `npm run dev` lancé, il vérifie d'abord le mur sans session (pages renvoyées vers la connexion, API en 401), puis, si `APPVC_ADMIN_PASSWORD` et `APPVC_ADMIN_EMAIL` (ou, tant que le compte n'a pas d'adresse, `APPVC_ADMIN_USERNAME`) sont posées, les pages et les 15 `GET /api/v1/*` connecté (`scripts/smoke-local.ts`). Lecture seule, mais sur la base visée par le poste ; adresse locale seulement |
| `npm run db:status` | état de l'historique face à la base, en lecture seule : `npx prisma migrate status` sans `DB_DRIVER`, WebSocket (443) avec `DB_DRIVER=neon-ws` |
| `npm run db:migrate` | applique les migrations en attente, une transaction chacune ; refuse si une migration appliquée a changé ou si une autre est en échec |
| `npm run db:migrate:dry` | avec `DB_DRIVER=neon-ws` seulement : applique tout dans une transaction puis `ROLLBACK`, rien n'est inscrit |
| `npx prisma migrate deploy` / `status` | la CLI Prisma directe, en 5432 |
| `npx prisma db seed` | crée le compte administrateur initial d'une **base vierge** (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`) ; jamais sur la base partagée |

> **`prisma db push` est proscrit hors développement local.** C'est son usage
> qui a désynchronisé le schéma de ses migrations au point de rendre toute
> reconstruction impossible. Un garde-fou de CI le vérifie.

---

## Base de données

Le schéma vit dans [`prisma/schema.prisma`](prisma/schema.prisma), la connexion
dans [`prisma.config.ts`](prisma.config.ts) (Prisma 7 l'a déplacée hors du
schéma). Référence : [`docs/architecture/bdd.md`](docs/architecture/bdd.md).

Deux points de modèle qui ne se devinent pas :

- **Un programme appartient à une école, pas à un campus.** L'association aux
  campus passe par `ProgramCampus`. Un même programme ouvert sur trois campus =
  un `Program` + trois `ProgramCampus`. L'unicité est `(schoolId, name)`.
- **La capacité d'accueil varie par campus** : `CapacityRecord` référence
  `programCampusId`, jamais `programId`. Un import qui ne sait pas désigner le
  campus est **refusé** plutôt qu'écrit au hasard.

Pour régénérer une migration depuis l'historique, `SHADOW_DATABASE_URL` est
obligatoire (exigence de Prisma 7). Une migration s'écrit à la main, se joue à
blanc puis sur la branche Neon `dev`, avec l'accord du propriétaire
([`bdd.md`](docs/architecture/bdd.md) §4).

---

## Tests et qualité

```bash
npm run typecheck     # types
npm run lint          # 0 erreur attendu ; les avertissements sont la dette connue
npm test              # tests TypeScript (node --test), dont les routes de test/api/
npm run test:ts       # la même suite
npm run smoke         # à la main, npm run dev lancé : le mur, puis pages et API v1 connecté
```

Les routes Next.js se testent sans base ni serveur : `test/helpers/` remplace
`@/lib/prisma` par un faux client et `@/lib/auth` par des sessions simulées.
Chaque requête reçue par le faux client
est relue contre le vrai schéma Prisma (`test/helpers/prisma-schema.ts`) : un
champ disparu fait échouer le test, même derrière un `where: any`. Aucun test
ne sort du processus : la suite a été rejouée sous garde réseau
(connexions et DNS refusés hors de `127.0.0.1`), sans aucune tentative.
`test/api/admin-guards.test.ts` vérifie que **chaque route admin attend une
seule garde, celle de son niveau** (`test/helpers/access-policy.ts`), et
`test/api/access-matrix.test.ts` appelle chaque route admin sans session, en
`USER`, en `GESTIONNAIRE` et en `ADMIN`, avec la vraie `lib/auth.ts`.
La CI lance la suite (`.github/workflows/ci.yml`, job `ts-tests`). Écrire un
test : [`docs/architecture/gestion-contenu.md`](docs/architecture/gestion-contenu.md) §9.3.

`npm run lint` remonte des avertissements (`any`, règles du compilateur React) :
c'est une dette identifiée et chiffrée, maintenue visible plutôt que masquée.
Voir [`eslint.config.mjs`](eslint.config.mjs) pour le détail des arbitrages.

---

## Sécurité — points à connaître avant de contribuer

1. **Connexion obligatoire sur tout le site** : `proxy.ts` exige une session
   partout, pages, `/api-docs`, `/api/schools/*` et `/api/v1/*` compris ; seules
   la connexion, la première connexion (`/admin/first-login`,
   `POST /api/first-login`) et `/api/auth/*` restent libres. Toute route posée
   sous `/api/auth/` devient publique d'office. Le proxy ne regarde que
   l'existence de la session ; le rôle et l'état du compte se contrôlent côté
   serveur, et un compte qui n'est plus actif perd sa session.
2. **Toute route admin choisit une garde de `lib/auth.ts`, et une seule** :
   `guardSignedIn` (toute session : son nom affiché, son mot de passe, l'envoi d'un signalement), `guardManager`
   (gestionnaire ou admin : tout le contenu) ou `guardAdmin` (les comptes et
   toute l'IA, inbox comprise). Le rôle est **relu en base** à chaque requête,
   pas pris dans le jeton. Les écrans du back-office passent par
   `requirePage` : un `USER` ne voit pas `/admin`. `getServerSession` nu ne
   doit pas réapparaître. Détail : [`docs/architecture/gestion-contenu.md`](docs/architecture/gestion-contenu.md) §2 et §4.
3. **Next.js ne crée aucun ticket dans l'inbox**, et un test garde la porte
   fermée : un ticket `Pending_AI` serait payé au prochain lancement du
   backend. Le formulaire de signalement écrit dans sa propre table,
   `ContentReport`, sans IA.
4. **`lib/rate-limit.ts` est l'implémentation unique** de la limitation de débit :
   connexion et API v1 dans le proxy, par IP ; signalement dans sa route, par
   compte (10 par heure), l'équipe partageant l'IP de l'école.
5. **Sur la branche `local`**, deux garanties du backend : tout contenu
   externe injecté dans un prompt passe par `wrap_source()`
   (`backend/ai/gemma_client.py`), qui neutralise les balises de délimitation,
   et les règles vont dans le `system_prompt`, jamais dans le message
   utilisateur ; le texte libre d'un contributeur (`user_text`) **n'atteint
   jamais un modèle d'IA** (tests Python du backend).

En-têtes, dépendances et contrôles manuels :
[`docs/architecture/gestion-contenu.md`](docs/architecture/gestion-contenu.md) §8.

---

## Documentation

L'index est [`docs/README.md`](docs/README.md) : le plan
(`docs/features/gestion-contenu.md`), l'état du code
(`docs/architecture/gestion-contenu.md`), la charte graphique, la base,
l'API v1, la production sur Vercel et les cas limites. Les documents de la
partie IA sont sur la branche `local`.
