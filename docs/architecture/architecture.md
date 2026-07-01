# Architecture Complète — School Data Pipeline (Partie 1 : Système)

> **Version :** 1.0 — 19 mai 2026
> **Statut :** Définitif — Validé lors du brainstorming architectural

---

## 1. Vue d'Ensemble du Projet

### 1.1. Objectif

Plateforme hybride (Crowdsourcing + Pipeline IA Automatisé) de centralisation des données de l'enseignement supérieur français : grilles tarifaires, classements, places disponibles, statistiques et accréditations.

Le système extrait, vérifie et structure les informations depuis les sites officiels des écoles vers une base de données rigide, avec un **humain dans la boucle** (Human-in-the-Loop) obligatoire pour toute validation finale.

### 1.2. Principes Fondateurs

| Principe | Description |
|---|---|
| **Human-in-the-Loop** | Aucune donnée ne rejoint la production sans validation humaine (Admin/Modérateur) |
| **Multi-Campus** | Une école possède N campus, chaque campus a ses propres programmes et tarifs |
| **Pipeline en 2 Phases** | Phase 1 (Cartographie) → Validation Admin → Phase 2 (Enrichissement) |
| **Double Zone** | Zone tampon (ContributionInbox) séparée des tables de production rigides |
| **Économie de ressources** | Optimisation du Free Tier de chaque service (Tavily, Neon, Koyeb, Vercel) |

---

## 2. Infrastructure et Stack Technique

### 2.1. Architecture Globale

```
┌─────────────────────────────┐         ┌─────────────────────────────┐
│     Next.js (Vercel)        │         │     FastAPI (Koyeb)         │
│                             │         │                             │
│  • Zone Consultation (pub)  │         │  • Pipeline IA              │
│  • Zone Crowdsourcing (pub) │  Token  │    - Tavily Research (pro)  │
│  • Zone API Docs (pub)      │◄───────►│    - Gemma 26B (fallback)   │
│  • Zone Admin (protégée)    │ interne │  • APScheduler (Cron)       │
│  • API REST publique v1     │         │  • psycopg2 / SQLAlchemy    │
│  • Prisma ORM               │         │                             │
│  • NextAuth.js              │         │                             │
└──────────┬──────────────────┘         └──────────┬──────────────────┘
           │                                       │
           └────────────────┐   ┌──────────────────┘
                            ▼   ▼
                   ┌──────────────────┐
                   │   PostgreSQL     │
                   │   (Neon.tech)    │
                   │   500MB Free     │
                   └──────────────────┘
```

### 2.2. Stack Détaillée

| Couche | Technologie | Hébergement | Contraintes Free Tier |
|---|---|---|---|
| Frontend + API publique | Next.js (App Router, TypeScript) | Vercel | Generous, pas de limite bloquante |
| Backend IA + Cron | FastAPI (Python) | Koyeb EcoFree 24/7 | Redémarrages possibles (Edge Case 15) |
| Base de données | PostgreSQL + Prisma ORM | Neon.tech | 500MB stockage |
| Recherche web | Tavily API (research/extract) | SaaS | 1000 crédits/mois (avec key cycling Greedy) |
| IA Extraction | Gemma 4 26B (fallback JSON) + 31B (crowdsourcing) via google-genai | Google AI Studio | Rate limits RPM (Edge Case 7) |
| Auth | NextAuth.js (Credentials Provider) | Vercel | — |
| Cache API | Vercel Edge Cache (ISR) | Vercel | `revalidate = 3600` |

### 2.3. Communication Inter-Services

**Modèle hybride : DB partagée + API interne minimale.**

- **DB partagée :** Next.js (Prisma) et FastAPI (psycopg2) lisent/écrivent dans la même base Neon. Chaque service écrit dans des tables/colonnes distinctes pour éviter les conflits.
- **API interne :** FastAPI expose quelques endpoints sécurisés par token partagé (variable d'env) pour les actions manuelles de l'Admin :
  - `POST /internal/trigger-scan/{school_id}` — Relancer un scan Phase 1
  - `POST /internal/trigger-enrichment/{school_id}` — Relancer la Phase 2
  - `GET /internal/pipeline-status` — État du pipeline et compteur de crédits Tavily

### 2.4. Arborescence Complète du Projet

> Les fichiers marqués `← étape X` sont à créer lors de l'étape correspondante dans `task.md`.
> Les fichiers sans marquage existent déjà ou font partie du scaffolding initial (étape 0).

```
appVC/
│
├── .env.local                          # Variables d'env Next.js (DATABASE_URL, NEXTAUTH_*, FASTAPI_INTERNAL_TOKEN)
├── .gitignore
├── next.config.ts
├── package.json
├── tsconfig.json
│
├── prisma/
│   ├── schema.prisma                   ← étape 1 (tous les modèles : User, School, Campus, Program, *Record, Inbox)
│   └── seed.ts                         ← étape 1 (création du premier Admin)
│
├── app/                                # ── NEXT.JS (App Router) ──────────────────
│   ├── globals.css
│   ├── layout.tsx                      # Layout racine (metadata SEO, font Inter)
│   ├── page.tsx                        ← étape 8 (page d'accueil : recherche d'écoles)
│   │
│   ├── schools/
│   │   └── [id]/
│   │       ├── page.tsx                ← étape 8 (fiche école : campus, stats, accréditations)
│   │       └── programs/
│   │           └── [pid]/
│   │               └── page.tsx        ← étape 8 (détail programme : tarifs, classements, capacité)
│   │
│   ├── contribute/
│   │   └── page.tsx                    ← étape 7 (formulaire crowdsourcing : arborescence + multi-catégorie)
│   │
│   ├── api-docs/
│   │   └── page.tsx                    ← étape 10 (documentation interactive API REST v1)
│   │
│   ├── admin/
│   │   ├── login/
│   │   │   └── page.tsx                ← étape 1 (page de connexion NextAuth)
│   │   ├── inbox/
│   │   │   └── page.tsx                ← étape 3 (validation ContributionInbox, Super Ticket)
│   │   ├── schools/
│   │   │   ├── page.tsx                ← étape 2 (CRUD écoles : liste + ajout/modif/suppression)
│   │   │   └── [id]/
│   │   │       └── campuses/
│   │   │           └── page.tsx        ← étape 2 (CRUD campus de l'école)
│   │   ├── cron/
│   │   │   └── page.tsx                ← étape 11 (monitoring pipeline, recherche manuelle)
│   │   └── users/
│   │       └── page.tsx                ← étape 2 (gestion modérateurs, Admin uniquement)
│   │
│   └── api/                            # ── API ROUTES NEXT.JS ────────────────────
│       ├── auth/
│       │   └── [...nextauth]/
│       │       └── route.ts            ← étape 1 (NextAuth Credentials Provider)
│       │
│       ├── admin/                      # Routes protégées (session NextAuth obligatoire)
│       │   ├── schools/
│       │   │   ├── route.ts            ← étape 2 (GET liste, POST créer)
│       │   │   └── [id]/
│       │   │       ├── route.ts        ← étape 2 (PUT modifier, DELETE supprimer avec double confirmation)
│       │   │       └── campuses/
│       │   │           └── route.ts    ← étape 2 (GET liste, POST créer)
│       │   ├── campuses/
│       │   │   └── [id]/
│       │   │       └── route.ts        ← étape 2 (PUT modifier, DELETE supprimer)
│       │   ├── inbox/
│       │   │   ├── route.ts            ← étape 3 (GET liste paginée + filtres)
│       │   │   └── [id]/
│       │   │       ├── route.ts        ← étape 3 (GET détail)
│       │   │       ├── validate/
│       │   │       │   └── route.ts    ← étape 3 (PUT valider → upsert tables rigides)
│       │   │       └── reject/
│       │   │           └── route.ts    ← étape 3 (PUT rejeter)
│       │   └── users/
│       │       ├── route.ts            ← étape 2 (GET liste, POST créer modérateur)
│       │       └── [id]/
│       │           └── route.ts        ← étape 2 (DELETE supprimer modérateur)
│       │
│       ├── contribute/
│       │   └── route.ts                ← étape 7 (POST soumission crowdsourcing)
│       │
│       ├── schools/                    # Routes publiques (frontend consultation)
│       │   ├── route.ts                ← étape 8 (GET écoles actives + recherche)
│       │   └── [id]/
│       │       └── route.ts            ← étape 8 (GET détail école)
│       │
│       └── v1/                         # ── API REST PUBLIQUE (v1) ────────────────
│           ├── schools/
│           │   ├── route.ts            ← étape 9 (GET liste paginée ?search=&page=&limit=)
│           │   └── [id]/
│           │       ├── route.ts        ← étape 9 (GET détail école)
│           │       ├── stats/
│           │       │   └── route.ts    ← étape 9 (GET stats école ?year=)
│           │       ├── accreditations/
│           │       │   └── route.ts    ← étape 9 (GET accréditations)
│           │       ├── campuses/
│           │       │   └── route.ts    ← étape 9 (GET campus + programmes)
│           │       ├── programs/
│           │       │   └── route.ts    ← étape 9 (GET programmes ?campus_id=)
│           │       └── pricing/
│           │           └── route.ts    ← étape 9 (GET tarifs école ?year=)
│           ├── campuses/
│           │   └── [id]/
│           │       └── route.ts        ← étape 9 (GET détail campus)
│           ├── programs/
│           │   ├── route.ts            ← étape 9 (GET recherche globale ?search=&alternance=)
│           │   └── [id]/
│           │       ├── route.ts        ← étape 9 (GET détail programme)
│           │       ├── pricing/
│           │       │   └── route.ts    ← étape 9 (GET historique tarifaire ?year=)
│           │       ├── rankings/
│           │       │   └── route.ts    ← étape 9 (GET classements ?year=&ranking_name=)
│           │       └── capacity/
│           │           └── route.ts    ← étape 9 (GET places ?year=)
│           ├── rankings/
│           │   └── route.ts            ← étape 9 (GET tableau global ?ranking_name=&year=)
│           └── compare/
│               └── programs/
│                   └── route.ts        ← étape 9 (GET comparaison ?ids=uuid1,uuid2)
│
├── lib/                                # ── UTILITAIRES NEXT.JS ───────────────────
│   ├── prisma.ts                       ← étape 1 (singleton Prisma Client)
│   ├── auth.ts                         ← étape 1 (config NextAuth, session helpers)
│   └── utils.ts                        ← étape 2 (fonctions utilitaires partagées)
│
├── middleware.ts                        ← étape 1 (protection routes /admin/*, sauf /admin/login)
│
├── backend/                            # ── FASTAPI (Python) ──────────────────────
│   ├── .env                            # Variables d'env Python (DATABASE_URL, GEMINI_API_KEY, TAVILY_API_KEYS, INTERNAL_TOKEN)
│   ├── requirements.txt
│   ├── main.py                         # Point d'entrée FastAPI (/health + montage routers)
│   │
│   ├── ai/                             ← étape 4
│   │   ├── __init__.py
│   │   ├── gemma_client.py             # Module Gemma (call_gemma, clean_json, validate, fact_check)
│   │   ├── research_prompts.py         # Builders de prompts dynamiques pour Tavily Research
│   │   └── research_schemas.py         # JSON Schemas pour output_schema Research
│   │
│   ├── tavily_service/                 ← étape 4
│   │   ├── __init__.py
│   │   ├── client.py                   # Client Tavily (crawl/search/extract — crowdsourcing)
│   │   ├── key_manager.py              # TavilyKeyManager (rotation de clés Greedy, quota guard)
│   │   └── research_client.py          # Client Tavily Research (create task + polling)
│   │
│   ├── pipeline/                       ← étape 5-6
│   │   ├── __init__.py
│   │   ├── phase1_research.py          # run_phase1_research() : Tavily Research → JSON/Gemma fallback → Inbox
│   │   ├── phase2_research.py          # run_phase2_research() : Research par catégorie → diff → Inbox
│   │   └── diff.py                     # has_data_changed() : comparaison vs production
│   │
│   ├── crowdsourcing/                  ← étape 7
│   │   ├── __init__.py
│   │   └── processor.py               # Traitement tickets User_Submission (extract → fact-check → extraction)
│   │
│   ├── routers/                        ← étape 4
│   │   ├── __init__.py
│   │   └── internal.py                 # Routes /internal/* (trigger-scan, trigger-enrichment, pipeline-status)
│   │
│   ├── scheduler/                      ← étape 5
│   │   ├── __init__.py
│   │   └── jobs.py                     # APScheduler : phase1_scanner, phase2_enricher
│   │
│   └── db.py                           ← étape 4 (connexion PostgreSQL, pool)
│
├── docs/                               # ── DOCUMENTATION ─────────────────────────
│   ├── agent-prompt.md                 # Prompt de démarrage pour les agents IA
│   ├── cahier-des-charges-school-pipeline.md
│   ├── edgecase.md                     # 15 edge cases + mitigations
│   └── architecture/
│       ├── architecture.md             # CE FICHIER — architecture complète
│       ├── bdd.md                      # Schéma Prisma détaillé
│       ├── API-rest.md                 # Spec 15 endpoints API v1
│       ├── gemma-python-guide.md       # Guide intégration Gemma/Gemini
│       └── task.md                     # Plan de tâches séquentiel (12 étapes)
│
└── test/
    ├── test_pipeline.py                # POC initial du pipeline (Tavily + Gemma)
    └── test_crowdsourcing_processor.py # Tests unitaires du crowdsourcing et du client Gemma robustifié
```

---

## 3. Modèle de Données Complet

> **Référence technique détaillée : `bdd.md`**

### 3.1. Chaîne Relationnelle

```
School (1) ──► (N) Campus (1) ──► (N) Program (1) ──► (N) PricingRecord
                                                  ──► (N) CapacityRecord
                                                  ──► (N) RankingRecord

School (1) ──► (N) SchoolStatsRecord
School (1) ──► (N) AccreditationRecord
```

### 3.2. Entités Principales

#### School
```prisma
model School {
  id              String   @id @default(uuid())
  name            String   @unique        // "EMLV"
  official_domain String   @unique        // "emlv.fr"
  status          String   @default("ACTIVE") // ACTIVE, INACTIVE, DRAFT
  campuses        Campus[]
  statsRecords    SchoolStatsRecord[]
  accreditations  AccreditationRecord[]
}
```

#### Campus (NOUVEAU)
```prisma
model Campus {
  id        String    @id @default(uuid())
  schoolId  String
  name      String    // "Campus Paris La Défense"
  city      String?   // "Paris"
  school    School    @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  programs  Program[]
  @@unique([schoolId, name])
}
```

#### Program
```prisma
model Program {
  id                        String   @id @default(uuid())
  campusId                  String   // Lié au Campus (et non plus à School)
  name                      String
  admission_exam            String?
  is_alternance_possible    Boolean  @default(false)
  is_expatriation_mandatory Boolean  @default(false)
  min_expatriation_months   Int?
  max_internship_months     Int?
  campus          Campus            @relation(fields: [campusId], references: [id], onDelete: Cascade)
  pricingRecords  PricingRecord[]
  capacityRecords CapacityRecord[]
  rankingRecords  RankingRecord[]
  @@unique([campusId, name])
}
```

### 3.3. Tables Temporelles (Records)

| Table | FK | Clé d'unicité | Champs clés |
|---|---|---|---|
| `PricingRecord` | `programId` | `[programId, academic_year]` | `year_1_fee`…`year_5_fee`, `total_fee`, `intl_*`, `additional_fees_notes`, `currency` |
| `CapacityRecord` | `programId` | `[programId, academic_year]` | `spots_available` |
| `RankingRecord` | `programId` | `[programId, academic_year, ranking_name]` | `rank`, `ranking_name` |
| `SchoolStatsRecord` | `schoolId` | `[schoolId, academic_year]` | `total_students`, `total_alumni`, `partner_companies`, etc. |
| `AccreditationRecord` | `schoolId` | `[schoolId, accreditation_name]` | `accreditation_name`, `year_obtained`, `is_active` |

### 3.4. Zone Buffer — ContributionInbox

```prisma
model ContributionInbox {
  id                     String   @id @default(uuid())
  source_type            String   // "User_Submission" | "Automated_AI"
  schoolId               String?  // FK optionnelle — niveau école
  campusId               String?  // FK optionnelle — niveau campus
  programId              String?  // FK optionnelle — niveau programme
  user_text              String?
  urls                   String[]
  ai_category            String   // Voir tableau ci-dessous
  ai_extracted_json      Json?    // JSONB PostgreSQL
  status                 String   @default("Pending_AI")
  year_assumed           Boolean  @default(false)
  data_conflict_warning  Boolean  @default(false)
  program_name_mismatch  Boolean  @default(false)
  createdAt              DateTime @default(now())
}
```

**Valeurs de `ai_category` :**

| Catégorie | Niveau FK requis | Phase | Description |
|---|---|---|---|
| `Program_Discovery` | schoolId | Phase 1 | Découverte des campus et programmes |
| `Pricing` | schoolId + campusId + programId | Phase 2 | Tarifs de scolarité |
| `Ranking` | schoolId + programId | Phase 2 | Classements médias |
| `Capacity` | schoolId + campusId + programId | Phase 2 | Places disponibles |
| `SchoolStats` | schoolId | Phase 2 | Statistiques école |
| `Accreditation` | schoolId | Phase 2 | Accréditations |

**Valeurs de `status` :**

| Statut | Description |
|---|---|
| `Pending_AI` | En attente de traitement par le pipeline IA |
| `Pending_Admin` | Traité par l'IA, en attente de validation humaine |
| `Validated` | Validé et transféré dans les tables de production |
| `Rejected` | Rejeté par l'Admin |

### 3.5. ~~Suivi du Cron — CronTarget~~ *(Supprimé)*

> **Note :** Le modèle `CronTarget` a été supprimé du projet. Le pipeline Tavily Research est suffisamment intelligent pour naviguer autour des obstacles. Les échecs de scan sont uniquement logués dans la console. Pas de blacklist.

### 3.6. Authentification — User

```prisma
model User {
  id            String   @id @default(uuid())
  username      String   @unique
  password_hash String   // bcrypt
  role          String   @default("MODERATOR") // "ADMIN" | "MODERATOR"
  createdAt     DateTime @default(now())
}
```

| Rôle | Droits |
|---|---|
| **ADMIN** | Tout + créer/supprimer des modérateurs |
| **MODERATOR** | Tout sauf gestion des utilisateurs |

Pas d'auto-inscription. L'Admin crée les comptes et communique les identifiants.

---

## 4. Stratégie Tavily Research (Pipeline Automatisé)

### 4.1. Tavily Research — Pipeline de Base

Le pipeline automatisé utilise exclusivement l'endpoint **Tavily Research** (mode `pro`) :

| Usage | Mode | Paramètres clés | Coût |
|---|---|---|---|
| **Phase 1 — Cartographie** | `research` (pro) | `input=prompt_dynamique`, `include_domains=[official_domain]`, `output_schema=PHASE1_SCHEMA` | ~15-50 crédits |
| **Phase 2 — Enrichissement** | `research` (pro) | `input=prompt_par_catégorie`, `include_domains=[official_domain]`, `output_schema=CATEGORY_SCHEMA` | ~15-50 crédits |
| **Crowdsourcing** | `extract` | `urls=[url_utilisateur]`, `extract_depth="advanced"` | 1 crédit/5 URLs |

Les prompts dynamiques sont construits par les builders dans `research_prompts.py` :
- `build_phase1_research_input(school_name, domain)`
- `build_pricing_research_input(school_name, campus_name, program_name, academic_year_str, domain)`
- `build_ranking_research_input(...)`
- `build_capacity_research_input(...)`
- `build_school_stats_research_input(...)`
- `build_accreditation_research_input(...)`

Voir `research-pipeline-plan.md` pour les prompts complets et les JSON Schemas.

### 4.2. Key Cycling (Rotation de Clés — Stratégie Greedy)

```python
class TavilyKeyManager:
    def get_active_key(self, required_credits: int = 50) -> str:
        """
        Sélectionne la clé avec assez de crédits restants.
        - Mode 'pro' : required_credits=250 (seuil large pour Research)
        - Mode 'mini' : required_credits=50
        - Crowdsourcing : required_credits=5
        
        Si aucune clé n'a assez de crédits → QuotaExhaustedError
        """
        for key in self.keys:
            remaining = key.credits_limit - key.credits_used
            if not key.exhausted and remaining >= required_credits:
                return key.api_key
        raise QuotaExhaustedError("Toutes les clés Tavily sont épuisées")
```

# Architecture Complète — School Data Pipeline (Partie 2 : Pipeline & Workflows)

> **Version :** 1.0 — 19 mai 2026
> **Continuation de `architecture-1-systeme.md`**

---

## 5. Pipeline IA Automatisé (Workflow B) — Flux Détaillé

### 5.1. Phase 1 : Cartographie (Program Discovery)

**Déclencheur :** Le Cron (APScheduler) détecte qu'une école `ACTIVE` n'a aucun `Campus` en BDD.

**Séquence :**

```
CRON ──► Lire School WHERE campuses.count = 0
       ──► Tavily Research(input=prompt_dynamique, include_domains=[official_domain], output_schema=PHASE1_SCHEMA, model="pro")
       ──► Si output_schema OK → JSON direct
           Sinon → Gemma 26B fallback (conversion texte → JSON)
       ──► INSERT ContributionInbox(ai_category="Program_Discovery", status="Pending_Admin")
       ──► ⏸️ STOP — Attente validation Admin
```

**Prompt Phase 1 (Tavily Research) :**
Voir `research-pipeline-plan.md` §7.1 pour le prompt dynamique complet.

**JSON de sortie attendu (exemple EMLV) :**
```json
{
  "discovered_campuses": [
    {
      "name": "Campus Paris La Défense",
      "city": "Paris",
      "programs": [
        {
          "name": "Programme Grande École",
          "admission_exam": "Concours Sésame",
          "is_alternance_possible": true,
          "is_expatriation_mandatory": true
        },
        {
          "name": "Bachelor Digital & Intelligence Artificielle",
          "admission_exam": null,
          "is_alternance_possible": true,
          "is_expatriation_mandatory": false
        }
      ]
    }
  ],
  "source_urls": ["https://www.emlv.fr/formations/"],
  "confidence_notes": null
}
```

### 5.2. Validation Phase 1 (Super Ticket Admin)

Quand l'Admin ouvre un ticket `Program_Discovery` :
1. Le frontend Next.js parse le `ai_extracted_json` et génère un **formulaire répéteur** pré-rempli
2. L'Admin peut : corriger un nom, modifier un campus, supprimer un programme, en ajouter un, basculer un switch
3. Au clic "Tout valider" → **Transaction Prisma** :
   - Créer/mettre à jour les `Campus` rattachés à la `School`
   - Créer/mettre à jour les `Program` rattachés à chaque `Campus`
   - Marquer le ticket Inbox comme `Validated`
   - Si erreur → rollback complet, rien n'est inséré

### 5.3. Phase 2 : Enrichissement Chirurgical (Deep Dive)

**Déclencheur :** Le Cron détecte qu'une école a des `Program` validés mais des données manquantes dans les tables `_Record`.

**Séquence par catégorie (répétée pour chaque Programme/École) :**

```
CRON ──► Lire Programs WHERE school.status = "ACTIVE"
       ──► Pour chaque (Programme/École, Catégorie) :
           ──► Construire le prompt dynamique (research_prompts.build_*_research_input)
           ──► Tavily Research(input=prompt, include_domains=[official_domain], output_schema=CATEGORY_SCHEMA, model="pro")
           ──► Si output_schema OK → JSON direct
               Sinon → Gemma 26B fallback
           ──► Diff vs table de production (PricingRecord, etc.)
               Si IDENTIQUE → skip silencieux (Edge Case 10)
           ──► INSERT ContributionInbox(status="Pending_Admin")
```

Les JSON Schemas par catégorie sont définis dans `research_schemas.py`. Voir `research-pipeline-plan.md` §8 pour les détails.

---

## 6. Workflow A : Crowdsourcing Utilisateur

### 6.1. Flux UX

```
Utilisateur (non connecté)
    │
    ├─ 1. Sélection École (dropdown, autocomplete)
    │     ↓
    ├─ 2. (Optionnel) Sélection Campus
    │     ↓
    ├─ 3. (Optionnel) Sélection Programme
    │     ↓
    ├─ 4. Choix catégorie(s) — MULTI-SELECT
    │     □ Tarifs  □ Classement  □ Capacité  □ Stats école  □ Accréditation
    │     ↓
    ├─ 5. Texte libre (revendication) + URL(s) source(s)
    │     ↓
    └─ 6. Soumettre
```

**Règles :**
- L'utilisateur ne peut PAS ajouter de nouvelle école
- Le niveau de sélection détermine les FK dans l'Inbox
- Chaque catégorie cochée crée UN ticket Inbox séparé
- Rate limiting par IP (Middleware Vercel) pour contrer l'Edge Case 1

### 6.2. Traitement Backend (Flux de Traitement et Sécurisation)

Pour chaque ticket créé, le traitement asynchrone s'exécute de la manière suivante :
1. **Validation Initiale du Parcours :** Si la catégorie du ticket est `Pricing`, `Ranking` ou `Capacity`, le système vérifie immédiatement qu'un `programId` est renseigné (ticket rattaché à un parcours spécifique). Si ce n'est pas le cas, le traitement lève directement une `GemmaParsingError` et le ticket est rejeté.
2. **Extraction de Page (Tavily) :** Extraction du texte brut de la page web cible. Timeout de 15s maximum. Si le contenu extrait est vide ou inférieur à 50 caractères, une exception `TavilyExtractionError` est levée, et le ticket est immédiatement basculé à `Rejected`.
3. **Vérification de Compatibilité (Gemma 26B) :** Un appel préliminaire de pertinence avec le prompt `CROWDSOURCING_COMPATIBILITY_CHECK` valide si la page contient des données liées à l'école cible pour la catégorie demandée. Le texte extrait est tronqué à 80 000 caractères (aligné sur l'extraction) afin d'inclure le contenu principal situé après les menus de navigation très longs. Le champ `user_text` (note utilisateur) est **strictement exclu** pour prévenir toute injection de prompt. Si incompatible, le ticket est marqué `Rejected` avec la raison écrite dans `ai_extracted_json`.
4. **Extraction Structurée (Gemma 31B) :** Si compatible, Gemma 31B extrait les données structurées selon la catégorie concernée. Le champ `user_text` est à nouveau exclu.
5. **Validation Post-Extraction des Données Obligatoires :**
   - **`Capacity`** : validation que `spots_available` et `academic_year` ne sont pas `null`.
   - **`Ranking`** : validation que `ranking_name`, `rank` et `academic_year` ne sont pas `null`.
   - **`Pricing`** : validation que `academic_year` n'est pas `null` et qu'au moins un des frais de scolarité extraits est non nul.
   - Si une donnée obligatoire manque ou est extraite en tant que `null`, une `GemmaParsingError` est levée.
6. **Statut & Triage des Erreurs :**
   - **Succès :** Mise à jour du statut en `Pending_Admin` avec le JSON extrait (upsert temporaire), prêt pour la validation humaine.
   - **Erreurs API Temporaires (`GemmaAPIError`) :** Si le service API Google GenAI ou le réseau échoue (ex: 429, 500, timeout temporaire), le ticket reste en `Pending_AI` afin d'être re-tenté lors du prochain run du scheduler. Le nombre d'essais LLM par ticket est étendu à 4 tentatives.
   - **Erreurs Permanentes (`GemmaParsingError`, `TavilyExtractionError`) :** Si le format JSON, le lien de parcours ou les clés obligatoires échouent, le ticket est rejeté (`Rejected`) avec les détails de l'erreur enregistrés sous la clé `"parsing_error"` dans `ai_extracted_json`.
7. **Synthèse et Reporting :** À la fin de l'exécution, un rapport complet agrège et affiche dans la console le nombre de tickets validés, en attente (erreurs API), et rejetés.
```

---

## 7. Frontend Next.js — Les 4 Zones

### 7.1. Zone Consultation (Publique)

| Page | Route | Données |
|---|---|---|
| Accueil / Recherche | `/` | Liste des écoles actives |
| Fiche école | `/schools/[id]` | Infos école, campus, stats, accréditations |
| Détail programme | `/schools/[id]/programs/[pid]` | Tarifs, classements, capacité |

**Caching :** `export const revalidate = 3600` (ISR 1h) sur toutes les routes publiques.

### 7.2. Zone Crowdsourcing (Publique)

| Page | Route |
|---|---|
| Formulaire de soumission | `/contribute` |

### 7.3. Zone Documentation API (Publique)

| Page | Route |
|---|---|
| Documentation API REST | `/api-docs` |

### 7.4. Zone Dashboard Admin (Protégée — NextAuth)

| Page | Route | Rôle requis |
|---|---|---|
| Login | `/admin/login` | — |
| Inbox (validation) | `/admin/inbox` | Admin ou Moderator |
| CRUD Écoles | `/admin/schools` | Admin ou Moderator |
| CRUD Campus | `/admin/schools/[id]/campuses` | Admin ou Moderator |
| Monitoring Cron | `/admin/cron` | Admin ou Moderator |
| Gestion Modérateurs | `/admin/users` | **Admin uniquement** |

---

## 8. API REST Publique (v1)

> **Réf. détaillée : `API-rest.md`**

Tous les endpoints sous `/api/v1/`. Données en lecture seule, écoles `ACTIVE` uniquement.
Cache Vercel Edge (ISR 1h). CORS : `Access-Control-Allow-Origin: *`.

### 8.1. Schools (4 endpoints)

| Endpoint | Description | Query Params |
|---|---|---|
| `GET /api/v1/schools` | Liste paginée des écoles actives | `?search=emlv&page=1&limit=20` |
| `GET /api/v1/schools/[id]` | Détail d'une école (infos de base) | — |
| `GET /api/v1/schools/[id]/stats` | Stats de l'école (étudiants, alumni…) | `?year=2025` (optionnel, dernier par défaut) |
| `GET /api/v1/schools/[id]/accreditations` | Accréditations (EQUIS, AACSB…) | — |

### 8.2. Campuses (2 endpoints)

| Endpoint | Description | Query Params |
|---|---|---|
| `GET /api/v1/schools/[id]/campuses` | Liste des campus d'une école | — |
| `GET /api/v1/campuses/[id]` | Détail d'un campus + ses programmes | — |

### 8.3. Programs (3 endpoints)

| Endpoint | Description | Query Params |
|---|---|---|
| `GET /api/v1/schools/[id]/programs` | Tous les programmes de l'école (tous campus) | `?campus_id=xxx` |
| `GET /api/v1/programs/[id]` | Détail d'un programme spécifique | — |
| `GET /api/v1/programs` | Recherche globale de programmes (toutes écoles) | `?search=pge&admission_exam=sesame&alternance=true` |

### 8.4. Pricing (2 endpoints)

| Endpoint | Description | Query Params |
|---|---|---|
| `GET /api/v1/programs/[id]/pricing` | Historique tarifaire d'un programme | `?year=2025` |
| `GET /api/v1/schools/[id]/pricing` | Tous les tarifs de l'école (tous programmes) | `?year=2025` |

### 8.5. Rankings (2 endpoints)

| Endpoint | Description | Query Params |
|---|---|---|
| `GET /api/v1/programs/[id]/rankings` | Classements d'un programme | `?year=2025&ranking_name=Figaro` |
| `GET /api/v1/rankings` | Tableau global de classements par média/année | `?ranking_name=Figaro&year=2025&page=1&limit=50` |

### 8.6. Capacity (1 endpoint)

| Endpoint | Description | Query Params |
|---|---|---|
| `GET /api/v1/programs/[id]/capacity` | Historique des places d'un programme | `?year=2025` |

### 8.7. Compare (1 endpoint)

| Endpoint | Description | Query Params |
|---|---|---|
| `GET /api/v1/compare/programs` | Comparer N programmes côte à côte (tarifs, classements, capacité) | `?ids=uuid1,uuid2,uuid3` (max 5) |

### 8.8. Erreurs standardisées

| Code | Cas |
|---|---|
| `400 Bad Request` | Paramètres invalides (ex: compare avec > 5 IDs) |
| `404 Not Found` | ID inexistant ou école non ACTIVE |
| `500 Internal Server Error` | Erreur backend inattendue |

Format : `{ "error": "Description" }`

**Tables exclues de toute réponse :** `ContributionInbox`, `CronTarget`, `User`.

---

## 9. Tableau des Edge Cases et Mitigations

| # | Edge Case | Mitigation | Réf. fichier |
|---|---|---|---|
| 1 | DDoS Tavily (quota épuisé) | Rate limiting IP Vercel + validation URL | `edgecase.md` |
| 2 | Données temporelles ambiguës | `academic_year` obligatoire, rejet si < année courante | `edgecase.md` |
| 2.1 | Aucune date sur la page | `year_assumed = true`, Admin averti | `edgecase.md` |
| 3 | Prix complexes (par année vs global) | `year_X_fee` + `total_fee`, jamais de lissage IA | `edgecase.md` |
| 4 | Boucle infinie données inaccessibles | `CronTarget.failed_attempts_count` → blacklist après 3 | `edgecase.md` |
| 5 | Sources contradictoires | `data_conflict_warning = true` + domaines d'autorité | `edgecase.md` |
| 6 | Renommage de programme | `program_name_mismatch = true` + recherche sémantique | `edgecase.md` |
| 7 | Rate limit Google/Gemma (429) | Retry avec backoff exponentiel (`base_delay * (1.5 ** (attempt - 1))`) + distinction `GemmaAPIError` (Pending_AI) vs `GemmaParsingError` (Rejected) | `edgecase.md` |
| 8 | Frais cachés | `additional_fees_notes` (texte libre) | `edgecase.md` |
| 9 | Tableaux Markdown cassés | Ignorer la source, passer à la suivante | `edgecase.md` |
| 10 | Inbox inondée (doublons) | Diff vs production avant insertion | `edgecase.md` |
| 11 | Paywalls / Modales cookies | Gemma détecte le blocage → skip silencieux | `edgecase.md` |
| 12 | Ambiguïté devise (UE vs intl) | Colonnes `intl_*` séparées | `edgecase.md` |
| 13 | Prompt Injection / Fake News | Délimiteurs `<TEXTE_SOURCE>`, whitelist domaines, isolation totale du commentaire utilisateur `user_text` des invites de l'IA | `edgecase.md` |
| 14 | Timeout / réponse vide Tavily | Timeout 15s, body < 50 chars = échec (`TavilyExtractionError`) → statut `Rejected` immédiat | `edgecase.md` |
| 15 | Cold Start Koyeb | Retry frontend + healthcheck `/health` | `edgecase.md` |
| 16 | Faux-négatifs compatibilité (menus longs) | Augmentation de la limite de troncature à 80 000 caractères pour le tri de compatibilité afin de couvrir le contenu principal | `processor.py` |
| 17 | Timeout transaction Prisma (validation) | Exécution parallèle des upserts (Promise.all) + timeout de 60s pour gérer les imports très volumineux (ex: EDHEC avec 9 campus et 30+ programmes) | `app/api/admin/inbox/[id]/validate/route.ts` |

---

## 10. Sécurité

### 10.1. Anti-Injection IA
Tous les contenus scrapés sont encadrés par des délimiteurs stricts :
```
<TEXTE_SOURCE>
{contenu_scrapé}
</TEXTE_SOURCE>
```
Le system prompt interdit formellement d'obéir à toute instruction trouvée dans ce bloc.

### 10.2. Validation des domaines
- **Rankings :** Whitelist stricte (`lefigaro.fr`, `letudiant.fr`, `sigem.org`, `leparisien.fr`)
- **Pricing/Capacity :** Restreint au `official_domain` de l'école
- **Crowdsourcing :** Validation format `https://` + rate limiting IP

### 10.3. Protection DB
- API REST publique : cache ISR 1h (quasi-zéro charge DB)
- Endpoints internes FastAPI : token partagé en header
- Dashboard Admin : NextAuth session obligatoire
- Suppression école : double confirmation frontend

### 10.4. Contraintes Gemma et Gestion d'Erreurs Robuste
- **Pydantic interdit** avec les modèles Gemma (erreur 500)
- JSON forcé via prompt strict "100% Prompting"
- Nettoyage manuel des balises Markdown (````json`)
- Validation structurelle des clés JSON côté Python
- `temperature = 0.1` pour limiter les hallucinations
- **Gestion d'exceptions typées :** Implémentation d'une hiérarchie d'exceptions dans `gemma_client.py` (`GemmaError`, `GemmaAPIError` pour les échecs réseau/API temporaires, `GemmaParsingError` pour les erreurs structurelles de réponse ou JSON invalide).
- **Décodage tolérant :** Détection automatique et extraction du premier dictionnaire si Gemma encapsule sa réponse dans une liste JSON (`[ { ... } ]`), évitant un échec de parsing erroné.
- **Sécurisation des boucles de scan :** Dans `phase1.py` et `phase2.py`, les appels LLM sont encadrés par des blocs `try...except GemmaError` au niveau de chaque école et programme pour éviter qu'une défaillance temporaire sur une entité ne fasse crasher l'ensemble du run périodique.

---

## 11. Glossaire des Décisions Architecturales

| Décision | Choix | Raison |
|---|---|---|
| Campus entre School et Program | Modèle `Campus` dédié | Gestion propre des multi-campus avec tarifs différenciés |
| Phase 1 → Phase 2 | Blocage strict (validation obligatoire) | Garantir que seuls des programmes confirmés sont enrichis |
| Découverte des campus | Hybride (auto IA + manuel Admin) | Flexibilité : l'IA détecte, l'Admin corrige ou complète |
| ContributionInbox | Table unique avec `ai_category` étendu | Évite la duplication de tables, frontend adaptatif |
| Crowdsourcing | Sélection en arborescence, multi-catégorie | Pas de dette technique, pas de nouvelles écoles par les users |
| Catégorie de donnée | Choisie par l'utilisateur (pas l'IA) | Plus fiable, simplifie le routage du prompt |
| Tavily Phase 1 | `crawl` | Économique (~1 crédit/10 pages), explore tout le site |
| Tavily Phase 2 | `search` avec `include_raw_content` | Ciblé par domaine, contenu brut pour Gemma |
| Tavily Workflow A | `extract` | URL connue, le moins cher (1 crédit/5 URLs) |
| Communication services | DB partagée + API interne minimale | Simple, chaque service fait ce qu'il sait faire |
| Auth | NextAuth Credentials, 2 rôles | Admin crée les modérateurs, pas d'auto-inscription |
| Frontend | 4 zones (consultation, crowdsourcing, API docs, admin) | Séparation claire des responsabilités |
| Isolation du `user_text` | Affichage uniquement passif sur le Dashboard Admin | Sécurité absolue face aux injections de prompts indirectes |
| Traitement Crowdsourcing asynchrone | Triage des erreurs (`Pending_AI` vs `Rejected`) | Évite de bloquer ou perdre les contributions utilisateurs en cas de pannes d'API ou de réseau |
| Unwrapping des Listes JSON | Retrait automatique du conteneur `[ { ... } ]` | Résout les anomalies de formatage mineures générées par le modèle |
