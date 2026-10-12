# ⚙️ Fiche de Test Manuel : Dashboard Admin & Monitoring Cron

Ce guide détaille les étapes nécessaires pour tester localement le tableau de bord de monitoring des tâches (`/admin/cron`), le serveur backend (FastAPI), le lancement de recherches manuelles, et la vérification **à blanc** de la rotation nocturne des recherches (étape 5).

> **Revu le 12 octobre 2026.** Aucun identifiant n'est écrit dans ce document :
> le compte admin est créé par le seed avec un mot de passe que vous fournissez.

---

## 🗄️ Étape 1 : Préparation de la Base de Données

La base de données est hébergée sur **Neon (PostgreSQL cloud)**. Il n'est pas nécessaire de lancer de serveur de base de données localement.

### 1.1 Configurer les variables d'environnement
La liste complète et commentée est dans [`.env.example`](../../.env.example). Pour ce test :
* Dans `.env.local` (racine) : `DATABASE_URL` (pooler), `DIRECT_URL` (connexion directe), `NEXTAUTH_SECRET`, `FASTAPI_URL="http://localhost:8000"` et `INTERNAL_API_TOKEN`.
* Dans `backend/.env` : `DATABASE_URL`, `INTERNAL_API_TOKEN` (**la même valeur** que côté Next.js), `GEMINI_API_KEY`, et les clés Tavily (`TAVILY_API_KEYS="cle1,cle2"` ou `TAVILY_API_KEY_1` … `TAVILY_API_KEY_10`).

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

Le backend FastAPI porte APScheduler, la rotation des clés Tavily, la cascade Gemini du pipeline et les appels Gemma du crowdsourcing.

### 2.1 Activer l'environnement virtuel Python
```powershell
.\backend\.venv\Scripts\Activate.ps1
```

### 2.2 Démarrer le backend avec Uvicorn
```bash
python -m uvicorn backend.main:app --port 8000 --reload
```
*`backend/main.py` charge `backend/.env` au démarrage.*

> **La rotation des recherches ne démarre pas en local.** Tant que `ENVIRONMENT`
> ne vaut pas `production`, `research_rotation` — le seul job qui paie Research
> de lui-même — n'est pas inscrit. Le log de démarrage le dit
> (« ⏸️ Rotation des recherches non inscrite — ENVIRONMENT=development : … »), et
> le panneau « Rotation automatique » affiche **inactive**. Avant septembre 2026,
> démarrer le backend lançait 5 minutes plus tard une Phase 1 payante sur toutes
> les écoles sans campus. **Ne posez jamais `ENVIRONMENT=production` sur un poste
> de développement, ni `CRON_RESEARCH_ENABLED=true` sans
> `CRON_MONTHLY_CREDIT_CEILING=0`** : la rotation lancerait une vraie passe à
> l'heure dite.

> **Le crowdsourcing, lui, tourne toutes les minutes**, en local comme en
> production. S'il trouve des tickets `Pending_AI`, il appelle Tavily (`extract`)
> et Gemma : des crédits réels, sans clic. Regardez l'inbox avant de lancer le
> backend. Pour l'écarter le temps d'un test, `CRON_CROWDSOURCING_INTERVAL_MINUTES=1440`
> repousse son premier passage à 24 h (un `IntervalTrigger` part à démarrage +
> intervalle).

> **Un seul backend à la fois sur la base.** Au démarrage, `reap_orphaned_jobs`
> clôt en `failed` tout job actif ouvert par un autre processus. Un backend local
> lancé pendant qu'un backend de production travaille interromprait donc ses
> passes, et les deux traiteraient le crowdsourcing.

### 2.3 Vérifier le bon démarrage
* `http://127.0.0.1:8000/health` doit renvoyer `{"status":"ok","version":"0.5.0"}`.

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
1. **Statut Backend** : pastille verte **Opérationnel**. Si le backend est arrêté, un bandeau de reconnexion automatique s'affiche avec compte à rebours.
2. **Modèle IA Principal** : affiche `models/gemma-4-31b-it`. ⚠️ Cette valeur est **écrite en dur** dans `/internal/pipeline-status` et n'est plus exacte : le pipeline extrait par la cascade Gemini ; Gemma ne sert qu'au crowdsourcing.
3. **Quotas Tavily** : crédits restants par clé. Le compteur est local et estimé — Research ne déclare pas son coût, et `GET /usage` de Tavily n'est pas en temps réel.
4. **Tâches en cours** : les jobs `PipelineJob` actifs, avec leur progression.
5. **Rotation automatique** (sous les quotas Tavily) : badge **inactive** en local, avec la raison tirée de `research_cron` ; crédits du mois (estimés) sur le plafond ; prochaines passes dues avec leur coût estimé ; dernière nuit. Le détail du bloc est dans [`architecture.md`](../architecture/architecture.md) §2.3 et §5.5.
6. **Tâches automatiques (Cron)** : les passes de la rotation en cours. Vide hors production.
7. **Recherche Manuelle** : sélecteurs Phase / École / Programme / Catégories, et en Phase 1 la case **« collecte du rattachement campus »**, décochée par défaut.

> L'écran n'affiche pas `scheduler.last_runs` ni `has_failure` : un échec du
> traitement Crowdsourcing ne s'y voit pas. La dernière nuit de la rotation, elle,
> est dans le panneau. Lisez `GET /internal/pipeline-status` directement pour le
> reste.

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

## 🌙 Étape 5 : Vérifier la rotation à blanc (`CRON_MONTHLY_CREDIT_CEILING=0`)

C'est la **passe à blanc** de l'étape 7 de
[`cron-rotation-production.md`](../features/cron-rotation-production.md), à
faire avant toute mise en ligne. Avec un plafond à 0, aucune estimation ne tient :
le job lit l'état, planifie, journalise le plan et **ne lance aucune passe**.
Fonctionnement complet : [`architecture.md`](../architecture/architecture.md) §5.5.

> ### ⛔ Point bloquant : pas depuis le poste de développement tant que Neon refuse le 5432
>
> Depuis le poste du propriétaire, Neon refuse souvent le port **5432** :
> `psycopg2` dépasse son délai (45 s par tentative) — ce fut le cas **toute la
> journée du 29 septembre 2026**. Le backend local ne lit alors pas la base :
> le job ne peut pas planifier, et `GET /internal/pipeline-status` dépasse le
> délai de **4 s** de la route Next, si bien que `/admin/cron` affiche le
> backend « Indisponible » alors qu'il tourne. Next, lui, fonctionne : il passe
> par WebSocket sur le port 443. **Un `npm run dev` qui marche ne prouve donc
> pas que le backend joint la base.**
>
> La passe à blanc se prévoit donc **sur Koyeb** (§5.1), ou **en local un jour
> où `psycopg2` passe** (§5.2) — à vérifier avant d'y consacrer une heure.

> ⚠️ **Contrôlez le plafond au log de démarrage, toujours.** Une valeur illisible
> de `CRON_MONTHLY_CREDIT_CEILING` (`O` au lieu de `0`, espace, guillemets mal
> fermés…) **retombe sur le défaut, 7 000**, avec un simple avertissement : la
> rotation lancerait une vraie passe. La ligne attendue :
> `✅ Scheduler démarré (…): Rotation(15h Europe/Paris, 1 passe(s) par nuit, plafond 0 crédits/mois), Crowdsourcing(1m)`.
> Si elle ne dit pas `plafond 0`, **arrêtez le backend avant l'heure dite**.

### 5.1 Sur Koyeb (recommandé)

1. Sur le service du backend, poser **dans la même modification** (chaque
   changement de variable redéploie, donc redémarre l'instance) :
   - `ENVIRONMENT=production` ;
   - `CRON_MONTHLY_CREDIT_CEILING=0` ;
   - `CRON_RESEARCH_HOUR` = **l'heure suivante**, heure de Paris (à 14 h 20,
     `15`). L'instance doit avoir redémarré **avant** cette heure : un démarrage
     après l'heure renvoie le premier passage au lendemain, sans rattrapage.
2. Après le redéploiement, lire les journaux du service : la ligne
   `✅ Scheduler démarré (ENVIRONMENT=production): Rotation(… plafond 0 crédits/mois) …`.
3. Lire l'état, de l'une de ces deux façons :
   - directement, avec le jeton interne du backend de production :
     ```powershell
     $h = @{ Authorization = "Bearer $env:INTERNAL_API_TOKEN" }
     (Invoke-RestMethod "https://<backend-koyeb>/internal/pipeline-status" -Headers $h).scheduler | ConvertTo-Json -Depth 6
     ```
   - ou par `/admin/cron` d'un Next local dont `.env.local` pointe sur Koyeb
     (`FASTAPI_URL` et `INTERNAL_API_TOKEN` de production). **Les boutons de
     lancement visent alors la production : n'en touchez aucun.**
4. Noter, avant l'heure dite, la consommation affichée sur le tableau de bord
   Tavily.

Ne lancez pas de backend local pendant ce temps (voir l'étape 2.2 : chacun
clôt les jobs actifs de l'autre).

### 5.2 En local, un jour où `psycopg2` passe

1. **Vérifier d'abord la base.** Lancer le backend normalement (étape 2), ouvrir
   `/admin/cron` : la pastille doit être **Opérationnel** et le panneau
   « Rotation automatique » rempli, sans « État de la rotation illisible ». Si
   la page affiche « Indisponible », ou si
   `GET http://127.0.0.1:8000/internal/pipeline-status` met plus de 4 s ou porte
   `"database": "disconnected"`, le 5432 est fermé : arrêtez ici.
2. Regarder l'inbox : des tickets `Pending_AI` seront traités par le
   crowdsourcing, à vos frais (voir l'étape 2.2 pour l'écarter).
3. Arrêter le backend, puis le relancer **sans `--reload`** (un rechargement
   après l'heure dite la ferait sauter), variables posées dans la session — elles
   l'emportent sur `backend/.env`, que `load_dotenv` ne laisse pas les écraser :
   ```powershell
   $env:CRON_MONTHLY_CREDIT_CEILING = "0"
   $env:CRON_RESEARCH_ENABLED = "true"
   $env:CRON_RESEARCH_HOUR = "15"    # l'heure suivante, heure de Paris
   python -m uvicorn backend.main:app --port 8000
   ```
4. Contrôler la ligne `plafond 0 crédits/mois` au démarrage (encadré ci-dessus).
5. Après la vérification, fermer la session PowerShell, ou retirer les trois
   variables (`Remove-Item Env:CRON_RESEARCH_ENABLED`, etc.).

### 5.3 Résultat attendu

**Avant l'heure dite**, dans `scheduler` (ou le panneau) :
- `research_cron` : `{"enabled": true, "reason": "ENVIRONMENT=production"}` (ou
  `CRON_RESEARCH_ENABLED=true` en local) ;
- dans `jobs`, `research_rotation` avec `next_run` à l'heure dite, aujourd'hui ;
- `rotation.enabled: true`, `monthly_ceiling: 0`, `hour` réglé ; le panneau
  porte le badge **à blanc** et « À blanc — plafond à 0 : la rotation planifie et
  journalise sans rien dépenser (…) » ;
- `rotation.next` : les premières passes dues, chacune avec `reason` et
  `estimated_credits` (Phase 1 : 30 ; Phase 2 : `45 + 25 × programmes + 10 ×
  arêtes`) ; `due_count` : leur nombre. Au premier déploiement, toutes les
  écoles sont « Jamais passée » : la mémoire des passages n'existait pas ;
- `rotation.last_night: null` (« Aucune nuit depuis le démarrage du backend »).

**À l'heure dite**, dans les journaux :
```
⏰ [ROTATION] research_rotation démarré
📋 [ROTATION] N passe(s) due(s) ; crédits du mois x/0 ; en tête : <École>, Phase 1, ~30 crédits (never), …
⏸️ [ROTATION] plafond mensuel atteint : x/0 crédits, N passe(s) en attente, la moins chère ~M crédits
```
puis `rotation.last_night` : `status: "success"`, `detail` « plafond mensuel
atteint : … ». `x` est la consommation estimée du mois, pas forcément 0 : le
gestionnaire de clés se recale sur Tavily (`/usage`) après le démarrage.

**Ce qui ne doit PAS arriver** : aucune ligne `🚀 [ROTATION]`, aucune tâche dans
« Tâches automatiques (Cron) », aucun nouveau `PipelineJob` `source = 'cron'`,
aucune consommation nouvelle sur le tableau de bord Tavily, hormis ce que le
crowdsourcing aurait traité (à vérifier dans l'inbox). La moindre ligne
`🚀 [ROTATION]` : arrêtez le backend et relisez le plafond.

**Rien à l'heure dite** : regarder `next_run` de `research_rotation`. Au
lendemain, l'instance a démarré après l'heure ; absent de `jobs`, le job n'est
pas inscrit (`research_cron.reason`). Une instance mise en veille ou
redémarrée à ce moment ne lance rien non plus.

### 5.4 Après la vérification

Laisser `CRON_MONTHLY_CREDIT_CEILING=0` tant que le propriétaire n'a pas fixé la
première passe réelle (étape 7 du plan : une seule école, plafond juste
au-dessus de son estimation, coût relevé sur le tableau de bord Tavily). Ou
couper la rotation (`CRON_RESEARCH_ENABLED=false`, ou retirer
`ENVIRONMENT=production` — qui rouvre alors `/docs` en production). Remettre
`CRON_RESEARCH_HOUR` à 3, ou le retirer.

---

## 🛠️ Dépannage en cas de 500 ou d'erreur de connexion

* **`P1001` ou « connection refused » côté backend, alors que Next.js marche** : le backend se connecte en **psycopg2 sur le port 5432**, Next.js en **WebSocket sur le port 443** (`@neondatabase/serverless`). Certains réseaux — dont celui du poste de développement — coupent le protocole Postgres sur 5432 : `npm run dev` fonctionne, le backend et la CLI Prisma non. Changez de réseau (partage de connexion).
* **« Database connection error » avec un réseau qui passe** : vérifiez que votre IP est autorisée dans les paramètres de sécurité du projet Neon.
* **Le statut du backend reste « Indisponible »** : erreurs d'import dans la console FastAPI, port `8000` déjà pris, ou `INTERNAL_API_TOKEN` différent des deux côtés (401).
* **« Indisponible » alors qu'uvicorn tourne et que `/health` répond** : `pipeline-status` met plus de 4 s, la route Next abandonne et renvoie 503. Cause habituelle : `psycopg2` attend Neon sur le 5432 (voir le premier point et l'étape 5).
* **« État de la rotation illisible » dans le panneau** : la lecture en base du bloc `rotation` a échoué (message tronqué à 300 caractères) ; le reste de `pipeline-status` est servi normalement.
