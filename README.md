# Veille Concurrentiel — pipeline de données de l'enseignement supérieur

Plateforme de collecte, de vérification et de publication de données sur les
écoles françaises : campus, programmes, tarifs, classements, capacités
d'accueil, accréditations et statistiques.

Deux exécutions distinctes :

| | Rôle |
|---|---|
| **Next.js 16** (`app/`, `lib/`) | site et back-office du contenu, derrière une connexion obligatoire (rôles `USER`, `GESTIONNAIRE`, `ADMIN`) ; API `/api/v1` réservée aux personnes connectées |
| **FastAPI** (`backend/`) | pipeline IA — recherche Tavily, extraction par la cascade Gemini (Gemma en dernier recours pour les contributions), traitement des contributions ; lancé à la main sur le poste, les recherches partent sur demande |

Les deux partagent une base **PostgreSQL (Neon)** : Prisma côté TypeScript,
psycopg2 côté Python.

> **Réorientation du 16 octobre 2026.** Le projet devient d'abord un
> **gestionnaire de contenu** en ligne, derrière une connexion obligatoire, avec
> trois rôles (utilisateur, gestionnaire, admin). La partie FastAPI (recherche
> IA) est **gelée** : conservée telle quelle, réservée à l'admin. La
> contribution du public est abandonnée, remplacée à terme par un formulaire de
> signalement. Plan : [`docs/features/gestion-contenu.md`](docs/features/gestion-contenu.md) ;
> index de la documentation : [`docs/README.md`](docs/README.md). Ce README
> décrit le code tel qu'il est ; chaque étape du plan le met à jour.

---

## Démarrage rapide

```bash
# 1. Dépendances
npm install
python -m venv backend/.venv
backend/.venv/Scripts/activate            # Windows
# source backend/.venv/bin/activate       # macOS / Linux
pip install -r backend/requirements-dev.txt

# 2. Configuration
cp .env.example .env.local                # renseigner les valeurs
cp .env.example backend/.env              # idem, section FastAPI
# Réseau où le port 5432 est fermé (seuls 80 et 443 sortent) :
# DB_DRIVER=neon-ws dans .env.development.local (Node) ET dans backend/.env
# (Python). Poste local seulement, jamais sur Vercel.

# 3. Base de données
npx prisma generate
npm run db:status                         # état des migrations (lecture seule)
npm run db:migrate                        # applique l'historique complet
npx prisma db seed                        # base vierge seulement : exige SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD

# 4. Lancement (Windows)
npm run local                             # backend (fenêtre à part) puis Next.js
```

Le back-office est sur `/admin`, la connexion sur `/admin/login`.

### Comptes

Plan gestion-contenu, étape 2 ([`docs/architecture/gestion-contenu.md`](docs/architecture/gestion-contenu.md) §2) :

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

`npm run local` (`scripts/start-local.ps1`) :

1. refuse si le port 8000 est déjà pris : deux backends tiendraient deux
   comptabilités de crédits Tavily qui s'ignorent ;
2. ouvre le backend dans **sa propre fenêtre**, sur `127.0.0.1:8000`. Fermer
   Next.js ne coupe pas une passe en cours. Ctrl+C dans cette fenêtre arrête le
   backend, et la fenêtre reste ouverte pour qu'on y lise une erreur ;
3. attend `/health` jusqu'à 60 s et affiche les erreurs de démarrage ;
4. lance `npm run dev` sur http://localhost:3000, sauf si Next.js tourne déjà.

Pour le backend seul, dans le terminal courant : `npm run backend`. Pour le
site seul : `npm run dev`.

> **Lancer le backend peut payer.** Le traitement des contributions part dès le
> démarrage : s'il trouve des tickets `Pending_AI`, il appelle Tavily et la cascade Gemini (Gemma en dernier recours).
> Regardez l'inbox avant.

> **Aucun mot de passe par défaut n'existe.** `prisma db seed` échoue tant que
> `SEED_ADMIN_EMAIL` (une adresse `@em-normandie.fr`) et `SEED_ADMIN_PASSWORD`
> (12 caractères minimum) ne sont pas renseignées. Il ne sert qu'à une base
> vierge : jamais sur la base partagée, qui a déjà ses comptes.

> **Port 5432 fermé ?** Avec `DB_DRIVER=neon-ws`, tout passe par le proxy
> WebSocket de Neon (443) : `npm run db:status` et `npm run db:migrate` par
> `@neondatabase/serverless`, le backend par un pont local
> (`backend/neon_ws_bridge.py`). Next.js est déjà en WebSocket et ne lit pas
> la variable. Sans elle, rien ne change : la CLI Prisma et psycopg2 se
> connectent en 5432. Le premier déploiement d'une base vide exige la CLI
> Prisma, donc le 5432.

---

## Variables d'environnement

La liste complète, commentée et classée par exécution, est dans
[`.env.example`](.env.example). Les pièges à connaître :

| Variable | Piège |
|----------|-------|
| `INTERNAL_API_TOKEN` | Le même secret a porté trois noms. C'est celui-ci le bon ; `FASTAPI_INTERNAL_TOKEN` et `INTERNAL_TOKEN` restent acceptés mais sont à supprimer. Local seulement, comme `FASTAPI_URL`. |
| `FASTAPI_URL` | **Local seulement, jamais sur Vercel.** Absente, `/admin/cron` affiche « pilotage depuis le poste local » : historique lu en base, aucun lancement. Il n'y a plus de repli sur `localhost:8000`. Posée sans `INTERNAL_API_TOKEN` : erreur 500 explicite. |
| `ENVIRONMENT`, `ALLOWED_ORIGINS`, `CRON_RESEARCH_ENABLED`, `CRON_RESEARCH_HOUR`, `CRON_ROTATION_PASSES_PER_NIGHT` | **Supprimées le 14 octobre 2026**, le code ne les lit plus : les poser ne change rien. Le backend n'a plus de production. Il tourne sur le poste et n'écoute que sur `127.0.0.1`, `/docs` reste ouvert et CORS n'accepte que `http://localhost:3000`. Aucun cron ne paie Tavily : les passes dues partent sur demande (`POST /internal/run-due-passes`), sous le plafond `CRON_MONTHLY_CREDIT_CEILING`. Voir `docs/architecture/architecture.md` §5.5 et §10.6. |
| `CRON_CROWDSOURCING_INTERVAL_MINUTES` | Le traitement des contributions part **dès le démarrage** du backend, puis à cet intervalle. S'il trouve des tickets `Pending_AI`, il appelle Tavily et la cascade Gemini (Gemma en dernier recours) : lancer le backend suffit à payer. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Sans magasin partagé, la limitation de débit retombe en mémoire — elle ralentit une attaque mais ne la bloque pas sur une plateforme sans état. Ces noms exacts : `KV_REST_API_*` ne sont pas lus. |

**Déploiement** : seul Next.js va sur Vercel (offre Hobby) ; le backend reste
sur le poste. Variables à poser et à ne jamais poser sur Vercel, intégration
Neon, Upstash, ordre des opérations et vérifications :
[`docs/memory/memory-deploiement-vercel.md`](docs/memory/memory-deploiement-vercel.md).

---

## Commandes

| Commande | Effet |
|----------|-------|
| `npm run local` | backend FastAPI dans sa propre fenêtre, puis Next.js (`scripts/start-local.ps1`, Windows) |
| `npm run backend` | backend seul, dans le terminal courant : `uvicorn` sur `127.0.0.1:8000`, sans `--reload` |
| `npm run dev` | serveur de développement Next.js |
| `npm run build` / `npm start` | build et exécution de production |
| `npm run lint` | ESLint (configuration plate, `eslint.config.mjs`) |
| `npm run lint:fix` | idem, avec correction automatique |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | suite Python (`pytest`), avec le `python` du `PATH` |
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
schéma).

Deux points de modèle qui ne se devinent pas :

- **Un programme appartient à une école, pas à un campus.** L'association aux
  campus passe par `ProgramCampus`. Un même programme ouvert sur trois campus =
  un `Program` + trois `ProgramCampus`. L'unicité est `(schoolId, name)`.
- **La capacité d'accueil varie par campus** : `CapacityRecord` référence
  `programCampusId`, jamais `programId`. Un import qui ne sait pas désigner le
  campus est **refusé** plutôt qu'écrit au hasard.

Pour régénérer une migration depuis l'historique, `SHADOW_DATABASE_URL` est
obligatoire (exigence de Prisma 7).

---

## Tests et qualité

```bash
npm run typecheck     # types
npm run lint          # 0 erreur attendu ; les avertissements sont la dette connue
npm test              # 722 tests Python (pytest), +25 sous-tests
npm run test:ts       # 542 tests TypeScript (node --test), dont les routes de test/api/
npm run smoke         # à la main, npm run dev lancé : le mur, puis pages et API v1 connecté
```

Les routes Next.js se testent sans base ni serveur : `test/helpers/` remplace
`@/lib/prisma` par un faux client, `@/lib/auth` par des sessions simulées et
`fetch` par un faux backend FastAPI. Chaque requête reçue par le faux client
est relue contre le vrai schéma Prisma (`test/helpers/prisma-schema.ts`) : un
champ disparu fait échouer le test, même derrière un `where: any`. Aucun test
ne sort du processus : les deux suites ont été rejouées sous garde réseau
(connexions et DNS refusés hors de `127.0.0.1`), sans aucune tentative.
`test/api/admin-guards.test.ts` vérifie que **chaque route admin attend une
seule garde, celle de son niveau** (`test/helpers/access-policy.ts`), et
`test/api/access-matrix.test.ts` appelle chaque route admin sans session, en
`USER`, en `GESTIONNAIRE` et en `ADMIN`, avec la vraie `lib/auth.ts`.
La CI lance les deux suites (`.github/workflows/ci.yml`).

Le test le plus important vérifie une garantie de confidentialité : **le texte
libre saisi par un contributeur (`user_text`) n'atteint jamais un modèle d'IA.**
Il est stocké en base et affiché uniquement dans le back-office.

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
   `guardSignedIn` (toute session : son nom affiché et son mot de passe), `guardManager`
   (gestionnaire ou admin : tout le contenu) ou `guardAdmin` (les comptes et
   toute l'IA, inbox comprise). L'ancienne garde « toute session » du
   back-office n'existe plus. Le rôle est **relu en base** à chaque requête,
   pas pris dans le jeton. Les écrans du back-office passent par
   `requirePage` : un `USER` ne voit pas `/admin`. `getServerSession` nu ne
   doit pas réapparaître. Détail : [`docs/architecture/gestion-contenu.md`](docs/architecture/gestion-contenu.md) §2 et §4.
3. **Tout contenu externe injecté dans un prompt passe par `wrap_source()`**
   (`backend/ai/gemma_client.py`), qui neutralise les balises de délimitation.
   Les règles vont dans le `system_prompt`, jamais dans le message utilisateur.
4. **Next.js ne crée aucun ticket dans l'inbox** : la contribution du public
   (`/api/contribute`) est retirée, et un test garde la porte fermée. Un ticket
   `Pending_AI` serait payé au prochain lancement du backend.
5. **`lib/rate-limit.ts` est l'implémentation unique** de la limitation de débit.

---

## Documentation

| Chemin | Contenu |
|--------|---------|
| `docs/architecture/` | architecture et découpage fonctionnel |
| `docs/features/` | spécifications par fonctionnalité |
| `docs/memory/` | tâches et décisions **en cours** — déploiement Vercel, rétention des tickets, vulnérabilités npm |
| `docs/testing/` | stratégie de test |
| `docs/edgecase.md` | cas limites recensés |

`docs/architecture/` a été remis en phase avec le code après la remédiation de
l'audit technique de septembre 2026 — c'est la référence. `docs/memory/` ne
contient plus que ce qui n'est **pas terminé** : la marche à suivre pour le
déploiement Vercel, la politique de rétention des tickets, et la tâche de
traitement des vulnérabilités npm.

Les grandes fiches de `docs/features/` sont des **plans d'implémentation
historiques**. Chacune porte en tête un encadré signalant ce que la remédiation a
changé et où lire la version à jour.
