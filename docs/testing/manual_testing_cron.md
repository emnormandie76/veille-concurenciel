# ⚙️ Fiche de Test Manuel : Dashboard Admin & Monitoring Cron

Ce guide détaille les étapes nécessaires pour tester localement le tableau de bord de monitoring des tâches (`/admin/cron`), le serveur backend (FastAPI), et le lancement de recherches manuelles.

> **Revu le 28 septembre 2026.** Aucun identifiant n'est écrit dans ce document :
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

> **Le cron Research ne démarre pas en local.** Tant que `ENVIRONMENT` ne vaut
> pas `production`, `phase1_scanner` et `phase2_enricher` ne sont pas inscrits : le
> log de démarrage le dit (« Jobs Research non inscrits »). Avant septembre 2026,
> démarrer le backend lançait 5 minutes plus tard une Phase 1 payante sur toutes
> les écoles sans campus. **Ne posez pas `ENVIRONMENT=production` ni
> `CRON_RESEARCH_ENABLED=true` sur un poste de développement.** Le traitement du
> crowdsourcing, lui, tourne toutes les minutes.

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
5. **Recherche Manuelle** : sélecteurs Phase / École / Programme / Catégories, et en Phase 1 la case **« collecte du rattachement campus »**, décochée par défaut.

> L'écran n'affiche pas encore `scheduler.last_runs`, `has_failure` ni
> `research_cron` : un cron en échec, ou désactivé hors production, ne s'y voit
> pas. Lisez `GET /internal/pipeline-status` directement pour les contrôler.

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

---

## 🛠️ Dépannage en cas de 500 ou d'erreur de connexion

* **`P1001` ou « connection refused » côté backend, alors que Next.js marche** : le backend se connecte en **psycopg2 sur le port 5432**, Next.js en **WebSocket sur le port 443** (`@neondatabase/serverless`). Certains réseaux — dont celui du poste de développement — coupent le protocole Postgres sur 5432 : `npm run dev` fonctionne, le backend et la CLI Prisma non. Changez de réseau (partage de connexion).
* **« Database connection error » avec un réseau qui passe** : vérifiez que votre IP est autorisée dans les paramètres de sécurité du projet Neon.
* **Le statut du backend reste « Indisponible »** : erreurs d'import dans la console FastAPI, port `8000` déjà pris, ou `INTERNAL_API_TOKEN` différent des deux côtés (401).
