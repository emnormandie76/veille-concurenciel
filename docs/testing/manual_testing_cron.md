# ⚙️ Fiche de Test Manuel : Dashboard Admin & Monitoring Cron

Ce guide détaille les étapes nécessaires pour tester localement le tableau de bord de monitoring des tâches (`/admin/cron`), le serveur backend (FastAPI), le lancement de recherches manuelles, et la **simulation des passes dues** (étape 5).

> **Revu le 14 octobre 2026** (plan [`backend-local.md`](../features/backend-local.md), étape 3) :
> plus de cron ni de rotation nocturne. Les passes dues partent sur demande
> (`POST /internal/run-due-passes`). Aucun identifiant n'est écrit dans ce
> document : le compte admin est créé par le seed avec un mot de passe que vous
> fournissez.

> **Où faire ces tests.** Lancer le backend **écrit dans la base** au démarrage
> (reprise des jobs orphelins, purge des jobs terminés) et **traite aussitôt les
> contributions en attente**, ce qui coûte des crédits. La seule branche Neon,
> `main`, est aussi la production Vercel : la vérification de bout en bout se
> fait sur une branche `dev` (décision D7, étape 9 du plan).

---

## 🗄️ Étape 1 : Préparation de la Base de Données

La base de données est hébergée sur **Neon (PostgreSQL cloud)**. Il n'est pas nécessaire de lancer de serveur de base de données localement.

### 1.1 Configurer les variables d'environnement
La liste complète et commentée est dans [`.env.example`](../../.env.example). Pour ce test :
* Dans `.env.local` (racine) : `DATABASE_URL` (pooler), `DIRECT_URL` (connexion directe), `NEXTAUTH_SECRET`, `FASTAPI_URL="http://localhost:8000"` et `INTERNAL_API_TOKEN`.
* Dans `backend/.env` : `DATABASE_URL`, `INTERNAL_API_TOKEN` (**la même valeur** que côté Next.js), `GEMINI_API_KEY`, et les clés Tavily (`TAVILY_API_KEYS="cle1,cle2"` ou `TAVILY_API_KEY_1` … `TAVILY_API_KEY_10`).
* Sur un réseau où le port 5432 est fermé (celui de l'établissement) : `DB_DRIVER=neon-ws` dans `.env.development.local` **et** dans `backend/.env`. Jamais sur Vercel.

> `INTERNAL_TOKEN` et `FASTAPI_INTERNAL_TOKEN` sont les anciens noms du jeton :
> encore acceptés, ils journalisent un avertissement.

### 1.2 Initialiser le compte administrateur (si nécessaire)
Le seed **n'a aucun mot de passe par défaut** : il lit `SEED_ADMIN_PASSWORD` et échoue si la variable est absente. Le mot de passe doit faire de 12 à 72 octets (`lib/password.ts`).
```powershell
$env:SEED_ADMIN_PASSWORD = "<un mot de passe fort>"; npx prisma db seed
```
L'identifiant créé est `admin`, ou la valeur de `SEED_ADMIN_USERNAME`. Changez ensuite le mot de passe depuis `/admin/users` si besoin, et retirez la variable de votre session.

---

## 🐍 Étape 2 : Lancer le Serveur Backend (FastAPI)

Le backend FastAPI porte la rotation des clés Tavily, la cascade Gemini du pipeline, les passes dues (sur demande) et le traitement des contributions (Gemma), seul job d'APScheduler.

### 2.1 Activer l'environnement virtuel Python
```powershell
.\backend\.venv\Scripts\Activate.ps1
```

### 2.2 Démarrer le backend avec Uvicorn
```bash
python -m uvicorn backend.main:app --port 8000 --reload
```
*`backend/main.py` charge `backend/.env` au démarrage. Uvicorn écoute sur `127.0.0.1` par défaut : ne passez jamais `--host 0.0.0.0` sur le réseau de l'établissement.*

> **Aucune recherche ne part seule.** Le cron `research_rotation` est supprimé :
> une passe de recherche ne part que si vous la demandez (recherche manuelle,
> étape 4.3, ou passes dues, étape 5). `ENVIRONMENT` et `CRON_RESEARCH_ENABLED`
> ne sont plus lues. Avant septembre 2026, démarrer le backend lançait 5 minutes
> plus tard une Phase 1 payante sur toutes les écoles sans campus.

> **Le traitement des contributions, lui, part dès le démarrage**, puis toutes
> les minutes. S'il trouve des tickets `Pending_AI`, il appelle Tavily
> (`extract`) et Gemma : des crédits réels, sans clic. **Regardez l'inbox avant
> de lancer le backend.** L'ancienne astuce `CRON_CROWDSOURCING_INTERVAL_MINUTES=1440`
> ne retarde plus le premier passage : elle n'espace que les suivants.

> **Un seul backend à la fois sur la base.** Au démarrage, `reap_orphaned_jobs`
> clôt en `failed` tout job actif ouvert par un autre processus. Deux backends
> s'interrompraient leurs passes, traiteraient deux fois les contributions et
> tiendraient deux comptabilités de crédits qui s'ignorent.

### 2.3 Vérifier le bon démarrage
* `http://127.0.0.1:8000/health` doit renvoyer `{"status":"ok","version":"0.5.0"}`.
* **`"status": "degraded"`** : le démarrage a échoué en partie, et `errors` dit
  où (base, reprise des jobs, clés Tavily, scheduler). Le journal porte les mêmes
  lignes en `ERROR`, et ne se termine pas par « ✅ Backend prêt ». Une base
  injoignable cite le pilote (`psycopg2 direct` ou `neon-ws`) et l'hôte ; sans
  `DB_DRIVER`, le message rappelle que le 5432 est fermé sur le réseau de
  l'établissement.

---

## 💻 Étape 3 : Lancer le Serveur Frontend (Next.js)

Le frontend Next.js héberge le dashboard d'administration et sert de proxy sécurisé pour communiquer avec le backend.

```bash
npm run dev
```
*Le serveur se lance sur `http://localhost:3000` (ou `3001` si le port est occupé).*

---

## 🧪 Étape 4 : Scénario de Test Manuel

### 4.1 Connexion à l'interface
1. Ouvrez `http://localhost:3000/admin/cron`.
2. Vous êtes redirigé vers `/admin/login` (307).
3. Connectez-vous avec le compte créé à l'étape 1.2. La connexion est plafonnée à 5 tentatives par IP toutes les 15 minutes.

### 4.2 Vérification des composants du tableau de bord

L'écran est décrit en entier dans
[`architecture.md`](../architecture/architecture.md) §7.4.

1. **État du backend local** : *prêt* (bandeau absent, pastille verte), *non lancé* (bandeau orange qui cite la commande de lancement ; l'écran voit le backend dès qu'il démarre, nouvel essai toutes les 5 s) ou *injoignable* (bandeau rouge, avec la raison : jeton absent ou refusé, délai…). Sur le site en ligne, sans backend : *pilotage depuis le poste local*. Les erreurs du démarrage (`startup_errors`) s'affichent en rouge ; « (dégradé) » suit l'état quand `pipeline-status` est `degraded`.
2. **Modèle IA Principal** : affiche `models/gemma-4-31b-it`. ⚠️ Cette valeur est **écrite en dur** dans `/internal/pipeline-status` et n'est plus exacte : le pipeline extrait par la cascade Gemini ; Gemma ne sert qu'au crowdsourcing.
3. **Quotas Tavily** : crédits restants par clé. Le compteur est local et estimé — Research ne déclare pas son coût, et `GET /usage` de Tavily n'est pas en temps réel.
4. **Tâches manuelles en cours** : les jobs `PipelineJob` actifs lancés à la main, avec leur progression.
5. **Passes dues** : mode (*sur demande*, ou *plafond à 0*), crédits du mois sur le plafond, état de la synchro `/usage`, les 5 premières passes dues, la dernière exécution réelle ; pour un ADMIN, les boutons **« Simuler »** et **« Lancer N passes dues »** (étape 5 ci-dessous).
6. **Passes dues en cours** : les passes en cours d'exécution (`source = "rotation"`, ou `"cron"` pour d'anciennes lignes).
7. **Recherche Manuelle** (ADMIN) : sélecteurs Phase / École / Programme / Catégories, et en Phase 1 la case **« collecte du rattachement campus »**, décochée par défaut.
8. **Historique du pipeline** : les 30 derniers jobs, lus en base, même backend arrêté ; l'erreur d'un job en échec (300 caractères, le texte entier au survol) ; au-dessus, le nombre de contributions `Pending_AI` qui attendent le backend.

> L'écran n'affiche pas le détail de `scheduler.last_runs` : un échec du
> traitement des contributions passe `pipeline-status` en `degraded` (« prêt
> (dégradé) »), sans dire lequel. Lisez `GET /internal/pipeline-status`
> directement (étape 5.1).

### 4.3 Tester le lancement d'une recherche manuelle
**Chaque lancement dépense des crédits réels** (bouton réservé au rôle ADMIN) :

| Lancement | Coût indicatif |
|---|---|
| Phase 1, case décochée | ~28-30 crédits Tavily (catalogue + Research pro) |
| Phase 1, case cochée | + ~15-17 crédits et 9 appels Gemini (collecte du rattachement) |
| Phase 2, une catégorie école en mini | ~10 crédits |

1. Sélectionnez **Phase 1** et une école. Laissez la case décochée sauf si vous testez le rattachement campus.
2. Cliquez sur **Lancer**.
3. **Résultat attendu** : toast de succès, la tâche apparaît dans « Tâches en cours ». Le résultat du job porte `campus_attachments: {"status": "disabled"}` si la case était décochée.
4. Si l'extraction Gemini échoue (503), le résultat porte `parked_report_ticket_id` : le rapport Research est rangé dans un ticket `Failed`, et relancer la même école le reprend sans repayer Research (`research_report_reused: true`).
5. Sur une école **déjà cartographiée**, la Phase 1 ne dépose un ticket que pour ce qui manque en base, noms réécrits à l'orthographe de la base, avec un bloc `diff_against_base`. Rien de nouveau → **aucun ticket**, résultat `no_new_discoveries: true` — Research a quand même été payé.

---

## 🧭 Étape 5 : Simuler les passes dues (`dry_run`)

La simulation remplace la **passe à blanc** de l'étape 7 de
[`cron-rotation-production.md`](../features/cron-rotation-production.md)
(plafond à 0, sur Koyeb, à l'heure dite). Elle lit l'état, planifie et rend le
plan, **sans créer de job, sans appeler Research ni `/usage`**. Fonctionnement
complet : [`architecture.md`](../architecture/architecture.md) §5.5.

**Depuis l'écran** (ADMIN, backend prêt) : panneau « Passes dues » de
`/admin/cron`, choisir le nombre de passes (1 à 5), puis **« Simuler »**. Le
message liste ce qui partirait (« Simulation : 2 passes partiraient — … »),
ou dit pourquoi rien ne partirait. La route Next
`POST /api/admin/run-due-passes` envoie `{"max_passes": N, "dry_run": true}`.

**Ou directement au backend**, avec le jeton interne posé dans la session
PowerShell (jamais collé dans un chat ni dans un fichier suivi) :

### 5.1 Lire l'état
```powershell
$h = @{ Authorization = "Bearer $env:INTERNAL_API_TOKEN" }
$s = Invoke-RestMethod "http://127.0.0.1:8000/internal/pipeline-status" -Headers $h
$s.startup_errors; $s.scheduler.rotation | ConvertTo-Json -Depth 6
```
Attendu : `startup_errors` vide ; dans `rotation`, `due_count`, les 5 premières
passes dues (`next`, chacune avec `reason` et `estimated_credits` — Phase 1 : 30 ;
Phase 2 : `45 + 25 × programmes + 10 × arêtes`), `monthly_ceiling`,
`month_credits_used`, `last_run` (`null` depuis le démarrage) et `usage_sync`
(`{ok, at, failed_keys}` une fois la synchro du démarrage terminée).

### 5.2 Simuler
```powershell
$body = '{"max_passes": 5, "dry_run": true}'
Invoke-RestMethod -Method Post "http://127.0.0.1:8000/internal/run-due-passes" `
  -Headers $h -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 6
```
**Résultat attendu** (200) : `dry_run: true`, `status: "success"`, `due_count`,
`planned` (au plus 5 passes, celles qui tiendraient sous le plafond, chacune
comptée à son estimation), `launched: []`, `detail` « simulation : … ». Au
journal :
```
🧪 [ROTATION] Simulation des passes dues
📋 [ROTATION] N passe(s) due(s) ; crédits du mois x/7000 ; en tête : <École>, Phase 1, ~30 crédits (never), …
```
`dry_run` est **exigé** et doit être un booléen : `{"max_passes": 5}` seul, ou
`"dry_run": "true"` entre guillemets, répondent 422 — une passe réelle ne part
jamais par défaut.

**Ce qui ne doit PAS arriver** : aucune ligne `🚀 [ROTATION]`, aucun nouveau
`PipelineJob` `source = 'rotation'` (le compter avant et après par le MCP Neon,
en `SELECT`), aucune consommation nouvelle sur le tableau de bord Tavily, hormis
ce que le crowdsourcing aurait traité (à vérifier dans l'inbox).

### 5.3 Passe réelle — avec l'accord du propriétaire seulement
`"dry_run": false` lance les passes : **des crédits réels** (Phase 1 : ~30 ;
Phase 2 : jusqu'à plusieurs centaines par école). À l'écran : **« Lancer N
passes dues »**, puis confirmer ; la confirmation donne un aperçu et le coût
estimé. Ce qui se passe :
1. synchro `/usage` bloquante de toutes les clés (20 s au plus). Une clé non
   recalée → **503 `USAGE_SYNC_FAILED`**, rien ne part ;
2. réponse **202** avec ce qui part (`status: "planned"`, `planned`) ; les
   passes tournent ensuite en arrière-plan ;
3. une seconde demande pendant ce temps → **409 `ALREADY_RUNNING`** ;
4. l'issue se lit dans `pipeline-status` : `rotation.last_run`, et les jobs en
   cours sous `cron_jobs`.

---

## 🛠️ Dépannage en cas de 500 ou d'erreur de connexion

* **`/health` en `degraded`, « Base de données : Connexion PostgreSQL impossible (pilote : psycopg2 direct, …) »** : le backend vise le port 5432, fermé sur le réseau de l'établissement. Posez `DB_DRIVER=neon-ws` dans `backend/.env` (pont WebSocket, port 443), puis relancez. Avec `neon-ws` déjà posée, lisez les avertissements du pont dans le journal.
* **« Database connection error » avec un réseau qui passe** : vérifiez que votre IP est autorisée dans les paramètres de sécurité du projet Neon.
* **« Backend local non lancé » alors qu'uvicorn tourne** : erreurs d'import dans la console FastAPI, port `8000` déjà pris par autre chose, ou `FASTAPI_URL` qui vise une autre adresse.
* **« Le backend refuse le jeton »** : `INTERNAL_API_TOKEN` n'a pas la même valeur dans `.env.local` et dans `backend/.env` (401). **« INTERNAL_API_TOKEN absente »** : `FASTAPI_URL` est posée dans `.env.local`, mais pas le jeton.
* **« Pilotage depuis le poste local » en local** : `FASTAPI_URL` est absente de `.env.local`, ou Next n'a pas été relancé après l'avoir posée.
* **« Le backend n'a pas répondu en 8 s »** alors qu'uvicorn tourne et que `/health` répond : `pipeline-status` est lent. Cause habituelle : la base répond lentement (réveil de Neon, ou 5432 fermé sans `DB_DRIVER=neon-ws`). L'écran réessaie toutes les 5 s.
* **« État de la rotation illisible »**, ou `rotation: {"error": …}` : la lecture en base du bloc `rotation` a échoué (message tronqué à 300 caractères) ; le reste de `pipeline-status` est servi normalement.
* **`last_runs.crowdsourcing_processor` en `failed`** : la file des contributions n'a pas pu être lue (base injoignable), ou le quota Tavily a interrompu le traitement. Le détail le dit ; `has_failure` passe `pipeline-status` en `degraded`.
