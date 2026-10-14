# Veille Concurrentiel — pipeline de données de l'enseignement supérieur

Plateforme de collecte, de vérification et de publication de données sur les
écoles françaises : campus, programmes, tarifs, classements, capacités
d'accueil, accréditations et statistiques.

Deux exécutions distinctes :

| | Rôle |
|---|---|
| **Next.js 16** (`app/`, `lib/`) | back-office d'administration, API publique `/api/v1`, formulaire public de contribution |
| **FastAPI** (`backend/`) | pipeline IA — recherche Tavily, extraction Gemini et Gemma, traitement des contributions ; lancé à la main sur le poste, les recherches partent sur demande |

Les deux partagent une base **PostgreSQL (Neon)** : Prisma côté TypeScript,
psycopg2 côté Python.

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
npx prisma db seed                        # exige SEED_ADMIN_PASSWORD

# 4. Lancement
npm run dev                               # http://localhost:3000
backend/.venv/Scripts/python -m uvicorn backend.main:app --reload   # :8000
```

Le back-office est sur `/admin`, la connexion sur `/admin/login`.

> **Aucun mot de passe par défaut n'existe.** `prisma db seed` échoue tant que
> `SEED_ADMIN_PASSWORD` n'est pas renseignée (12 caractères minimum).

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
| `INTERNAL_API_TOKEN` | Le même secret a porté trois noms. C'est celui-ci le bon ; `FASTAPI_INTERNAL_TOKEN` et `INTERNAL_TOKEN` restent acceptés mais sont à supprimer. |
| `ENVIRONMENT`, `ALLOWED_ORIGINS`, `CRON_RESEARCH_ENABLED`, `CRON_RESEARCH_HOUR`, `CRON_ROTATION_PASSES_PER_NIGHT` | **Supprimées le 14 octobre 2026**, le code ne les lit plus : les poser ne change rien. Le backend n'a plus de production. Il tourne sur le poste et n'écoute que sur `127.0.0.1`, `/docs` reste ouvert et CORS n'accepte que `http://localhost:3000`. Aucun cron ne paie Tavily : les passes dues partent sur demande (`POST /internal/run-due-passes`), sous le plafond `CRON_MONTHLY_CREDIT_CEILING`. Voir `docs/architecture/architecture.md` §5.5 et §10.6. |
| `CRON_CROWDSOURCING_INTERVAL_MINUTES` | Le traitement des contributions part **dès le démarrage** du backend, puis à cet intervalle. S'il trouve des tickets `Pending_AI`, il appelle Tavily et Gemma : lancer le backend suffit à payer. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Sans magasin partagé, la limitation de débit retombe en mémoire — elle ralentit une attaque mais ne la bloque pas sur une plateforme sans état. |

---

## Commandes

| Commande | Effet |
|----------|-------|
| `npm run dev` | serveur de développement Next.js |
| `npm run build` / `npm start` | build et exécution de production |
| `npm run lint` | ESLint (configuration plate, `eslint.config.mjs`) |
| `npm run lint:fix` | idem, avec correction automatique |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | suite Python (`pytest`), avec le `python` du `PATH` |
| `npm run test:ts` | suite TypeScript (`node --test`) : fonctions de `lib/` et routes Next.js |
| `npm run db:status` | état de l'historique face à la base, en lecture seule : `npx prisma migrate status` sans `DB_DRIVER`, WebSocket (443) avec `DB_DRIVER=neon-ws` |
| `npm run db:migrate` | applique les migrations en attente, une transaction chacune ; refuse si une migration appliquée a changé ou si une autre est en échec |
| `npm run db:migrate:dry` | avec `DB_DRIVER=neon-ws` seulement : applique tout dans une transaction puis `ROLLBACK`, rien n'est inscrit |
| `npx prisma migrate deploy` / `status` | la CLI Prisma directe, en 5432 |
| `npx prisma db seed` | crée le compte administrateur initial |

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
npm test              # 362 tests Python (pytest)
npm run test:ts       # 68 tests TypeScript (node --test), dont les routes de test/api/
```

Les routes Next.js se testent sans base ni serveur : `test/helpers/` remplace
`@/lib/prisma` par un faux client et `@/lib/auth` par des sessions simulées.
`test/api/admin-guards.test.ts` vérifie que **chaque route admin attend sa
garde**, et que la liste des routes ADMIN est celle d'`architecture.md` §3.6.
La CI lance les deux suites (`.github/workflows/ci.yml`).

Le test le plus important vérifie une garantie de confidentialité : **le texte
libre saisi par un contributeur (`user_text`) n'atteint jamais un modèle d'IA.**
Il est stocké en base et affiché uniquement dans le back-office.

`npm run lint` remonte des avertissements (`any`, règles du compilateur React) :
c'est une dette identifiée et chiffrée, maintenue visible plutôt que masquée.
Voir [`eslint.config.mjs`](eslint.config.mjs) pour le détail des arbitrages.

---

## Sécurité — points à connaître avant de contribuer

1. **Toute route admin choisit explicitement son garde** : `guardAuth` (toute
   session) ou `guardAdmin` (rôle ADMIN). `getServerSession` nu ne doit pas
   réapparaître. Les suppressions en cascade, la purge, la gestion des comptes
   et les actions à coût réel sont réservées aux ADMIN.
2. **Tout contenu externe injecté dans un prompt passe par `wrap_source()`**
   (`backend/ai/gemma_client.py`), qui neutralise les balises de délimitation.
   Les règles vont dans le `system_prompt`, jamais dans le message utilisateur.
3. **Les entrées publiques sont bornées** : `/api/contribute` plafonne le texte,
   les URLs et les catégories, et n'accepte que des liens vers le domaine de
   l'école ciblée ou une liste blanche.
4. **`lib/rate-limit.ts` est l'implémentation unique** de la limitation de débit.

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
