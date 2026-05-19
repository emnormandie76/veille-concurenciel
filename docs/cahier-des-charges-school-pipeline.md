# Cahier des Charges : Plateforme de Données de l'Enseignement Supérieur (School Data Pipeline)

## 1. Introduction et Objectif
Le projet vise à développer une plateforme hybride (Crowdsourcing + Pipeline IA Automatisé) permettant de centraliser les données de l'enseignement supérieur, telles que les grilles tarifaires, les classements et les places disponibles.
Le système extrait, vérifie et structure les informations issues des sites officiels des écoles vers une base de données rigide, tout en conservant systématiquement un humain dans la boucle (Human-in-the-Loop) pour la validation finale.

## 2. Infrastructure et Stack Technique (Optimisation Free Tier)
- **Frontend :** Next.js hébergé sur Vercel. Gère les 4 zones de l'application (Consultation publique, Crowdsourcing, Documentation API, Dashboard Admin/Modérateur).
- **Backend IA :** FastAPI hébergé sur Koyeb (Instance EcoFree - fonctionnement 24/7). Exécute le pipeline IA (Tavily + Gemma) et le Cron automatisé.
- **Base de Données / ORM :** PostgreSQL hébergé sur Neon.tech (500MB gratuits). L'architecture relationnelle est définie et gérée via **Prisma** (Prisma Client JS pour l'accès DB depuis Next.js). Le backend Python accède à cette même base via psycopg2 ou SQLAlchemy.
- **Communication :** Architecture hybride — DB partagée + API interne minimale entre Next.js et FastAPI (sécurisée par token partagé) pour les actions manuelles (ex: relancer un scan).
- **Automatisation/Scheduling :** `APScheduler` (ou librairie Python équivalente) exécuté au sein de l'instance FastAPI.
- **Authentification :** NextAuth.js avec Credentials Provider. Deux rôles : Admin et Modérateur. Pas d'auto-inscription.

## 3. La Stack IA et Extraction
- **Recherche et Scraping :** API Tavily (Free tier: 1000 crédits/mois). Trois endpoints utilisés selon le contexte :
  - `crawl` : Exploration de sites entiers (Phase 1 — Cartographie). ~1 crédit/10 pages.
  - `search` : Recherche web ciblée avec `include_domains` et `include_raw_content` (Phase 2 — Enrichissement). 1-2 crédits/requête.
  - `extract` : Extraction d'URLs spécifiques fournies par les utilisateurs (Workflow A — Crowdsourcing). 1 crédit/5 URLs.
- **Modèles IA (via google-genai) :**
  - *Gemma 4 26B (`models/gemma-4-26b-it`) :* Utilisé pour le routage sémantique rapide, la validation et le fact-checking ("Ce texte confirme-t-il la déclaration de l'utilisateur ?").
  - *Gemma 4 31B (`models/gemma-4-31b-it`) :* Utilisé pour l'extraction complexe de données JSON avec des instructions strictes anti-hallucination.
- **Rotation de Clés API (Key Cycling) :** Bascule automatique entre plusieurs clés API Tavily gratuites pour pallier les limites du Free Tier lors de recherches massives.

## 4. Modèle de Données (Zone Buffer et Tables Rigides)

Le système gère plusieurs types de données tout en maintenant un typage strict pour la production.
**Réf. complète : `bdd.md`**

### 4.1. Entités Principales (Architecture Multi-Campus)
- **School :** `id`, `name`, `official_domain` (ex: `emlv.fr`), `status`.
- **Campus :** `id`, `schoolId`, `name` (ex: "Campus Paris La Défense"), `city`. Une école possède N campus. Chaque campus a ses propres programmes et tarifs.
- **Program :** `id`, `campusId`, `name` (ex: "Programme Grande École"), `admission_exam`, `is_alternance_possible`, `is_expatriation_mandatory`, `min_expatriation_months`, `max_internship_months`.
- **User :** `id`, `username`, `password_hash`, `role` (ADMIN ou MODERATOR).

### 4.2. La Zone Buffer (Flexible)
- **ContributionInbox :** La file d'attente centrale pour toutes les données entrantes.
  - `id`
  - `source_type` (User_Submission, Automated_AI)
  - `schoolId`, `campusId`, `programId` (FK optionnelles — reflètent le niveau de rattachement de la donnée)
  - `user_text` (nullable, la déclaration/revendication faite par l'utilisateur)
  - `urls` (tableau de chaînes de caractères, liens fournis par l'utilisateur)
  - `ai_category` : Pricing, Ranking, Capacity, SchoolStats, Accreditation, **Program_Discovery**
  - `ai_extracted_json` (**Type PostgreSQL : `JSONB`**) : Les données structurées renvoyées par l'IA. Pour les tickets `Program_Discovery`, contient un tableau de campus et programmes découverts.
  - `status` (Pending_AI, Pending_Admin, Validated, Rejected)
  - `year_assumed` (booléen, défaut `false`) : Indique que l'année académique n'était pas explicite sur la source et a été déduite comme l'année en cours. *(Réf: Edge Case 2.1)*
  - `data_conflict_warning` (booléen, défaut `false`) : Signale que l'IA a détecté des sources contradictoires. *(Réf: Edge Case 5)*
  - `program_name_mismatch` (booléen, défaut `false`) : Signale un probable renommage du programme par l'école. *(Réf: Edge Case 6)*

### 4.3. Tables de Données Validées (Rigides)
- **PricingRecord :**
  - `id`, `programId`, `academic_year`, `currency`, `source_url`
  - `year_1_fee`, `year_2_fee`, `year_3_fee`, `year_4_fee`, `year_5_fee` (nullable) : Tarifs décomposés par année de cursus. *(Réf: Edge Case 3)*
  - `total_fee` (nullable) : Tarif global du cursus si communiqué tel quel. *(Réf: Edge Case 3)*
  - `additional_fees_notes` (texte, nullable) : Frais annexes détectés (frais de dossier, CVEC, concours…). *(Réf: Edge Case 8)*
  - `intl_year_1_fee`, `intl_total_fee` (nullable) : Tarifs internationaux (Non-UE). *(Réf: Edge Case 12)*
  - `intl_currency` (nullable) : Devise des tarifs internationaux. *(Réf: Edge Case 12)*
- **RankingRecord :** `id`, `programId`, `ranking_name`, `rank`, `academic_year`, `source_url`.
- **CapacityRecord :** `id`, `programId`, `spots_available`, `academic_year`, `source_url`.
- **SchoolStatsRecord :** `id`, `schoolId`, `academic_year`, `total_students`, `total_alumni`, `partner_companies`, `annual_internship_offers`, etc.
- **AccreditationRecord :** `id`, `schoolId`, `accreditation_name`, `year_obtained`, `is_active`.

### 4.4. Table de Suivi du Cron (Pipeline Automatisé)
- **CronTarget :** Suivi de l'état de chaque cible de recherche automatisée.
  - `id`, `schoolId`, `programId`, `data_category` (Pricing, Ranking, Capacity, **Program_Discovery**)
  - `last_failed_attempt` (timestamp, nullable) : Date du dernier échec de recherche. *(Réf: Edge Case 4)*
  - `failed_attempts_count` (entier, défaut `0`) : Compteur d'échecs consécutifs. Après 3 échecs, la cible est temporairement blacklistée. *(Réf: Edge Case 4)*
  - `is_blacklisted` (booléen, défaut `false`) : Indique que la donnée est introuvable publiquement et nécessite une recherche manuelle par l'Admin.

## 5. Pipeline IA en 2 Phases

Le pipeline automatisé (Workflow B) est divisé en deux étapes séquentielles avec validation obligatoire entre les deux.

### 5.1. Phase 1 : Cartographie (Program Discovery)
1. **Détection :** Le Cron détecte qu'une école n'a aucun `Campus`/`Program` en BDD (ou que la dernière cartographie date de plus de X mois).
2. **Crawl :** FastAPI utilise **Tavily Crawl** sur le domaine officiel de l'école (`select_paths` ciblant les pages Formations/Programmes/Admissions).
3. **Extraction (Gemma 31B) :** Le contenu Markdown récupéré est envoyé à Gemma avec un prompt spécialisé pour extraire un JSON structuré listant les campus et programmes détectés.
4. **Ticket Inbox :** Création d'un ticket `ContributionInbox` avec `ai_category = "Program_Discovery"` et `status = "Pending_Admin"`.
5. **⏸️ Blocage strict :** Le Cron ne lance **jamais** la Phase 2 tant que ce ticket n'est pas validé par l'Admin.

### 5.2. Phase 2 : Enrichissement Chirurgical (Deep Dive)
Après validation de la Phase 1, le Cron enchaîne la recherche de données granulaires en utilisant les vrais noms de programmes et campus validés.

Pour chaque `Program` validé, le pipeline utilise le **Routeur Dynamique** (Pattern Stratégie) :
- **Pricing :** `search` ciblant le domaine de l'école + `include_raw_content=true`. Prompt strict sur les Edge Cases 3 (lissage) et 12 (devises).
- **SchoolStats :** `search` ciblant le domaine de l'école. Prompt adapté pour nettoyer les chiffres marketing ("près de 20k" → `20000`).
- **Ranking :** `search` sur whitelist médias (Figaro, L'Étudiant). Activation du flag `data_conflict_warning` si plusieurs rangs détectés.
- **Capacity :** `search` hybride (Site école + Sites concours). Précision demandée sur le rattachement des places à l'école cible.

Chaque stratégie définit : les requêtes Tavily (avec variables `{school}`, `{campus}`, `{program}`), le prompt système Gemma spécifique, et le schéma JSON cible.

## 6. Workflows Utilisateur

### 6.1. Workflow A : Crowdsourcing Utilisateur (Fact-Checking)
1. **Soumission :** Un utilisateur "lambda" (sans connexion) arrive sur la page de soumission publique.
2. **Sélection en arborescence :** L'utilisateur sélectionne dans des dropdowns cascadés : École → (Campus) → (Programme). Il peut s'arrêter à n'importe quel niveau selon la nature de sa donnée. **Aucune possibilité d'ajouter de nouvelle école** (Admin uniquement).
3. **Choix de catégorie :** L'utilisateur sélectionne le(s) type(s) de données qu'il soumet (multi-sélection possible : Tarifs, Classement, Capacité, Stats école…).
4. **Soumission :** L'utilisateur fournit son texte/revendication + URL(s) source(s).
5. **Création Inbox :** Création d'une entrée `ContributionInbox` **par catégorie sélectionnée** (`source_type = User_Submission`, `status = Pending_AI`, FK rattachées au niveau sélectionné).
6. **Acquisition des données :** FastAPI envoie l'URL à **Tavily Extract** pour récupérer le Markdown brut.
7. **Fact-Checking & Extraction (IA) :** Gemma compare le texte utilisateur au Markdown, catégorise la donnée, vérifie l'information et extrait le JSON. Le statut passe à `Pending_Admin`.

### 6.2. Workflow B : Pipeline IA Automatisé (2 Phases)
Voir section 5 ci-dessus pour le détail des Phases 1 et 2.

1. **Configuration (Admin Panel) :** L'Admin gère la liste des écoles cibles via son CRUD (nom + domaine officiel). Suppression avec double confirmation.
2. **Phase 1 (Cartographie) :** Découverte automatique des campus et programmes (Tavily Crawl → Gemma → Inbox). Blocage strict jusqu'à validation Admin.
3. **Phase 2 (Enrichissement) :** Recherche ciblée des données granulaires (Tavily Search → Gemma → Inbox).
4. **Filtrage des Doublons :** Comparaison avec les données de production. Si rien n'a changé, l'insertion est annulée silencieusement *(Réf: Edge Case 10)*.
5. **Création Inbox :** Si des différences sont avérées, insertion dans `ContributionInbox` (`source_type = Automated_AI`, statut `Pending_Admin`).

### 6.3. Étape Finale : Validation Humaine (La Boucle Admin)
1. L'Admin/Modérateur accède à la file `ContributionInbox` sur son tableau de bord.
2. **Pour les tickets `Program_Discovery` :** L'interface génère un formulaire "répéteur" pré-rempli (Super Ticket). L'Admin peut corriger un nom, modifier un campus, supprimer un programme obsolète ou en ajouter un manuellement. Lors de la validation, une transaction Prisma crée/met à jour les `Campus` et `Program` en une seule passe.
3. **Pour les tickets de données :** L'interface génère dynamiquement un formulaire pré-rempli à l'aide du JSON. L'Admin vérifie les justifications de l'IA, corrige si nécessaire, puis valide.
4. Les données sont transférées dans les tables rigides (`PricingRecord`, etc.) via un `upsert` Prisma et l'entrée Inbox est marquée comme `Validated`.

## 7. Zones du Frontend Next.js

Le frontend Next.js hébergé sur Vercel comporte 4 zones distinctes :

| Zone | Accès | Description |
|---|---|---|
| **Consultation publique** | Public | Recherche d'écoles, fiches détaillées avec tarifs, classements, statistiques. Sélection par école puis affichage des données. |
| **Crowdsourcing** | Public | Page de soumission de données avec sélection en arborescence (École → Campus → Programme) et choix multi-catégorie. |
| **Documentation API** | Public | Page de documentation interactive des routes de l'API REST publique (15 endpoints, paramètres, exemples). |
| **Dashboard Admin** | Protégé (NextAuth) | CRUD écoles/campus, validation de l'Inbox, monitoring du Cron, gestion des modérateurs (Admin uniquement). |

> **Réf. détaillée API REST :** Voir `API-rest.md` pour la spécification complète des 15 endpoints (Schools, Campuses, Programs, Pricing, Rankings, Capacity, Compare), les query params, le caching ISR et la gestion d'erreurs.

## 8. Règles d'Architecture, Sécurité et Optimisation

Pour garantir la résilience, la fiabilité et maîtriser les coûts, les contraintes suivantes doivent être respectées lors du développement :

1. **Gestion de la Concurrence dans l'Inbox (Prévention des doublons) :** Afin d'éviter qu'un utilisateur et le Cron automatisé ne créent simultanément un ticket pour la même information, une logique d'upsert ou de vérification de doublons sera implémentée lors de l'insertion dans la `ContributionInbox`.
2. **Résilience et Idempotence du Cron (Koyeb) :** Bien que l'instance Koyeb tourne 24/7, les redémarrages sont possibles sur les offres gratuites. Les tâches `APScheduler` devront être idempotentes (capables de reprendre l'exécution proprement après une interruption imprévue).
3. **Extraction "Enrichie" et Schéma JSON Strict (Sans Pydantic) :** 
   - Le prompt demandera explicitement à l'IA d'expliquer pourquoi et où elle a trouvé la donnée (enrichissement).
   - **IMPORTANT : L'utilisation de Pydantic est formellement interdite avec les modèles Gemma.** Pour garantir un JSON déterministe, le backend utilisera un prompt strict ("One-shot prompting") fournissant la structure JSON exacte à respecter, sans s'appuyer sur des librairies de validation automatique lors de la requête.
4. **Le bridage automatique (Quota Guard Tavily) :** Le pipeline IA s'arrêtera automatiquement dès l'atteinte du quota de l'API (1000 crédits/mois).
5. **Gestion simplifiée des URLs :** Le champ `urls` de l'Inbox gère le flux frontend, et à la validation, les liens précis seront insérés de manière propre dans les champs `source_url` des tables finales.
6. **Blocage Phase 1 → Phase 2 :** Le Cron ne lance JAMAIS la Phase 2 (enrichissement) tant que le ticket `Program_Discovery` (Phase 1) n'est pas validé par un Admin/Modérateur. Cela garantit que seuls des programmes confirmés sont enrichis.
7. **Admin-only pour les écoles :** Seul un Admin ou Modérateur peut ajouter/modifier/supprimer des écoles. Les utilisateurs publics ne peuvent contribuer que pour les écoles déjà existantes en BDD.
