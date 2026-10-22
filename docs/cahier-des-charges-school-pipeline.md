# Cahier des Charges : Plateforme de Données de l'Enseignement Supérieur (School Data Pipeline)

> **Évolution du 16 octobre 2026, décision de l'équipe.** Les nouvelles
> priorités sont dans le doc « Plan d'évolution – School Data Pipeline » du
> propriétaire, et leur mise en œuvre dans
> `docs/features/gestion-contenu.md` (sur la branche `gestion`). Ce qui change
> par rapport à ce cahier :
>
> - la plateforme devient d'abord un **gestionnaire de contenu**, utilisable en
>   ligne ; la recherche IA (Workflow B) est **gelée**, gardée telle quelle et
>   réservée à l'admin ;
> - **les données ne sont plus publiques** : connexion obligatoire, sur une
>   liste blanche d'e-mails gérée par l'admin, API v1 comprise ;
> - **trois rôles** au lieu de deux : utilisateur (consulte et signale),
>   gestionnaire (l'ancien modérateur : ajoute, modifie, supprime le contenu),
>   admin (accès, rôles, IA) ;
> - le **crowdsourcing** (Workflow A) est abandonné, remplacé par un
>   formulaire de signalement sans IA ;
> - chaque donnée affiche sa source et qui l'a modifiée ; deux nouvelles
>   données (événements des écoles, année d'entrée d'un programme) ;
> - refonte graphique complète, puis un guide utilisateur.
>
> Le reste du cahier décrit l'exigence d'origine ; il n'est pas réécrit.

> **Mise à jour du 12 octobre 2026.** Les exigences (humain dans la boucle,
> pipeline en deux phases, crowdsourcing borné aux écoles existantes) sont
> inchangées. Les choix techniques ont été alignés sur le code : Tavily Research
> rédige un rapport que la cascade Gemini structure, le modèle de données est
> celui de `bdd.md`. Détail : [`architecture/architecture.md`](architecture/architecture.md).
>
> **Modification du 15 octobre 2026, décision du propriétaire (C4).** Le
> crowdsourcing passe à son tour par la **cascade Gemini** du pipeline ; Gemma
> n'y sert plus qu'en dernier recours. Motif : à l'étape 9 du plan
> backend-local, Gemma a rendu 4 erreurs 500 sur 6 appels, et ne sait pas
> suivre un schéma JSON imposé. **Mis en œuvre le 15 octobre 2026** (tâche hors
> plan C1 à C4, journal de [`features/backend-local.md`](features/backend-local.md)) :
> la compatibilité et l'extraction passent par la cascade, aux mêmes planchers
> par catégorie que le pipeline ; Gemma 26B et 31B ne sont appelés que si la
> cascade est épuisée.

## 1. Introduction et Objectif
Le projet vise à développer une plateforme hybride (Crowdsourcing + Pipeline IA Automatisé) permettant de centraliser les données de l'enseignement supérieur, telles que les grilles tarifaires, les classements et les places disponibles.
Le système extrait, vérifie et structure les informations issues des sites officiels des écoles vers une base de données rigide, tout en conservant systématiquement un humain dans la boucle (Human-in-the-Loop) pour la validation finale.

## 2. Infrastructure et Stack Technique (Optimisation Free Tier)
- **Frontend :** Next.js hébergé sur Vercel. Gère les 4 zones de l'application (Consultation publique, Crowdsourcing, Documentation API, Dashboard Admin/Modérateur).
- **Backend IA :** FastAPI hébergé sur Koyeb (Instance EcoFree - fonctionnement 24/7). Exécute le pipeline IA (Tavily + Gemini, Gemma pour le crowdsourcing) et le Cron automatisé.
- **Base de Données / ORM :** PostgreSQL hébergé sur Neon.tech (500MB gratuits). L'architecture relationnelle est définie et gérée via **Prisma** (Prisma Client JS pour l'accès DB depuis Next.js). Le backend Python accède à cette même base via psycopg2 (pool).
- **Communication :** Architecture hybride — DB partagée + API interne minimale entre Next.js et FastAPI (sécurisée par token partagé) pour les actions manuelles (ex: relancer un scan).
- **Automatisation/Scheduling :** `APScheduler` (ou librairie Python équivalente) exécuté au sein de l'instance FastAPI.
- **Authentification :** NextAuth.js avec Credentials Provider. Deux rôles : Admin et Modérateur. Pas d'auto-inscription.

## 3. La Stack IA et Extraction
- **Recherche et Extraction :** API Tavily (Free tier : 1000 crédits/mois par clé). Modes utilisés :
  - `research` (`pro` ou `mini`) : agent de recherche autonome du pipeline automatisé (Phase 1 et Phase 2). Il rédige un **rapport**, sans `output_schema` : ce paramètre écourtait la recherche elle-même. ~25 crédits estimés en pro, ~10 en mini.
  - `search` + `extract` : ancrage catalogue de la Phase 1 (page « nos formations » de l'école).
  - `map` + `extract` : collecte du rattachement campus, sur demande de l'admin.
  - `extract` : URL fournies par les contributeurs (Workflow A). 1 crédit / 5 URL.
- **Modèles IA (via google-genai) :**
  - *Cascade Gemini* (8 modèles, 3 paliers) : convertit les rapports Research en JSON, avec un plancher de qualité par catégorie. Utilisée par tout le pipeline et, depuis la décision C4 du 15 octobre 2026, par le crowdsourcing : contrôle de compatibilité (modèles « lite » d'abord, pour ménager les quotas) et extraction, aux mêmes planchers par catégorie que le pipeline.
  - *Gemma 4* (`models/gemma-4-26b-a4b-it`, `models/gemma-4-31b-it`) : **dernier recours du crowdsourcing seulement**, quand la cascade est épuisée au-dessus du plancher (26B : compatibilité ; 31B : extraction).
- **Rotation de Clés API (Key Cycling) :** Bascule automatique entre plusieurs clés API Tavily gratuites (stratégie Greedy) pour pallier les limites du Free Tier lors de recherches massives.

## 4. Modèle de Données (Zone Buffer et Tables Rigides)

Le système gère plusieurs types de données tout en maintenant un typage strict pour la production.
**Réf. complète : `bdd.md`**

### 4.1. Entités Principales (Architecture Multi-Campus)
- **School :** `id`, `name`, `official_domain` (ex: `emlv.fr`), `status`.
- **Campus :** `id`, `schoolId`, `name` (ex: "Campus Paris La Défense"), `city`. Une école possède N campus. Chaque campus a ses propres programmes et tarifs.
- **Program :** `id`, `schoolId`, `name` (ex: "Programme Grande École"), `admission_exam`, `is_alternance_possible`, `is_expatriation_mandatory`, `min_expatriation_months`, `max_internship_months`, `campus_policy_note`. Un programme appartient à l'**école** ; son ouverture sur chaque campus est une ligne `ProgramCampus`, détaillée année par année par `ProgramCampusAttachment`.
- **User :** `id`, `username`, `password_hash`, `role` (ADMIN ou MODERATOR).

### 4.2. La Zone Buffer (Flexible)
- **ContributionInbox :** La file d'attente centrale pour toutes les données entrantes.
  - `id`
  - `source_type` (User_Submission, Automated_AI)
  - `schoolId`, `campusId`, `programId`, `programCampusId` (clés étrangères optionnelles, `ON DELETE SET NULL` — reflètent le niveau de rattachement de la donnée)
  - `user_text` (nullable, la déclaration/revendication faite par l'utilisateur)
  - `urls` (tableau de chaînes de caractères, liens fournis par l'utilisateur)
  - `ai_category` : Pricing, Ranking, Capacity, SchoolStats, Accreditation, **Program_Discovery**
  - `ai_extracted_json` (**Type PostgreSQL : `JSONB`**) : Les données structurées renvoyées par l'IA. Pour les tickets `Program_Discovery`, contient un tableau de campus et programmes découverts.
  - `status` (Pending_AI, Pending_Admin, Validated, Rejected, Failed)
  - `raw_report` (texte, nullable) : rapport Tavily Research intégral, pour les tickets du pipeline
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
- **CapacityRecord :** `id`, `programCampusId`, `spots_available`, `academic_year`, `source_url` — la capacité varie d'un campus à l'autre.
- **SchoolStatsRecord :** `id`, `schoolId`, `academic_year`, `total_students`, `total_alumni`, `partner_companies`, `annual_internship_offers`, etc.
- **AccreditationRecord :** `id`, `schoolId`, `accreditation_name`, `accreditation_type`, `year_obtained` (nullable), `is_active`.

### 4.4. ~~Table de Suivi du Cron (Pipeline Automatisé)~~ *(Supprimée)*

> **Note :** La table `CronTarget` a été supprimée du projet. Chaque passe du pipeline est tracée dans `PipelineJob` (état, progression, erreur), sans blacklist. Le pipeline Tavily Research est suffisamment intelligent pour naviguer autour des obstacles.

## 5. Pipeline IA en 2 Phases

Le pipeline automatisé (Workflow B) est divisé en deux étapes séquentielles avec validation obligatoire entre les deux.

### 5.1. Phase 1 : Cartographie (Program Discovery)
1. **Détection :** En production, la rotation nocturne retient une école `ACTIVE` dont la Phase 1 est due — jamais passée (les écoles sans programme en premier), puis tous les six mois —, ou l'admin lance la passe depuis `/admin/cron`. Sur une école déjà cartographiée, la découverte ne propose que ce qui manque en base.
2. **Recherche :** FastAPI lit la page catalogue de l'école (ancrage), puis lance **Tavily Research** (mode `pro`) avec un brief contextualisé (nom de l'école, domaine officiel).
3. **Extraction :** Tavily Research croise les sources et rédige un rapport ; la cascade Gemini le convertit en JSON. Si l'extraction échoue, le rapport est conservé et repris à la passe suivante, sans repayer Research.
4. **Ticket Inbox :** Création d'un ticket `ContributionInbox` avec `ai_category = "Program_Discovery"` et `status = "Pending_Admin"`.
5. **⏸️ Blocage strict :** Le Cron ne lance **jamais** la Phase 2 d'une école tant qu'aucun de ses programmes n'a été validé par l'Admin. La Phase 2 ne lit que la table `Program` : une nouvelle découverte en attente n'empêche pas l'enrichissement des programmes déjà validés, et n'y ajoute rien.

### 5.2. Phase 2 : Enrichissement Chirurgical (Deep Dive)
Après validation de la Phase 1, le Cron enchaîne la recherche de données granulaires en utilisant les vrais noms de programmes et campus validés.

Le pipeline utilise **Tavily Research** avec un brief par catégorie, au niveau où la donnée existe — école (SchoolStats, Accreditation, Ranking), programme (Pricing), programme × campus (Capacity) — en mode `pro` pour Pricing et Ranking, `mini` pour les autres :
- **Pricing :** Prompt ciblant les frais de scolarité avec année scolaire dynamique N+1
- **SchoolStats :** Prompt ciblant les chiffres clés de l'école
- **Ranking :** Prompt ciblant les classements dans les médias français et internationaux
- **Capacity :** Prompt ciblant les places disponibles
- **Accreditation :** Prompt ciblant les accréditations et labels

Chaque recherche passe par le diff (`has_data_changed()`) vs les données de production. Si rien n'a changé, l'insertion est annulée silencieusement *(Réf: Edge Case 10)*.

### 5.3. Rattachement campus année par année (sur demande)
La découverte dit quelles formations existent, pas sur quel campus ni en quelle année. Sur demande de l'admin, le pipeline lit l'encart « Campus » des fiches formation du site, et propose un ticket qui détaille chaque arête programme × campus année par année (`ProgramCampusAttachment`). Il ne crée jamais d'arête : celles-ci naissent de la validation d'une découverte.

## 6. Workflows Utilisateur

### 6.1. Workflow A : Crowdsourcing Utilisateur
1. **Soumission :** Un utilisateur "lambda" (sans connexion) arrive sur la page de soumission publique.
2. **Sélection en arborescence :** L'utilisateur sélectionne dans des dropdowns cascadés : École → (Campus) → (Programme). Il peut s'arrêter à n'importe quel niveau selon la nature de sa donnée. **Aucune possibilité d'ajouter de nouvelle école** (Admin uniquement).
3. **Choix de catégorie :** L'utilisateur sélectionne le(s) type(s) de données qu'il soumet (multi-sélection possible : Tarifs, Classement, Capacité, Stats école…).
4. **Soumission :** L'utilisateur fournit son texte/revendication + URL(s) source(s).
5. **Création Inbox :** Création d'une entrée `ContributionInbox` **par catégorie sélectionnée** (`source_type = User_Submission`, `status = Pending_AI`, FK rattachées au niveau sélectionné).
6. **Acquisition des données :** FastAPI envoie l'URL à **Tavily Extract** pour récupérer le Markdown brut.
7. **Compatibilité & Extraction (IA) :** la cascade Gemini vérifie que la page concerne bien l'école et la catégorie choisie, puis extrait le JSON ; Gemma ne prend le relais que si la cascade est épuisée (décision C4 du 15 octobre 2026, mise en œuvre). Si Gemma échoue à son tour, la contribution attend la réouverture d'un modèle au lieu d'être rejouée et supprimée. Le statut passe à `Pending_Admin`. **Le texte libre du contributeur (`user_text`) n'atteint jamais un modèle** : il est seulement affiché à l'admin, pour empêcher toute injection de consignes.

### 6.2. Workflow B : Pipeline IA Automatisé (2 Phases via Tavily Research)
Voir section 5 ci-dessus pour le détail des Phases 1 et 2.

1. **Configuration (Admin Panel) :** L'Admin gère la liste des écoles cibles via son CRUD (nom + domaine officiel). Suppression avec double confirmation.
2. **Phase 1 (Cartographie) :** Découverte automatique des campus et programmes (catalogue + Tavily Research → rapport → Gemini → Inbox). Blocage strict jusqu'à validation Admin.
3. **Phase 2 (Enrichissement) :** Recherche ciblée des données granulaires par catégorie (Tavily Research → rapport → Gemini → Inbox).
4. **Filtrage des Doublons :** Comparaison avec les données de production (`has_data_changed()`). Si rien n'a changé, l'insertion est annulée silencieusement *(Réf: Edge Case 10)*.
5. **Création Inbox :** Si des différences sont avérées, insertion dans `ContributionInbox` (`source_type = Automated_AI`, statut `Pending_Admin`).

### 6.3. Étape Finale : Validation Humaine (La Boucle Admin)
1. L'Admin/Modérateur accède à la file `ContributionInbox` sur son tableau de bord.
2. **Pour les tickets `Program_Discovery` :** L'interface génère un formulaire "répéteur" pré-rempli (Super Ticket). L'Admin peut corriger un nom, modifier un campus, supprimer un programme obsolète ou en ajouter un manuellement. Lors de la validation, une transaction Prisma crée/met à jour les `Campus`, les `Program` et leurs associations `ProgramCampus` en une seule passe.
3. **Pour les tickets de données :** L'interface génère dynamiquement un formulaire pré-rempli à l'aide du JSON. L'Admin vérifie les justifications de l'IA, corrige si nécessaire, puis valide.
4. Les données sont transférées dans les tables rigides (`PricingRecord`, etc.) via un `upsert` Prisma et l'entrée Inbox est marquée comme `Validated`.

## 7. Zones du Frontend Next.js

Le frontend Next.js hébergé sur Vercel comporte 4 zones distinctes :

| Zone | Accès | Description |
|---|---|---|
| **Consultation publique** | Public | Recherche d'écoles, fiches détaillées avec tarifs, classements, statistiques. Sélection par école puis affichage des données. |
| **Crowdsourcing** | Public | Page de soumission de données avec sélection en arborescence (École → Campus → Programme) et choix multi-catégorie. |
| **Documentation API** | Public | Page de documentation interactive des routes de l'API REST publique (15 endpoints, paramètres, exemples). |
| **Dashboard Admin** | Protégé (NextAuth) | CRUD écoles/campus, validation de l'Inbox, monitoring du pipeline et recherche manuelle, gestion des modérateurs (Admin uniquement). |

> **Réf. détaillée API REST :** Voir `API-rest.md` pour la spécification complète des 15 endpoints (Schools, Campuses, Programs, Pricing, Rankings, Capacity, Compare), les query params, le caching ISR et la gestion d'erreurs.

## 8. Règles d'Architecture, Sécurité et Optimisation

Pour garantir la résilience, la fiabilité et maîtriser les coûts, les contraintes suivantes doivent être respectées lors du développement :

1. **Gestion de la Concurrence dans l'Inbox (Prévention des doublons) :** Afin d'éviter qu'un utilisateur et le Cron automatisé ne créent simultanément un ticket pour la même information, une logique d'upsert ou de vérification de doublons sera implémentée lors de l'insertion dans la `ContributionInbox`.
2. **Résilience et Idempotence du Cron (Koyeb) :** Bien que l'instance Koyeb tourne 24/7, les redémarrages sont possibles sur les offres gratuites. Les tâches `APScheduler` doivent être idempotentes. Mise en œuvre : l'état des passes vit dans `PipelineJob`, et un job laissé « en cours » par un processus disparu est clos au redémarrage. Les jobs qui paient Research ne sont inscrits qu'en production.
3. **Extraction "Enrichie" via Tavily Research :** Le pipeline utilise l'API Tavily Research (agent de recherche autonome), **sans `output_schema`** : l'agent rédige un rapport, conservé dans `raw_report`, que la cascade Gemini convertit en JSON natif. **L'utilisation de Pydantic reste formellement interdite avec les modèles Gemma** (crowdsourcing).
4. **Le bridage automatique (Quota Guard Tavily) :** Le pipeline IA s'arrêtera automatiquement dès l'atteinte du quota de l'API (rotation de clés avec stratégie Greedy).
5. **Gestion simplifiée des URLs :** Le champ `urls` de l'Inbox gère le flux frontend, et à la validation, les liens précis seront insérés de manière propre dans les champs `source_url` des tables finales.
6. **Blocage Phase 1 → Phase 2 :** Le Cron ne lance JAMAIS la Phase 2 (enrichissement) sur un programme que l'Admin/Modérateur n'a pas validé : une école sans programme validé n'est pas candidate, et la Phase 2 ne lit que la table `Program`. Cela garantit que seuls des programmes confirmés sont enrichis.
7. **Admin-only pour les écoles :** Seul un Admin ou Modérateur peut ajouter/modifier/supprimer des écoles. Les utilisateurs publics ne peuvent contribuer que pour les écoles déjà existantes en BDD.
