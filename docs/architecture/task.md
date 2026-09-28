# Task List — School Data Pipeline

> **Contexte :** Lire `architecture.md`, `bdd.md`, `cahier-des-charges-school-pipeline.md`, `edgecase.md`, `API-rest.md`,`gemma-python-guide.md` avant de commencer.
> **Règle absolue :** Ne JAMAIS passer à l'étape suivante sans avoir validé TOUS les tests de l'étape courante.

> ## ⚠️ Statut au 28 septembre 2026 — plan de construction initial, terminé
>
> Les étapes 0 à 11 sont toutes réalisées ; ce fichier est l'**historique** de la
> construction, pas une description du système actuel. **La référence est
> [`architecture.md`](architecture.md).** Plusieurs mécanismes décrits ici ont été
> remplacés depuis :
>
> | Ici | Aujourd'hui |
> |---|---|
> | Étape 5 — Tavily `crawl` + extraction Gemma 31B | Ancrage catalogue + Tavily **Research** (pro), rapport structuré par la **cascade Gemini** ; rapport rangé si l'extraction échoue |
> | Étape 5 — `CronTarget`, blacklist après 3 échecs | Table supprimée ; suivi par `PipelineJob` ; pas de blacklist |
> | Étape 6 — `PIPELINE_STRATEGIES`, tri Gemma 26B, `search` | Research par catégorie (pro ou mini) + Gemini. `PIPELINE_STRATEGIES` ne sert plus qu'au crowdsourcing |
> | Étape 1 — `middleware.ts` | `proxy.ts` (Next.js 16) |
> | Étape 1 — admin par défaut au seed | `SEED_ADMIN_PASSWORD` obligatoire, aucun mot de passe par défaut |
> | Étape 4 — rotation de clé à 950 crédits | rotation à `credits_limit − 10` |
> | Étape 7 — fact-checking Gemma 26B | contrôle de **compatibilité** Gemma 26B, puis extraction 31B |
> | Étapes 8-9 — cache ISR | déclaré mais **inopérant** sur l'API v1 (voir `API-rest.md`) |
> | Étape 11 — CronTargets dans `/admin/cron` | jobs `PipelineJob`, recherche ciblée, case « collecte campus » |
> | `APScheduler` toujours actif | jobs Research inscrits **seulement en production** |
>
> **Fonctions de ce plan retirées depuis**, n'étant plus appelées nulle part :
> `is_content_relevant` et `fact_check` (`ai/gemma_client.py`), puis
> `crawl_school_website` (`tavily_service/client.py`) le 28 septembre 2026. Les
> étapes 5 et 6 ci-dessous les citent comme elles existaient alors.
>
> **Chantiers postérieurs** (voir `docs/features/`) : remédiation de l'audit
> technique (sécurité, CI, énumérations, `PipelineJob`) ; pipeline Research
> (`research-pipeline-plan.md`) ; rattachement campus année par année
> (`architecture.md` §5.4).

---

## Étape 0 : Initialisation du Projet

### 0.1 — Scaffolding Next.js
- [x] Initialiser un projet Next.js (App Router, TypeScript) dans le dossier racine
- [x] Installer les dépendances : `prisma`, `@prisma/client`, `next-auth`, `bcrypt`
- [x] Créer le fichier `.env.local`

> **Liste obsolète.** La liste complète et commentée des variables — Next.js et
> FastAPI — vit désormais dans [`.env.example`](../../.env.example) à la racine.
> Elle compte une vingtaine d'entrées, contre quatre ici.
>
> Deux changements notables :
> - `FASTAPI_INTERNAL_TOKEN` est remplacé par **`INTERNAL_API_TOKEN`**, nom
>   canonique des deux côtés de la frontière (l'ancien reste accepté).
> - `DIRECT_URL` est **obligatoire** : `DATABASE_URL` pointe le pooler Neon, qui
>   ne supporte pas les migrations.
- [x] Configurer le `tsconfig.json` avec les alias `@/`

### 0.2 — Scaffolding FastAPI
- [x] Créer un dossier `backend/` à la racine
- [x] Initialiser un projet Python avec `requirements.txt` : `fastapi`, `uvicorn`, `psycopg2-binary`, `apscheduler`, `tavily-python`, `google-genai`, `bcrypt`
- [x] Créer `backend/main.py` avec un endpoint `/health` retournant `{"status": "ok"}`
- [x] Créer `backend/.env` — voir [`.env.example`](../../.env.example), section FastAPI

> Au-delà de `DATABASE_URL`, `GEMINI_API_KEY`, `TAVILY_API_KEYS` et
> `INTERNAL_API_TOKEN`, deux variables sont **requises en production** :
> `ENVIRONMENT=production` (sans elle `/docs`, `/redoc` et `/openapi.json`
> restent ouverts) et `ALLOWED_ORIGINS`.

### ✅ Tests Étape 0
```
- [x] `npm run dev` démarre Next.js sans erreur sur http://localhost:3000
- [x] `uvicorn backend.main:app --reload` démarre FastAPI sans erreur
- [x] GET http://localhost:8000/health retourne {"status": "ok"}
```

---

## Étape 1 : Base de Données et Authentification

### 1.1 — Prisma Schema
- [x] Créer `prisma/schema.prisma` avec TOUS les modèles définis dans `bdd.md` : `User`, `School`, `Campus`, `Program`, `PricingRecord`, `CapacityRecord`, `RankingRecord`, `SchoolStatsRecord`, `AccreditationRecord`, `ContributionInbox`
- [x] Exécuter `npx prisma migrate dev --name init` — migration réussie
- [x] Exécuter `npx prisma generate` — client généré

### 1.2 — Script de Seed (Premier Admin)
- [x] Créer `prisma/seed.ts` qui insère un User Admin par défaut (username: `admin`, password hashé avec bcrypt, role: `ADMIN`)
- [x] Configurer `package.json` pour `npx prisma db seed`

### 1.3 — NextAuth Configuration
- [x] Configurer NextAuth avec Credentials Provider dans `app/api/auth/[...nextauth]/route.ts`
- [x] Vérifier le username/password contre la table `User` (bcrypt compare)
- [x] Inclure `role` dans le token JWT et la session
- [x] Créer un middleware `middleware.ts` protégeant toutes les routes `/admin/*` (sauf `/admin/login`)

### ✅ Tests Étape 1
```
- [x] La migration crée toutes les tables dans Neon (vérifier via Prisma Studio : `npx prisma studio`)
- [x] Le seed crée le compte admin en BDD
- [x] POST /api/auth/signin avec les bons identifiants retourne un token valide
- [x] POST /api/auth/signin avec de mauvais identifiants retourne une erreur
- [x] Accéder à /admin/inbox sans session redirige vers /admin/login
- [x] Accéder à /admin/inbox avec session valide affiche la page
```

---

## Étape 2 : Dashboard Admin — CRUD Écoles et Campus

### 2.1 — API Routes Admin (Next.js)
- [x] `GET /api/admin/schools` — Liste toutes les écoles
- [x] `POST /api/admin/schools` — Créer une école (name + official_domain)
- [x] `PUT /api/admin/schools/[id]` — Modifier une école
- [x] `DELETE /api/admin/schools/[id]` — Supprimer une école (vérifier le token de double confirmation)
- [x] `GET /api/admin/schools/[id]/campuses` — Liste les campus d'une école
- [x] `POST /api/admin/schools/[id]/campuses` — Créer un campus
- [x] `PUT /api/admin/campuses/[id]` — Modifier un campus
- [x] `DELETE /api/admin/campuses/[id]` — Supprimer un campus

### 2.2 — Pages Admin
- [x] Page `/admin/schools` — Tableau listant les écoles avec boutons Ajouter/Modifier/Supprimer
- [x] Modale de création/édition d'école (champs: name, official_domain)
- [x] Modale de suppression avec **double confirmation** ("Tapez le nom de l'école pour confirmer")
- [x] Page `/admin/schools/[id]/campuses` — Gestion des campus de l'école

### 2.3 — Gestion des Modérateurs (Admin uniquement)
- [x] Page `/admin/users` — Liste des modérateurs (visible uniquement si role=ADMIN)
- [x] `POST /api/admin/users` — Créer un modérateur (username + password)
- [x] `DELETE /api/admin/users/[id]` — Supprimer un modérateur
- [x] Interdire la suppression de son propre compte
- [x] Interdire l'accès à cette page pour les Modérateurs (role check)

### ✅ Tests Étape 2
```
- [x] Créer une école "EMLV" avec domaine "emlv.fr" → apparaît dans la liste
- [x] Créer un campus "Paris La Défense" pour EMLV → apparaît dans la liste campus
- [x] Modifier le nom du campus → changement persisté en BDD
- [x] Supprimer le campus → disparaît de la liste
- [x] Supprimer l'école avec double confirmation → école et campus supprimés (cascade)
- [x] Créer un modérateur → peut se connecter et accéder au dashboard
- [x] Le modérateur ne voit PAS la page /admin/users
- [x] L'admin voit et peut gérer la page /admin/users
```

---

## Étape 3 : Dashboard Admin — ContributionInbox

### 3.1 — API Routes Inbox
- [x] `GET /api/admin/inbox` — Liste les tickets (filtres: status, ai_category, schoolId) avec pagination
- [x] `GET /api/admin/inbox/[id]` — Détail d'un ticket
- [x] `PUT /api/admin/inbox/[id]/validate` — Valider un ticket (transfère les données vers les tables rigides via upsert Prisma)
- [x] `PUT /api/admin/inbox/[id]/reject` — Rejeter un ticket

### 3.2 — Validation Program_Discovery (Super Ticket)
- [x] Quand `ai_category = "Program_Discovery"` : le frontend génère un formulaire répéteur pré-rempli avec les campus et programmes du JSON
- [x] L'Admin peut modifier/supprimer/ajouter des campus et programmes dans le formulaire
- [x] Au clic "Valider" : transaction Prisma qui crée les Campus + Programs en une passe atomique
- [x] En cas d'erreur : rollback complet, message d'erreur affiché

### 3.3 — Validation des données (Pricing, Ranking, etc.)
- [x] Quand `ai_category = "Pricing"` : formulaire pré-rempli avec les champs de PricingRecord
- [x] Idem pour Ranking, Capacity, SchoolStats, Accreditation
- [x] Au clic "Valider" : upsert Prisma dans la table rigide correspondante
- [x] Les flags `year_assumed`, `data_conflict_warning`, `program_name_mismatch` sont affichés comme alertes visuelles

### ✅ Tests Étape 3
```
- [x] Insérer manuellement un ticket Program_Discovery en BDD → il apparaît dans l'inbox
- [x] Ouvrir le ticket → formulaire pré-rempli avec campus/programmes du JSON
- [x] Modifier un nom de programme, valider → Campus et Program créés en BDD avec le nom modifié
- [x] Insérer un ticket Pricing → formulaire pré-rempli avec les champs tarifs
- [x] Valider le ticket Pricing → PricingRecord créé/mis à jour en BDD
- [x] Rejeter un ticket → status passe à "Rejected", pas de données en production
- [x] Ticket avec year_assumed=true → badge d'alerte visible dans l'interface
- [x] Ticket avec data_conflict_warning=true → badge d'alerte visible
```

---

## Étape 4 : Backend FastAPI — Core et API Interne

### 4.1 — Connexion DB
- [x] Configurer la connexion PostgreSQL (psycopg2 ou SQLAlchemy) avec `DATABASE_URL`
- [x] Créer un module `backend/db.py` avec un pool de connexions

### 4.2 — API Interne (sécurisée)
- [x] Middleware de vérification du token (`Authorization: Bearer {INTERNAL_TOKEN}`)
- [x] `POST /internal/trigger-scan/{school_id}` — Déclenche Phase 1 pour une école
- [x] `POST /internal/trigger-enrichment/{school_id}` — Déclenche Phase 2 pour une école
- [x] `GET /internal/pipeline-status` — Retourne l'état du pipeline (crédits restants, tâches en cours)

### 4.3 — Key Cycling Tavily
- [x] Implémenter `TavilyKeyManager` (voir architecture.md section 4.3)
- [x] Rotation automatique quand une clé atteint 950 crédits
- [x] Exception `QuotaExhaustedError` si toutes les clés sont épuisées

### 4.4 — Module Gemma
- [x] Reprendre et adapter `call_gemma_with_retry` depuis `gemma-python-guide.md` (template production)
- [x] Intégrer : retry backoff, nettoyage JSON, validation des clés, gestion finish_reason
- [x] Créer `clean_gemma_json()` et `validate_json_structure()`

### ✅ Tests Étape 4
```
- [x] FastAPI démarre et se connecte à la BDD Neon sans erreur
- [x] GET /internal/pipeline-status sans token → 401 Unauthorized
- [x] GET /internal/pipeline-status avec token → 200 + JSON status
- [x] TavilyKeyManager avec 2 clés : la première est utilisée, puis bascule à la seconde après 950
- [x] TavilyKeyManager avec toutes les clés épuisées → lève QuotaExhaustedError
- [x] call_gemma_with_retry avec un prompt simple → retourne un dict JSON valide
- [x] call_gemma_with_retry avec un JSON invalide simulé → retry puis retourne None après max_retries
```

---

## Étape 5 : Pipeline Phase 1 — Cartographie (Program Discovery)

### 5.1 — Module Tavily Crawl
- [x] Fonction `crawl_school_website(official_domain: str) -> str` qui appelle Tavily crawl avec `select_paths` et `instructions` appropriés
- [x] Gestion du timeout (15s) et des réponses vides (Edge Case 14)

### 5.2 — Extraction Phase 1
- [x] Fonction `extract_programs(raw_content: str) -> dict | None` qui envoie le contenu à Gemma 31B avec le prompt Phase 1 (voir architecture.md section 5.1)
- [x] Validation du JSON retourné (clés obligatoires: `discovered_campuses`)

### 5.3 — Orchestrateur Phase 1
- [x] Fonction `run_phase1(school_id: str)` :
  1. Lire l'école en BDD
  2. Vérifier CronTarget (pas blacklisté)
  3. Appeler `crawl_school_website`
  4. Appeler `extract_programs`
  5. Insérer dans ContributionInbox (category=Program_Discovery, status=Pending_Admin)
  6. En cas d'échec : incrémenter `failed_attempts_count` dans CronTarget

### 5.4 — Intégration APScheduler
- [x] Job `phase1_scanner` : toutes les `CRON_PHASE1_INTERVAL_HOURS` heures, lire les écoles ACTIVE sans Campus et lancer `run_phase1` pour chacune
- [x] Respecter les rate limits (max 1 école traitée à la fois, pause entre chaque)

### ✅ Tests Étape 5
```
- [x] crawl_school_website("emlv.fr") retourne du contenu Markdown non vide (test réel API)
- [x] extract_programs avec un contenu Markdown réel → JSON avec discovered_campuses non vide
- [x] run_phase1 pour une école sans campus → ticket Program_Discovery créé dans ContributionInbox
- [x] run_phase1 pour une école déjà blacklistée → skip (pas d'appel API)
- [x] Après 3 échecs consécutifs → CronTarget.is_blacklisted = true
- [x] Le scheduler lance bien phase1_scanner à l'intervalle configuré
```

---

## Étape 6 : Pipeline Phase 2 — Enrichissement

### 6.1 — Routeur Dynamique (Strategy Pattern)
- [x] Implémenter le dictionnaire `PIPELINE_STRATEGIES` (voir architecture.md section 4.2)
- [x] Chaque stratégie contient : config Tavily, modèle Gemma, clés JSON requises, prompt

### 6.2 — Module de Diff
- [x] Fonction `has_data_changed(new_data: dict, existing_record: dict) -> bool` qui compare le JSON extrait avec les données de production
- [x] Si rien n'a changé → retourner False (Edge Case 10)

### 6.3 — Tri rapide (Gemma 26B)
- [x] Fonction `is_content_relevant(raw_content: str, category: str) -> bool` via Gemma 26B
- [x] Détection des paywalls/cookies (Edge Case 11)

### 6.4 — Orchestrateur Phase 2
- [x] Fonction `run_phase2(school_id: str)` :
  1. Lire tous les Programs validés de l'école
  2. Pour chaque (Program, Catégorie) non blacklisté :
     - Charger la stratégie
     - Tavily search avec les bons paramètres
     - Tri rapide Gemma 26B → skip si non pertinent
     - Extraction Gemma 31B
     - Diff vs production → skip si identique
     - Insérer dans ContributionInbox

### 6.5 — Intégration APScheduler
- [x] Job `phase2_enricher` : toutes les `CRON_PHASE2_INTERVAL_HOURS` heures

### ✅ Tests Étape 6
```
- [x] PIPELINE_STRATEGIES["Pricing"] retourne la bonne config avec les bons include_domains
- [x] has_data_changed avec données identiques → False
- [x] has_data_changed avec prix modifié → True
- [x] is_content_relevant avec un texte de tarifs → True
- [x] is_content_relevant avec un texte de cookies/paywall → False
- [x] run_phase2 pour une école avec programmes validés → tickets Pricing/Ranking créés dans l'Inbox
- [x] run_phase2 quand les données n'ont pas changé → aucun ticket créé (skip silencieux)
- [x] run_phase2 pour un programme blacklisté → skip
```

---

## Étape 7 : Workflow A — Crowdsourcing

### 7.1 — Page publique `/contribute`
- [x] Dropdown École avec autocomplete (données depuis `GET /api/schools`)
- [x] Dropdown Campus (chargé dynamiquement selon l'école sélectionnée) — optionnel
- [x] Dropdown Programme (chargé dynamiquement selon le campus) — optionnel
- [x] Multi-select catégories : Tarifs, Classement, Capacité, Stats école, Accréditation
- [x] Champ texte libre (revendication)
- [x] Champ URL(s) source(s)
- [x] Bouton Soumettre

### 7.2 — API Route de soumission
- [x] `POST /api/contribute` — Crée 1 ticket Inbox par catégorie sélectionnée
- [x] Rate limiting par IP (middleware Vercel ou custom)
- [x] Validation : URL format `https://`, école existante, au moins 1 catégorie

### 7.3 — Traitement Backend (FastAPI)
- [x] Endpoint ou job qui traite les tickets `Pending_AI` de type `User_Submission` :
  1. Tavily extract(urls) pour récupérer le contenu
  2. Gemma 26B : fact-checking (le texte confirme-t-il la revendication ?)
  3. Gemma 31B : extraction JSON selon la catégorie
  4. Mise à jour status → Pending_Admin

### ✅ Tests Étape 7
```
- [x] La page /contribute affiche le formulaire avec les dropdowns
- [x] Sélectionner EMLV → les campus EMLV apparaissent
- [x] Sélectionner un campus → les programmes apparaissent
- [x] Soumettre avec 2 catégories cochées → 2 tickets créés dans l'Inbox
- [x] Soumettre sans école → erreur de validation
- [x] Soumettre sans URL → erreur de validation
- [x] Le traitement backend extrait le contenu et met à jour le status à Pending_Admin
- [x] 10 soumissions rapides depuis la même IP → rate limit déclenché
```

---

## Étape 8 : Frontend Public — Consultation

### 8.1 — Pages publiques
- [x] Page `/` — Accueil avec recherche d'écoles (liste des écoles ACTIVE)
- [x] Page `/schools/[id]` — Fiche école (infos, campus, stats, accréditations)
- [x] Page `/schools/[id]/programs/[pid]` — Détail programme (tarifs, classements, capacité)

### 8.2 — API Routes publiques (utilisées par le frontend)
- [x] `GET /api/schools` — Écoles actives avec recherche/pagination
- [x] `GET /api/schools/[id]` — Détail école + relations
- [x] `GET /api/schools/[id]/programs/[pid]` — Détail programme + records

### 8.3 — Caching ISR
- [x] `export const revalidate = 3600` sur toutes les pages publiques

### ✅ Tests Étape 8
```
- [x] La page d'accueil affiche la liste des écoles actives
- [x] Cliquer sur une école → fiche avec campus, stats, accréditations
- [x] Cliquer sur un programme → tarifs par année, classements, capacité
- [x] Les écoles avec status != ACTIVE ne sont PAS affichées
- [x] Deux requêtes consécutives sur la même page → la 2ème est servie depuis le cache (vérifier via headers)
```

---

## Étape 9 : API REST Publique (v1)

> **Réf. détaillée : `API-rest.md`**

### 9.1 — Schools (4 endpoints)
- [x] `GET /api/v1/schools` — Liste paginée des écoles actives (`?search=emlv&page=1&limit=20`)
- [x] `GET /api/v1/schools/[id]` — Détail d'une école (infos de base)
- [x] `GET /api/v1/schools/[id]/stats` — Stats de l'école (`?year=2025`, dernier par défaut)
- [x] `GET /api/v1/schools/[id]/accreditations` — Accréditations (EQUIS, AACSB…)

### 9.2 — Campuses (2 endpoints)
- [x] `GET /api/v1/schools/[id]/campuses` — Liste des campus d'une école
- [x] `GET /api/v1/campuses/[id]` — Détail d'un campus + ses programmes

### 9.3 — Programs (3 endpoints)
- [x] `GET /api/v1/schools/[id]/programs` — Programmes de l'école (`?campus_id=xxx`)
- [x] `GET /api/v1/programs/[id]` — Détail d'un programme
- [x] `GET /api/v1/programs` — Recherche globale (`?search=pge&admission_exam=sesame&alternance=true`)

### 9.4 — Pricing (2 endpoints)
- [x] `GET /api/v1/programs/[id]/pricing` — Historique tarifaire d'un programme (`?year=2025`)
- [x] `GET /api/v1/schools/[id]/pricing` — Tous les tarifs de l'école (`?year=2025`)

### 9.5 — Rankings (2 endpoints)
- [x] `GET /api/v1/programs/[id]/rankings` — Classements d'un programme (`?year=2025&ranking_name=Figaro`)
- [x] `GET /api/v1/rankings` — Tableau global de classements (`?ranking_name=Figaro&year=2025&page=1&limit=50`)

### 9.6 — Capacity (1 endpoint)
- [x] `GET /api/v1/programs/[id]/capacity` — Historique des places (`?year=2025`)

### 9.7 — Comparaison (1 endpoint)
- [x] `GET /api/v1/compare/programs` — Comparer N programmes côte à côte (`?ids=uuid1,uuid2,uuid3`, max 5)

### 9.8 — Configuration transversale
- [x] CORS headers : `Access-Control-Allow-Origin: *`
- [x] Cache ISR 1h sur chaque route (`export const revalidate = 3600`)
- [x] Format d'erreur standardisé : `{"error": "description"}`
- [x] `400 Bad Request` pour paramètres invalides (ex: compare avec > 5 IDs)
- [x] `404 Not Found` pour ID inexistant ou école non ACTIVE
- [x] Exclure ContributionInbox, CronTarget, User de toute réponse

### ✅ Tests Étape 9
```
- [x] GET /api/v1/schools retourne un JSON paginé avec les écoles actives
- [x] GET /api/v1/schools?search=emlv retourne uniquement les écoles matchant "emlv"
- [x] GET /api/v1/schools/[id_invalide] retourne 404 {"error": "..."}
- [x] GET /api/v1/schools/[id] retourne les infos de base de l'école
- [x] GET /api/v1/schools/[id]/stats retourne les stats (dernière année par défaut)
- [x] GET /api/v1/schools/[id]/stats?year=2025 retourne les stats de 2025
- [x] GET /api/v1/schools/[id]/accreditations retourne la liste des accréditations
- [x] GET /api/v1/schools/[id]/campuses retourne les campus avec programmes
- [x] GET /api/v1/campuses/[id] retourne le détail du campus + programmes
- [x] GET /api/v1/schools/[id]/programs retourne tous les programmes
- [x] GET /api/v1/schools/[id]/programs?campus_id=xxx filtre par campus
- [x] GET /api/v1/programs?search=pge retourne les programmes matchant
- [x] GET /api/v1/programs/[id] retourne le détail du programme
- [x] GET /api/v1/programs/[id]/pricing retourne l'historique tarifaire
- [x] GET /api/v1/schools/[id]/pricing retourne les tarifs de tous les programmes
- [x] GET /api/v1/programs/[id]/rankings retourne les classements
- [x] GET /api/v1/rankings?ranking_name=Figaro&year=2025 retourne le tableau global
- [x] GET /api/v1/programs/[id]/capacity retourne l'historique des places
- [x] GET /api/v1/compare/programs?ids=uuid1,uuid2 retourne les données côte à côte
- [x] GET /api/v1/compare/programs?ids=1,2,3,4,5,6 retourne 400 (max 5)
- [x] Les headers CORS sont présents dans toutes les réponses
- [x] Aucun champ de ContributionInbox ou CronTarget n'apparaît dans les réponses
- [x] Deux requêtes consécutives → la 2ème est servie depuis le cache
```

---

## Étape 10 : Page Documentation API

### 10.1 — Page `/api-docs`
- [x] Page publique listant tous les endpoints v1 avec descriptions, paramètres et exemples de réponse
- [x] Exemples de code (curl, JavaScript, Python)

### ✅ Tests Étape 10
```
- [x] La page /api-docs est accessible publiquement
- [x] Tous les endpoints v1 sont documentés avec paramètres et exemples
```

---

## Étape 11 : Sécurité et Edge Cases Finaux

### 11.1 — Rate Limiting Crowdsourcing
- [x] Middleware Vercel limitant les soumissions par IP (Edge Case 1)
- [x] Validation format URL (`https://` obligatoire)

### 11.2 — Healthcheck Koyeb
- [x] Endpoint `GET /health` configuré comme healthcheck Koyeb (Edge Case 15)
- [x] Frontend : retry automatique avec message UX si le backend est indisponible

### 11.3 — Quota Guard Tavily
- [x] Vérification des crédits restants avant chaque appel Tavily
- [x] Arrêt automatique du pipeline si quota atteint (Edge Case 1)

### 11.4 — Monitoring Admin
- [x] Page `/admin/cron` affichant : dernières exécutions, CronTargets blacklistés, crédits Tavily restants
- [x] Bouton pour débloquer un CronTarget blacklisté

### ✅ Tests Étape 11
```
- [x] Soumissions crowdsourcing rapides → rate limit actif
- [x] Healthcheck retourne 200 quand FastAPI est prêt
- [x] Pipeline s'arrête proprement quand le quota Tavily est atteint
- [x] La page /admin/cron affiche les CronTargets et permet le déblocage
```

---

## Récapitulatif des Étapes

| Étape | Description | Dépend de |
|---|---|---|
| 0 | Initialisation projet (Next.js + FastAPI) | — |
| 1 | BDD Prisma + Auth NextAuth | 0 |
| 2 | Dashboard Admin CRUD (Écoles, Campus, Users) | 1 |
| 3 | Dashboard Admin Inbox (validation, Super Ticket) | 2 |
| 4 | FastAPI Core (DB, API interne, Tavily KeyCycling, Module Gemma) | 0 |
| 5 | Pipeline Phase 1 (Crawl + Extraction + Inbox) | 4 |
| 6 | Pipeline Phase 2 (Strategy Router + Enrichissement + Diff) | 5 |
| 7 | Workflow A Crowdsourcing (Frontend + Backend) | 3, 4 |
| 8 | Frontend Public Consultation | 2 |
| 9 | API REST Publique v1 | 1 |
| 10 | Page Documentation API | 9 |
| 11 | Sécurité et Edge Cases finaux | Tout |
