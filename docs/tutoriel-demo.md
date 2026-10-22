# Mini tuto — lancer l'IA et montrer le pipeline

Ce guide sert à **préparer et dérouler une démonstration** de la partie IA,
sur la branche `local` : démarrer le backend, lancer une passe, retrouver les
tickets, les valider. Il ne remplace pas la
[fiche de test manuel](testing/manual_testing_cron.md) ni le
[README](../README.md), dont il reprend l'essentiel.

---

## 1. Comprendre en 30 secondes

```
   Tavily Research + Gemini ──►  INBOX (zone tampon)  ──► validation humaine ──► base ──► site + API /api/v1
   (pipeline IA, Phases 1 et 2)         tickets
```

| Brique | Où | Rôle |
|---|---|---|
| **Next.js** | `localhost:3000` | site, API v1, **back-office `/admin`**, console `/admin/cron` |
| **Backend FastAPI** | `127.0.0.1:8000` | le pipeline IA ; **lancé à la main** sur le poste, il n'est pas hébergé |
| **Base Neon** | cloud | partagée par les deux, et par le site en ligne |

Deux idées à répéter à l'oral :

1. **Rien n'entre en production sans validation humaine.** Tout passe par l'inbox.
2. **Rien ne part tout seul.** Plus aucun cron : une recherche ne part que si
   l'admin la demande (et chaque recherche coûte des crédits Tavily).

Les deux phases du pipeline :

| Phase | Ce qu'elle fait | Coût indicatif |
|---|---|---|
| **Phase 1** (découverte) | trouve les campus et les programmes d'une école | ~30 crédits Tavily |
| **Phase 2** (enrichissement) | tarifs, classements, capacités, accréditations, statistiques | ~10 crédits par catégorie, jusqu'à plusieurs centaines par école |

---

## 2. Avant la démo (à faire la veille)

- [ ] Le poste est sur la branche `local` du dépôt (la console et le backend
  n'existent que là).
- [ ] Le poste vise la **branche Neon `dev`**, pas `main` (`main` est la
  production Vercel). Contrôle : `npm run db:status` affiche l'hôte visé
  (`ep-proud-lab-…` = `dev`).
- [ ] Les fichiers `.env.local`, `.env.development.local` et `backend/.env` sont
  remplis, avec **le même `INTERNAL_API_TOKEN`** des deux côtés et
  `DB_DRIVER=neon-ws` si le réseau bloque le port 5432.
- [ ] **Regardez l'inbox avant de lancer le backend** : le traitement des
  contributions part dès le démarrage et paie Tavily + Gemini s'il trouve des
  tickets `Pending_AI`.
- [ ] Vous savez combien de crédits vous acceptez de dépenser. Une passe réelle
  de Phase 1 sur une école : ~30 crédits, ~7 minutes.

---

## 3. Lancer l'application

### Option A — tout d'un coup (recommandé)

```powershell
npm run local
```

Le script `scripts/start-local.ps1` :

1. refuse de démarrer si le port 8000 est déjà pris (un seul backend à la fois) ;
2. ouvre le **backend dans sa propre fenêtre** (`127.0.0.1:8000`) — fermer
   Next.js ne coupe donc pas une passe en cours ;
3. attend `/health` jusqu'à 60 s et affiche les erreurs de démarrage ;
4. lance Next.js sur <http://localhost:3000>.

Attendu dans le terminal : `[local] Backend prêt (version …)`.

### Option B — séparément

```powershell
npm run backend     # backend seul, dans ce terminal
npm run dev         # site seul, dans un autre terminal
```

### Vérifier que ça tourne

| Test | Attendu |
|---|---|
| <http://127.0.0.1:8000/health> | `{"status":"ok","version":"…"}` |
| <http://localhost:3000> | liste des écoles (après connexion) |
| <http://localhost:3000/admin/cron> | redirige vers `/admin/login`, puis le tableau de bord (compte admin) |

`"status": "degraded"` = le démarrage a échoué en partie ; la liste `errors`
dit où (base, clés Tavily…), et elle s'affiche aussi dans `/admin/cron`.

### Arrêter

`Ctrl+C` dans la fenêtre du backend, `Ctrl+C` dans celle de Next.js.

---

## 4. Le fil de la démo

### Étape 1 — Montrer le tableau de bord `/admin/cron`

Connectez-vous (`/admin/login`, compte admin), puis balayez l'écran de haut en
bas :

- **État du backend local** : « prêt ». Éteignez-le un instant pour montrer le
  bandeau « non lancé » : l'écran le voit revenir tout seul.
- **Modèles IA** : la cascade Gemini, Gemma en dernier recours.
- **Quotas Tavily** : crédits restants par clé.
- **Passes dues** : les écoles dont la recherche est « due » (jamais faite, ou
  datant de plus de 6 mois), avec le coût estimé.
- **Historique du pipeline** : les 30 derniers jobs, lus en base, et qui les a
  lancés.

### Étape 2 — Simuler (gratuit)

Dans le panneau « Passes dues » : choisir 1 à 5 passes, puis **« Simuler »**.

> Message du type : *« Simulation : 2 passes partiraient — … »*

C'est le bon moment pour dire : **la simulation ne crée aucun job et ne
consomme aucun crédit**. Elle montre ce qui partirait et pourquoi.

### Étape 3 — Lancer une vraie passe (coûte des crédits)

> Dépense réelle. À ne faire que si vous l'avez décidé.

Deux façons :

- **Passes dues** : bouton **« Lancer N passes dues »**, confirmer dans le
  dialogue qui donne le coût estimé. Le backend resynchronise d'abord les
  quotas Tavily.
- **Recherche manuelle** : choisir **Phase 1**, une école, puis **Lancer**.
  Laissez la case « collecte du rattachement campus » décochée (elle ajoute
  ~15 crédits).

Résultat : la tâche apparaît dans « Tâches en cours » avec sa progression,
puis dans l'historique (`completed`). Comptez ~7 minutes pour une Phase 1 :
prévoyez de lancer **avant** la démo et de montrer le résultat pendant.

> Astuce : si l'extraction Gemini tombe en panne, le rapport Research (déjà
> payé) est rangé dans un ticket `Failed`, et relancer la même école le
> reprend **sans repayer** Research.

### Étape 4 — Retrouver les tickets : `/admin/inbox`

C'est là que **tout atterrit**. Un ticket a un statut :

| Statut | Signification |
|---|---|
| `Pending_AI` | contribution en attente du backend |
| `Pending_Admin` | traité par l'IA, **en attente de votre validation** |
| `Validated` | écrit en base, visible sur le site |
| `Rejected` | refusé |
| `Failed` | erreur inattendue ; rejoué plus tard, ou rapport Research rangé |

Pour une passe de Phase 1, vous cherchez un ticket **`Program_Discovery`** en
`Pending_Admin`. Dans le ticket :

- les données extraites (campus, programmes), éditables avant validation ;
- le bloc **« Sources »** : trois liens au plus (page catalogue en premier) pour
  que l'admin vérifie rapidement.

Puis **valider** (ou rejeter). La donnée n'entre en base qu'à la validation, et
la fiche dit « Validé par … depuis une recherche IA ».

### Étape 5 — Voir le résultat sur le site

Après validation, rechargez <http://localhost:3000> (les pages se
régénèrent après chaque écriture) :

- fiche école : `/schools/[id]` ;
- détail programme : `/schools/[id]/programs/[pid]` ;
- API : `/api/v1/…` et sa documentation <http://localhost:3000/api-docs>.

Garantie à mentionner : **le texte libre d'un contributeur n'est jamais envoyé
à un modèle d'IA** ; il n'est affiché que dans le back-office.

---

## 5. Pièges fréquents

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Le port 8000 est déjà pris » | un backend tourne déjà | gardez sa fenêtre, lancez seulement `npm run dev` |
| `/health` en `degraded`, « Connexion PostgreSQL impossible » | port 5432 fermé | `DB_DRIVER=neon-ws` dans `backend/.env`, relancer |
| « Le backend refuse le jeton » | `INTERNAL_API_TOKEN` différent des deux côtés | aligner `.env.local` et `backend/.env`, relancer |
| « Pilotage depuis le poste local » | `FASTAPI_URL` absente de `.env.local` (ou Next.js pas relancé) | la poser, relancer Next.js |
| « Backend local non lancé » alors qu'il tourne | autre chose sur le port, `FASTAPI_URL` mal réglée | vérifier `/health` dans le navigateur |
| Passe terminée sans ticket | école déjà cartographiée, rien de nouveau (`no_new_discoveries: true`) | normal : Research a été payé quand même |
| Lancement refusé (409 `ALREADY_RUNNING`) | une passe tourne déjà | attendre sa fin |
| Lancement refusé (503 `USAGE_SYNC_FAILED`) | un quota Tavily n'a pas pu être resynchronisé | réessayer, rien n'est parti |

---

## 6. Antisèche des commandes

| Commande | Effet |
|---|---|
| `npm run local` | backend (fenêtre à part) + Next.js |
| `npm run backend` | backend seul |
| `npm run dev` | site seul, <http://localhost:3000> |
| `npm run db:status` | état des migrations (lecture seule) |
| `npm test` / `npm run test:ts` | tests Python / TypeScript |

## 7. Pour aller plus loin

- Détail de la procédure de test, étape par étape : [`testing/manual_testing_cron.md`](testing/manual_testing_cron.md)
- Architecture (pipeline, inbox, statuts) : [`architecture/architecture.md`](architecture/architecture.md)
- API v1 : [`architecture/API-rest.md`](architecture/API-rest.md)
- Cas limites : [`edgecase.md`](edgecase.md)
