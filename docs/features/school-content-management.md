# Plan d'Implémentation — Gestion Complète du Contenu des Écoles

<!-- audit-2026-09-01 -->
> ## ⚠️ Amendements — remédiation de l'audit, 1er septembre 2026
>
> **Chaque route admin choisit désormais explicitement son garde.** Les 32 routes
> sous `app/api/admin/` ont été recartographiées ; `getServerSession` nu n'y
> subsiste nulle part.
>
> Pour la gestion de contenu décrite dans ce document, la règle est :
>
> | Action | Garde |
> |---|---|
> | Créer une école | **ADMIN** |
> | Supprimer une école, un campus, un programme *(cascade)* | **ADMIN** |
> | Créer / modifier tarifs, classements, capacités, accréditations, stats, campus | toute session |
> | Supprimer **un enregistrement isolé** (une ligne de tarif, un classement…) | toute session |
> | Purger l'inbox | **ADMIN** |
>
> Le principe : *un MODERATOR modère la donnée, un ADMIN assume l'irréversible.*
> Une suppression en cascade détruit des dizaines d'enregistrements ; corriger une
> ligne fausse est du travail de modération.
>
> **Validation vers la production** — trois règles s'ajoutent :
> - upsert et passage à `Validated` dans **une seule transaction** ;
> - le ticket n'est clos **que si une donnée a réellement été écrite** ;
> - une capacité n'est jamais écrite sans campus identifiable.
>
> **Une capacité de 0 place est une donnée valide** (formation fermée). Le
> contrôle `!data.spots_available` la rejetait comme manquante ; il teste
> désormais `== null`.
>
> **Modèle de données** : voir [`bdd.md`](../architecture/bdd.md), remis en phase
> avec le refactor `Program` (un programme appartient à une **école**, les campus
> passent par `ProgramCampus`, la capacité est portée par `programCampusId`).
>
> **Dette connue non traitée** : l'interface d'administration recourt largement à
> `as any` — une soixantaine d'occurrences — ce qui neutralise localement le
> `strict: true` du `tsconfig.json`. `npm run lint` les compte.


> **Version :** 1.0 — 27 juillet 2026  
> **Statut :** En attente de validation  
> **Objectif :** Créer une nouvelle page admin `/admin/schools/[id]/manage` avec navigation par onglets pour gérer la totalité du contenu d'une école (infos de base, accréditations, statistiques, campus, programmes, tarifs, classements, capacités).

---

## 1. Contexte et Problème

### 1.1. État Actuel

L'interface admin actuelle pour gérer les écoles est très limitée :

| Page | Capacités actuelles | Manques |
|---|---|---|
| `/admin/schools` | CRUD nom + domaine officiel + statut | Pas de vue sur le contenu, pas de lien vers la gestion approfondie |
| `/admin/schools/[id]/campuses` | CRUD nom + ville des campus | Pas de gestion des programmes, tarifs, rankings, capacités |

**Aucune interface n'existe** pour gérer manuellement :
- Les **programmes** (`Program`) et leurs associations campus (`ProgramCampus`)
- Les **tarifs** (`PricingRecord`) — par programme × année
- Les **classements** (`RankingRecord`) — par programme × année × nom ranking
- Les **capacités** (`CapacityRecord`) — par programme-campus × année
- Les **statistiques école** (`SchoolStatsRecord`) — par école × année
- Les **accréditations** (`AccreditationRecord`) — par école

Aujourd'hui, ces données ne peuvent être insérées que via le pipeline IA automatisé (Phase 1/2) ou le crowdsourcing (validation Inbox). **L'admin n'a aucun moyen d'ajouter, modifier ou supprimer manuellement ces données.**

### 1.2. Objectif

Créer une page admin complète et ergonomique `admin/schools/[id]/manage` avec **7 onglets** permettant la gestion CRUD intégrale de tout le contenu rattaché à une école.

---

## 2. Décisions Architecturales

### 2.1. Choix de Navigation

**Page dédiée** `/admin/schools/[id]/manage` avec navigation par **onglets internes** (tabs).

**Justification :** L'ampleur des données (7 tables, des dizaines de champs, des relations imbriquées) exige une page dédiée avec suffisamment d'espace. Les modals ne suffisent pas pour des formulaires aussi complexes (ex: PricingRecord avec 12+ champs).

### 2.2. Approche Programme-Centric

Les programmes sont gérés au niveau de l'**école** (pas du campus), conformément au modèle de données refactorisé (`Program.schoolId`). L'association aux campus se fait via des **checkboxes** (table `ProgramCampus`).

### 2.3. Sélecteur d'Année Académique Global

Un sélecteur d'année académique visible dans les onglets temporels (Stats, Tarifs, Rankings, Capacités) avec :
- Possibilité d'**ajouter une nouvelle année**
- **Copier les données** d'une année précédente (duplication en masse)
- Par défaut : afficher l'année la plus récente disponible

### 2.4. Impact sur l'Existant

- La page `/admin/schools` **reste inchangée**, mais on y ajoute un bouton `⚙️ Gérer le contenu` dans les actions de chaque école.
- La page `/admin/schools/[id]/campuses` **reste accessible** comme avant (lien "N campus" dans la liste).
- La nouvelle page `/admin/schools/[id]/manage` coexiste sans conflit.

---

## 3. Architecture des Onglets

```
┌───────────────────────────────────────────────────────────────────────┐
│  ← Retour aux écoles          EMLV — Gestion du contenu             │
│  emlv.fr | ACTIVE                                                    │
├──────────┬──────────────┬────────┬───────────────────┬───────┬───────┤
│  📋 Infos │ 🏅 Accrédita.│ 📊 Stats│ 🏫 Campus & Prog. │ 💰 Tarifs│ 🏆 Class.│ 📈 Capacités│
├──────────┴──────────────┴────────┴───────────────────┴───────┴───────┤
│                                                                       │
│                    [Contenu de l'onglet sélectionné]                  │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### 3.1. Onglet 1 — Infos École (`📋`)

**Données gérées :** `School` (name, official_domain, status)

**Interface :**
- Formulaire inline pré-rempli avec les données actuelles
- Champs : Nom, Domaine officiel, Statut (dropdown: ACTIVE / INACTIVE / DRAFT)
- Bouton "Enregistrer les modifications"

**Comportement :**
- PUT `/api/admin/schools/[id]` (route existante, étendue pour accepter `status`)
- Feedback : toast de succès / erreur

---

### 3.2. Onglet 2 — Accréditations (`🏅`)

**Données gérées :** `AccreditationRecord` (schoolId)

**Interface :**
- Liste des accréditations existantes sous forme de **cards compactes**
- Chaque card affiche : nom, type (international/state/label), année d'obtention, statut actif/inactif
- Bouton "➕ Ajouter une accréditation" → formulaire inline ou modal compact
- Actions par card : Modifier (inline edit) | Supprimer (avec confirmation)

**Formulaire d'ajout/édition :**
| Champ | Type | Requis | Description |
|---|---|---|---|
| `accreditation_name` | text | ✅ | ex: "EQUIS", "AACSB", "AMBA", "CTI" |
| `accreditation_type` | select | ✅ | "international" / "state" / "label" |
| `year_obtained` | number | ✅ | Année d'obtention |
| `is_active` | toggle | ✅ | Accréditation encore active ? |

**Routes API :**
- `GET /api/admin/schools/[id]/accreditations` → liste
- `POST /api/admin/schools/[id]/accreditations` → créer
- `PUT /api/admin/accreditations/[id]` → modifier
- `DELETE /api/admin/accreditations/[id]` → supprimer

---

### 3.3. Onglet 3 — Statistiques École (`📊`)

**Données gérées :** `SchoolStatsRecord` (schoolId, academic_year)

**Interface :**
- **Sélecteur d'année académique** en haut (ex: 2025, 2024, 2023...)
  - Dropdown avec toutes les années existantes + option "➕ Nouvelle année"
  - Bouton "📋 Copier depuis..." pour dupliquer les données d'une autre année
- Formulaire avec tous les champs de la table :

| Champ | Type | Label affiché |
|---|---|---|
| `total_students` | number | Nombre total d'étudiants |
| `total_alumni` | number | Nombre total de diplômés |
| `partner_companies` | number | Entreprises partenaires |
| `annual_internship_offers` | number | Offres de stage annuelles |
| `abroad_campuses` | number | Campus à l'étranger |
| `partner_universities` | number | Universités partenaires |
| `permanent_professors` | number | Professeurs permanents |
| `international_professors_pct` | number (0-100) | % professeurs internationaux |
| `external_speakers_pct` | number (0-100) | % intervenants externes |

- Bouton "Enregistrer" → upsert

**Routes API :**
- `GET /api/admin/schools/[id]/stats?year=YYYY` → récupérer (toutes les années si pas de year, une année spécifique sinon)
- `PUT /api/admin/schools/[id]/stats` → upsert (body contient `academic_year` + champs)
- `DELETE /api/admin/schools/[id]/stats/[recordId]` → supprimer une année spécifique

---

### 3.4. Onglet 4 — Campus & Programmes (`🏫`)

**Données gérées :** `Campus`, `Program`, `ProgramCampus`

C'est l'onglet le plus complexe. Il combine la gestion des campus ET des programmes dans une vue unifiée.

**Interface — Zone Campus (haut) :**
- Liste horizontale de cards pour chaque campus (Nom + Ville)
- Bouton "➕ Ajouter un campus" → modal compact
- Actions par campus : Modifier | Supprimer (cascade)

**Interface — Zone Programmes (bas) :**
- **Table** listant tous les programmes de l'école
- Colonnes : Nom | Concours d'entrée | Alternance ? | Expatriation ? | Campus associés | Actions
- La colonne "Campus associés" affiche des **checkboxes** pour chaque campus de l'école
  - Cocher/décocher = créer/supprimer un `ProgramCampus`
  - Indicateur visuel (badge compteur) du nombre de campus associés
- Bouton "➕ Ajouter un programme" → modal avec les champs suivants :

| Champ | Type | Requis | Description |
|---|---|---|---|
| `name` | text | ✅ | Nom du programme |
| `admission_exam` | text | ❌ | Concours d'entrée |
| `is_alternance_possible` | toggle | ✅ | Alternance possible ? |
| `is_expatriation_mandatory` | toggle | ✅ | Expatriation obligatoire ? |
| `min_expatriation_months` | number | ❌ | Durée min expatriation (mois) |
| `max_internship_months` | number | ❌ | Durée max stage (mois) |
| Campus associés | checkboxes | ✅ (≥1) | Sélection des campus |

- Actions par programme : Modifier | Supprimer (avec avertissement cascade)

**Routes API :**

*Campus* (routes existantes, aucune modification requise) :
- `GET /api/admin/schools/[id]/campuses` → liste (existe)
- `POST /api/admin/schools/[id]/campuses` → créer (existe)
- `PUT /api/admin/campuses/[id]` → modifier (existe)
- `DELETE /api/admin/campuses/[id]` → supprimer (existe)

*Programmes* (nouvelles routes) :
- `GET /api/admin/schools/[id]/programs` → liste avec ProgramCampus inclus
- `POST /api/admin/schools/[id]/programs` → créer programme + associations campus
- `PUT /api/admin/programs/[id]` → modifier programme + mettre à jour associations campus
- `DELETE /api/admin/programs/[id]` → supprimer programme (cascade)

---

### 3.5. Onglet 5 — Tarifs (`💰`)

**Données gérées :** `PricingRecord` (programId, academic_year)

**Interface :**
- **Sélecteur d'année académique** (même pattern que Stats)
- **Sélecteur de programme** (dropdown avec tous les programmes de l'école)
  - Option "Tous les programmes" pour vue d'ensemble
- **Vue d'ensemble (Tous les programmes) :**
  - Table récapitulative : Programme | Total Fee | Year 1 | Year 2 | ... | Intl Total | Notes
  - Chaque ligne est cliquable pour éditer
- **Vue détaillée (Un programme sélectionné) :**
  - Formulaire complet avec tous les champs de PricingRecord :

| Champ | Type | Label |
|---|---|---|
| `year_1_fee` | number | Frais Année 1 (€) |
| `year_2_fee` | number | Frais Année 2 (€) |
| `year_3_fee` | number | Frais Année 3 (€) |
| `year_4_fee` | number | Frais Année 4 (€) |
| `year_5_fee` | number | Frais Année 5 (€) |
| `total_fee` | number | Frais Totaux (€) |
| `intl_year_1_fee` | number | Frais Année 1 International |
| `intl_total_fee` | number | Frais Totaux International |
| `intl_currency` | text | Devise internationale |
| `currency` | text | Devise (EUR par défaut) |
| `additional_fees_notes` | textarea | Notes frais additionnels |
| `source_url` | text | URL source |

- Bouton "Enregistrer" → upsert `PricingRecord`

**Routes API :**
- `GET /api/admin/schools/[id]/pricing?year=YYYY&programId=xxx` → tarifs filtrés
- `PUT /api/admin/programs/[id]/pricing` → upsert (body contient `academic_year` + champs)
- `DELETE /api/admin/pricing/[id]` → supprimer un enregistrement tarifaire

---

### 3.6. Onglet 6 — Classements (`🏆`)

**Données gérées :** `RankingRecord` (programId, academic_year, ranking_name)

**Interface :**
- **Sélecteur d'année académique** (même pattern)
- **Sélecteur de programme** (dropdown)
- **Table des classements :**
  - Colonnes : Programme | Nom du classement | Rang | Source | Actions
  - Bouton "➕ Ajouter un classement" → modal/formulaire inline

| Champ | Type | Requis | Description |
|---|---|---|---|
| `programId` | select | ✅ | Programme concerné |
| `ranking_name` | text | ✅ | ex: "Le Figaro", "SIGEM", "Le Parisien", "FT" |
| `rank` | number | ✅ | Position dans le classement |
| `academic_year` | number | ✅ | Année académique |
| `source_url` | text | ❌ | URL de la source |

**Routes API :**
- `GET /api/admin/schools/[id]/rankings?year=YYYY&programId=xxx` → classements filtrés
- `POST /api/admin/programs/[id]/rankings` → créer
- `PUT /api/admin/rankings/[id]` → modifier
- `DELETE /api/admin/rankings/[id]` → supprimer

---

### 3.7. Onglet 7 — Capacités (`📈`)

**Données gérées :** `CapacityRecord` (programCampusId, academic_year)

**Interface :**
- **Sélecteur d'année académique** (même pattern)
- **Table par programme × campus :**
  - Colonnes : Programme | Campus | Places disponibles | Source | Actions
  - Uniquement les combinaisons existantes dans `ProgramCampus`
  - Bouton "➕ Ajouter une capacité" → formulaire avec sélection programme-campus
  - Edit inline pour modification rapide des nombres

| Champ | Type | Requis |
|---|---|---|
| `programCampusId` | select (programme + campus) | ✅ |
| `spots_available` | number | ✅ |
| `academic_year` | number | ✅ |
| `source_url` | text | ❌ |

**Routes API :**
- `GET /api/admin/schools/[id]/capacities?year=YYYY` → capacités avec détail program + campus
- `POST /api/admin/program-campuses/[id]/capacity` → créer
- `PUT /api/admin/capacities/[id]` → modifier
- `DELETE /api/admin/capacities/[id]` → supprimer

---

## 4. Inventaire Complet des Fichiers

### 4.1. Fichiers à MODIFIER

| Fichier | Modification |
|---|---|
| `app/admin/schools/page.tsx` | Ajouter bouton "⚙️ Gérer le contenu" dans les actions de chaque école |
| `app/api/admin/schools/[id]/route.ts` | Étendre le GET pour inclure les counts (programs, accreditations, stats) + accepter `status` dans le PUT |
| `app/globals.css` | Ajouter les styles pour le système d'onglets, les cards d'accréditation, les formulaires inline |

### 4.2. Fichiers à CRÉER — Frontend

| Fichier | Description |
|---|---|
| `app/admin/schools/[id]/manage/page.tsx` | Page principale — layout avec onglets + chargement données école |
| `app/admin/schools/[id]/manage/tabs/SchoolInfoTab.tsx` | Onglet 1 — Formulaire infos école |
| `app/admin/schools/[id]/manage/tabs/AccreditationsTab.tsx` | Onglet 2 — CRUD accréditations |
| `app/admin/schools/[id]/manage/tabs/StatsTab.tsx` | Onglet 3 — CRUD stats par année |
| `app/admin/schools/[id]/manage/tabs/CampusProgramsTab.tsx` | Onglet 4 — Gestion campus + programmes |
| `app/admin/schools/[id]/manage/tabs/PricingTab.tsx` | Onglet 5 — CRUD tarifs par programme × année |
| `app/admin/schools/[id]/manage/tabs/RankingsTab.tsx` | Onglet 6 — CRUD classements |
| `app/admin/schools/[id]/manage/tabs/CapacitiesTab.tsx` | Onglet 7 — CRUD capacités |
| `app/admin/schools/[id]/manage/components/YearSelector.tsx` | Composant réutilisable — sélecteur d'année + copie |
| `app/admin/schools/[id]/manage/components/ProgramSelector.tsx` | Composant réutilisable — dropdown programme |

### 4.3. Fichiers à CRÉER — API Routes

| Fichier | Méthodes | Description |
|---|---|---|
| `app/api/admin/schools/[id]/manage/route.ts` | GET | Endpoint agrégé : école + counts complets (programmes, campus, accreditations, stats, etc.) |
| `app/api/admin/schools/[id]/accreditations/route.ts` | GET, POST | Liste + création accréditations |
| `app/api/admin/accreditations/[id]/route.ts` | PUT, DELETE | Modification + suppression accréditation |
| `app/api/admin/schools/[id]/programs/route.ts` | GET, POST | Liste programmes + associations campus | 
| `app/api/admin/programs/[id]/route.ts` | PUT, DELETE | Modification + suppression programme |
| `app/api/admin/schools/[id]/stats/route.ts` | GET, PUT | Liste stats + upsert par année |
| `app/api/admin/schools/[id]/stats/[recordId]/route.ts` | DELETE | Supprimer une année de stats |
| `app/api/admin/schools/[id]/pricing/route.ts` | GET | Liste tarifs de l'école (tous programmes) |
| `app/api/admin/programs/[id]/pricing/route.ts` | PUT | Upsert tarif programme |
| `app/api/admin/pricing/[id]/route.ts` | DELETE | Supprimer un tarif |
| `app/api/admin/schools/[id]/rankings/route.ts` | GET | Liste classements de l'école |
| `app/api/admin/programs/[id]/rankings/route.ts` | POST | Créer classement programme |
| `app/api/admin/rankings/[id]/route.ts` | PUT, DELETE | Modifier/supprimer classement |
| `app/api/admin/schools/[id]/capacities/route.ts` | GET | Liste capacités de l'école |
| `app/api/admin/program-campuses/[id]/capacity/route.ts` | POST | Créer capacité |
| `app/api/admin/capacities/[id]/route.ts` | PUT, DELETE | Modifier/supprimer capacité |

---

## 5. Spécifications Techniques Détaillées

### 5.1. Page Principale — `manage/page.tsx`

```tsx
// Structure de la page
"use client";

// 1. Charger les données de l'école via GET /api/admin/schools/[id]/manage
// 2. Afficher l'en-tête (nom école, domaine, statut, breadcrumb)
// 3. Barre d'onglets (tabs) avec état actif géré par useState
// 4. Rendre le composant d'onglet actif en passant les données nécessaires
// 5. Chaque tab gère son propre loading/error/CRUD indépendamment
```

**Pattern de chargement :**
- Le page.tsx charge les données initiales de l'école (infos de base + counts)
- Chaque onglet charge ses propres données au montage (`useEffect`)
- Les onglets ne sont pas montés tant qu'ils ne sont pas sélectionnés (lazy loading)

### 5.2. Endpoint Agrégé — `GET /api/admin/schools/[id]/manage`

Retourne un objet enrichi pour alimenter le header et les compteurs :

```json
{
  "id": "uuid",
  "name": "EMLV",
  "official_domain": "emlv.fr",
  "status": "ACTIVE",
  "_counts": {
    "campuses": 2,
    "programs": 5,
    "accreditations": 3,
    "statsYears": [2024, 2025],
    "pricingRecords": 8,
    "rankingRecords": 12,
    "capacityRecords": 6
  }
}
```

### 5.3. YearSelector — Composant Réutilisable

```tsx
interface YearSelectorProps {
  availableYears: number[];       // Années existantes en BDD
  selectedYear: number | null;    // Année sélectionnée
  onYearChange: (year: number) => void;
  onAddYear: (year: number) => void;
  onCopyYear?: (fromYear: number, toYear: number) => void;
}
```

**Comportement :**
1. Dropdown avec les années existantes + option "➕ Nouvelle année" en bas
2. Clic sur "Nouvelle année" → input number (pré-rempli année courante)
3. Bouton "📋 Copier depuis..." → modal de sélection année source → duplication en masse
4. L'année la plus récente est sélectionnée par défaut

### 5.4. Pattern de Formulaire Inline

Pour les onglets à formulaire unique (Infos, Stats) :
- Les champs sont directement éditables (pas de mode lecture/écriture séparé)
- Bouton "Enregistrer" en bas du formulaire
- État modifié détecté (dirty check) pour avertir avant navigation
- Feedback via toast ou alert de succès

### 5.5. Pattern de Table CRUD

Pour les onglets à table (Accréditations, Programmes, Tarifs, Rankings, Capacités) :
- Table avec les données existantes
- Bouton "➕ Ajouter" en haut → ouvre un modal ou une ligne d'ajout
- Actions par ligne : Modifier (ouvre modal pré-rempli) | Supprimer (confirmation)
- Pas de pagination (le volume est faible par école, ~50 entrées max)

### 5.6. Styles Onglets — CSS

Ajouter au `globals.css` les classes suivantes :

```css
/* Tabs System */
.tabs-container { ... }
.tabs-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--border-color); ... }
.tab-button { ... }
.tab-button.active { color: var(--accent); border-bottom: 2px solid var(--accent); ... }
.tab-content { padding: 32px 0; ... }

/* Accreditation Cards */
.accreditation-card { ... }
.accreditation-badge { ... }

/* Inline Form */
.inline-form { ... }
.inline-form-actions { ... }

/* Year Selector */
.year-selector { ... }
```

---

## 6. Sécurité et Validation

### 6.1. Authentification

Toutes les routes API admin utilisent le même pattern existant :
```typescript
const session = await getServerSession(authOptions);
if (!session) {
  return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
}
```

Alternative (plus propre, utilisé dans `schools-with-programs`) :
```typescript
import { guardAuth } from "@/lib/auth";
const { error } = await guardAuth();
if (error) return error;
```

> **Décision :** Utiliser `guardAuth()` pour toutes les nouvelles routes (pattern plus récent et plus propre).

### 6.2. Validation des Données

- **Nom d'accréditation :** non vide, trim, contrainte unique `[schoolId, accreditation_name]`
- **Année académique :** nombre entier ≥ 2000 et ≤ année courante + 2
- **Tarifs :** au moins un des champs fee non null
- **Classement :** `rank` ≥ 1, `ranking_name` non vide
- **Capacité :** `spots_available` ≥ 0
- **Programme :** `name` non vide, au moins 1 campus associé
- **Unicité :** vérifier les contraintes `@@unique` avant chaque insertion

### 6.3. Suppressions

- **Accréditation/Stats/Tarifs/Rankings/Capacités :** Suppression simple avec confirmation dialog
- **Programme :** Avertissement "Cela supprimera aussi les tarifs, classements et capacités associés" (cascade Prisma)
- **Campus :** Avertissement "Cela supprimera aussi les associations ProgramCampus et les capacités" (cascade Prisma)

---

## 7. Plan d'Exécution Détaillé — Tâches Complètes

> **INSTRUCTIONS POUR L'AGENT IA DÉVELOPPEUR :**
> - Chaque tâche est numérotée `Phase.Étape` (ex: `0.1`, `1.3`).
> - Exécuter les phases **dans l'ordre**. Ne pas passer à la Phase N+1 sans avoir terminé et vérifié la Phase N.
> - Chaque fichier à créer a un **squelette de code** avec les imports exacts, la structure attendue, et les patterns à suivre.
> - Les tests de chaque phase sont dans la **Section 9** — les exécuter systématiquement.
> - En cas de doute sur un pattern, consulter les fichiers de référence indiqués.

### Conventions obligatoires pour toutes les routes API

```typescript
// ═══════════════════════════════════════════════════════════
// TEMPLATE DE BASE — À REPRODUIRE POUR CHAQUE ROUTE API
// ═══════════════════════════════════════════════════════════

// Imports obligatoires :
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";

// Guard d'authentification (PREMIÈRE ligne de chaque handler) :
const { error } = await guardAuth();
if (error) return error;

// Extraction des params dynamiques (Next.js 15 — params est une Promise) :
const { id } = await params;

// Pattern d'erreur standardisé :
return NextResponse.json({ error: "Message descriptif en français" }, { status: 4XX });

// Pattern de succès création :
return NextResponse.json(data, { status: 201 });

// Pattern de succès lecture/modification :
return NextResponse.json(data);

// Try/catch obligatoire avec log console :
try {
  // ...
} catch (err) {
  console.error("ROUTE_NAME error:", err);
  return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
}
```

**Fichier de référence pour le pattern API :** `app/api/admin/schools-with-programs/route.ts`

### Conventions obligatoires pour tous les composants frontend

```tsx
// ═══════════════════════════════════════════════════════════
// TEMPLATE DE BASE — COMPOSANT ONGLET
// ═══════════════════════════════════════════════════════════

// Pas de "use client" dans les onglets — seul le page.tsx parent est "use client"
// Les onglets reçoivent les données et callbacks en props

interface TabProps {
  schoolId: string;
  // + données spécifiques au tab
}

export default function NomTab({ schoolId }: TabProps) {
  const [data, setData] = useState(/* type */);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { fetchData(); }, []);

  // Pattern fetch :
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/endpoint`);
      if (!res.ok) throw new Error("Erreur de chargement");
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Pattern CRUD action :
  const handleCreate = async (formData: FormData) => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/...`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur");
      // Fermer modal, reset form, re-fetch
      fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Rendu :
  // - Utiliser les classes CSS existantes : .table-container, .admin-table, .btn, .btn-primary, .modal-overlay, .modal, .form-group, .form-control, .form-label, .alert, .alert-danger
  // - Utiliser les variables CSS : var(--accent), var(--text-secondary), var(--bg-secondary), var(--border-color), etc.
  // - Voir globals.css pour toutes les classes disponibles
}
```

**Fichier de référence pour les composants :** `app/admin/schools/page.tsx` (pattern modal + CRUD), `app/admin/schools/[id]/campuses/page.tsx` (pattern avec params dynamiques)

---

### Phase 0 — Préparation CSS + Composants Partagés

#### Tâche 0.1 — Ajouter les styles d'onglets dans `globals.css`

**Fichier :** `app/globals.css`
**Action :** Ajouter les classes CSS suivantes **à la fin du fichier**, avant aucun autre sélecteur existant :

```css
/* ========================================================
   MANAGE PAGE — Système d'onglets + composants partagés
   ======================================================== */

/* En-tête de la page manage */
.manage-header {
  margin-bottom: 32px;
}

.manage-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.manage-school-name {
  font-size: 1.6rem;
  font-weight: 700;
  color: #ffffff;
}

.manage-school-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.manage-school-meta code {
  color: var(--accent);
  background: rgba(59, 130, 246, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.82rem;
}

/* Navigation par onglets */
.tabs-nav {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.tabs-nav::-webkit-scrollbar {
  display: none;
}

.tab-button {
  padding: 14px 20px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: var(--transition-fast);
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: inherit;
}

.tab-button:hover {
  color: var(--text-primary);
  background-color: rgba(255, 255, 255, 0.02);
}

.tab-button.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.tab-content {
  padding: 32px 0;
}

/* Section titre dans un onglet */
.tab-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.tab-section-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #ffffff;
}

/* Formulaire inline (onglets Infos, Stats) */
.inline-form {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 28px;
}

.inline-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.inline-form-actions {
  margin-top: 28px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--border-color);
}

/* Cards compactes (accréditations) */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.data-card {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 20px;
  transition: var(--transition-fast);
}

.data-card:hover {
  border-color: var(--border-hover);
}

.data-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.data-card-title {
  font-size: 1rem;
  font-weight: 600;
  color: #ffffff;
}

.data-card-actions {
  display: flex;
  gap: 6px;
}

.data-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.82rem;
  color: var(--text-secondary);
}

/* Year Selector */
.year-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
  padding: 16px 20px;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.year-selector label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.year-selector select {
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: inherit;
  cursor: pointer;
}

.year-selector select:focus {
  outline: none;
  border-color: var(--accent);
}

/* Badge type (accréditation) */
.badge-type-international {
  background-color: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
}

.badge-type-state {
  background-color: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.badge-type-label {
  background-color: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}

/* Toggle switch (alternance, expatriation) */
.toggle-container {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-switch {
  position: relative;
  width: 40px;
  height: 22px;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 11px;
  cursor: pointer;
  transition: var(--transition-fast);
}

.toggle-switch.active {
  background-color: var(--accent);
  border-color: var(--accent);
}

.toggle-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background-color: #ffffff;
  border-radius: 50%;
  transition: var(--transition-fast);
}

.toggle-switch.active::after {
  left: 20px;
}

/* Checkbox campus (Programme-Campus associations) */
.campus-checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.campus-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  color: var(--text-primary);
  cursor: pointer;
  transition: var(--transition-fast);
}

.campus-checkbox.checked {
  background-color: var(--accent-glow);
  border-color: var(--accent);
  color: var(--accent);
}

.campus-checkbox input[type="checkbox"] {
  accent-color: var(--accent);
}

/* Alert succès */
.alert-success {
  background-color: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

/* Compteur badge dans les onglets */
.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  font-size: 0.7rem;
  font-weight: 600;
  background-color: var(--bg-tertiary);
  border-radius: 50px;
  color: var(--text-secondary);
}

.tab-button.active .tab-count {
  background-color: var(--accent-glow);
  color: var(--accent);
}
```

**Vérification :** Le fichier `globals.css` ne doit avoir aucune erreur de syntaxe CSS. Les nouvelles classes ne doivent pas entrer en conflit avec les classes existantes (vérifier visuellement qu'aucun nom de classe n'est déjà utilisé).

---

#### Tâche 0.2 — Créer `YearSelector.tsx`

**Fichier à créer :** `app/admin/schools/[id]/manage/components/YearSelector.tsx`

**Ce composant est utilisé par :** StatsTab, PricingTab, RankingsTab, CapacitiesTab.

**Structure attendue :**

```tsx
"use client";

import { useState } from "react";

interface YearSelectorProps {
  availableYears: number[];           // Années existantes en BDD, triées desc
  selectedYear: number | null;        // Année actuellement sélectionnée
  onYearChange: (year: number) => void;  // Callback quand on change d'année
  onCopyYear?: (fromYear: number, toYear: number) => void;  // Callback optionnel copie
  loading?: boolean;                  // Désactiver pendant le chargement
}

export default function YearSelector({
  availableYears,
  selectedYear,
  onYearChange,
  onCopyYear,
  loading = false
}: YearSelectorProps) {
  const [isAddingYear, setIsAddingYear] = useState(false);
  const [newYear, setNewYear] = useState(new Date().getFullYear());
  const [isCopying, setIsCopying] = useState(false);
  const [copySourceYear, setCopySourceYear] = useState<number | null>(null);

  // Rendu :
  // 1. Un <select> avec les availableYears (chaque option = année)
  // 2. Un bouton "➕ Nouvelle année" qui bascule vers un input number
  //    - L'input est pré-rempli avec l'année courante
  //    - Boutons "Ajouter" / "Annuler"
  //    - Au clic "Ajouter" → appeler onYearChange(newYear) pour sélectionner la nouvelle année
  // 3. Si onCopyYear est fourni : un bouton "📋 Copier depuis..."
  //    - Au clic → afficher un <select> avec les availableYears comme source
  //    - Au clic "Copier" → appeler onCopyYear(sourceYear, selectedYear)
  //
  // Utiliser les classes CSS : .year-selector, .btn, .btn-primary, .btn-secondary, .form-control
}
```

**Comportements clés :**
- Par défaut, `selectedYear` est `availableYears[0]` (le plus récent)
- Si `availableYears` est vide, afficher uniquement le bouton "➕ Nouvelle année"
- Le bouton "Copier" n'est visible que si `onCopyYear` est passé ET qu'il y a ≥ 1 année existante ET que `selectedYear` est non-null
- L'input "Nouvelle année" valide que l'année est ≥ 2000 et ≤ année courante + 2
- Tout est désactivé si `loading === true`

---

#### Tâche 0.3 — Créer `ProgramSelector.tsx`

**Fichier à créer :** `app/admin/schools/[id]/manage/components/ProgramSelector.tsx`

**Ce composant est utilisé par :** PricingTab, RankingsTab.

**Structure attendue :**

```tsx
"use client";

interface ProgramOption {
  id: string;
  name: string;
}

interface ProgramSelectorProps {
  programs: ProgramOption[];         // Liste des programmes de l'école
  selectedProgramId: string | null;  // null = "Tous les programmes"
  onProgramChange: (programId: string | null) => void;
  showAllOption?: boolean;           // Afficher l'option "Tous les programmes" (true par défaut)
  loading?: boolean;
}

export default function ProgramSelector({
  programs,
  selectedProgramId,
  onProgramChange,
  showAllOption = true,
  loading = false
}: ProgramSelectorProps) {
  // Rendu :
  // 1. Un <select> avec :
  //    - Si showAllOption : première option "Tous les programmes" (value="")
  //    - Puis chaque programme (value=program.id, label=program.name)
  // 2. Au changement → appeler onProgramChange(value || null)
  //
  // Styles : un <select> avec className="form-control" et style={{ maxWidth: "300px" }}
}
```

---

### Phase 1 — Page Principale + Onglet Infos

#### Tâche 1.1 — Créer `GET /api/admin/schools/[id]/manage`

**Fichier à créer :** `app/api/admin/schools/[id]/manage/route.ts`

**Méthode :** GET uniquement.

**Code complet attendu :**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await guardAuth();
  if (error) return error;

  const { id } = await params;

  try {
    const school = await prisma.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            campuses: true,
            programs: true,
            accreditations: true,
            statsRecords: true,
          }
        }
      }
    });

    if (!school) {
      return NextResponse.json({ error: "École introuvable" }, { status: 404 });
    }

    // Counts additionnels via queries séparées (PricingRecord, RankingRecord, CapacityRecord passent par Program/ProgramCampus)
    const [pricingCount, rankingCount, capacityCount] = await Promise.all([
      prisma.pricingRecord.count({ where: { program: { schoolId: id } } }),
      prisma.rankingRecord.count({ where: { program: { schoolId: id } } }),
      prisma.capacityRecord.count({ where: { programCampus: { campus: { schoolId: id } } } }),
    ]);

    // Collecter les années académiques distinctes pour les stats
    const statsYears = await prisma.schoolStatsRecord.findMany({
      where: { schoolId: id },
      select: { academic_year: true },
      orderBy: { academic_year: "desc" },
    });

    return NextResponse.json({
      ...school,
      _counts: {
        campuses: school._count.campuses,
        programs: school._count.programs,
        accreditations: school._count.accreditations,
        statsRecords: school._count.statsRecords,
        pricingRecords: pricingCount,
        rankingRecords: rankingCount,
        capacityRecords: capacityCount,
        statsYears: statsYears.map(s => s.academic_year),
      }
    });
  } catch (err) {
    console.error(`GET /api/admin/schools/${id}/manage error:`, err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
```

---

#### Tâche 1.2 — Étendre `PUT /api/admin/schools/[id]` pour accepter `status`

**Fichier à modifier :** `app/api/admin/schools/[id]/route.ts`

**Modification dans la fonction PUT :**
- Actuellement, le PUT n'accepte que `name` et `official_domain`.
- Ajouter `status` au destructuring du body : `const { name, official_domain, status } = body;`
- Ajouter la validation du status : si `status` est fourni, vérifier qu'il est dans `["ACTIVE", "INACTIVE", "DRAFT"]`, sinon retourner 400.
- Ajouter `status` au `data` si fourni : `if (status) data.status = status;`
- La condition de body vide doit vérifier les 3 champs : `if (!name && !official_domain && !status)`

**Ne pas toucher** au GET ni au DELETE de ce fichier.

---

#### Tâche 1.3 — Créer la page principale `manage/page.tsx`

**Fichier à créer :** `app/admin/schools/[id]/manage/page.tsx`

**C'est le fichier le plus important de tout le projet.** Il contient :
1. Le layout avec l'en-tête de l'école
2. La barre d'onglets
3. Le lazy-loading des composants de chaque onglet

**Structure attendue :**

```tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

// Importer les 7 onglets
import SchoolInfoTab from "./tabs/SchoolInfoTab";
import AccreditationsTab from "./tabs/AccreditationsTab";
import StatsTab from "./tabs/StatsTab";
import CampusProgramsTab from "./tabs/CampusProgramsTab";
import PricingTab from "./tabs/PricingTab";
import RankingsTab from "./tabs/RankingsTab";
import CapacitiesTab from "./tabs/CapacitiesTab";

// Typer les données de l'école
interface SchoolManageData {
  id: string;
  name: string;
  official_domain: string;
  status: string;
  _counts: {
    campuses: number;
    programs: number;
    accreditations: number;
    statsRecords: number;
    pricingRecords: number;
    rankingRecords: number;
    capacityRecords: number;
    statsYears: number[];
  };
}

// Liste des onglets avec label et emoji
const TABS = [
  { key: "info", label: "Infos", icon: "📋" },
  { key: "accreditations", label: "Accréditations", icon: "🏅" },
  { key: "stats", label: "Statistiques", icon: "📊" },
  { key: "campus-programs", label: "Campus & Programmes", icon: "🏫" },
  { key: "pricing", label: "Tarifs", icon: "💰" },
  { key: "rankings", label: "Classements", icon: "🏆" },
  { key: "capacities", label: "Capacités", icon: "📈" },
] as const;

type TabKey = typeof TABS[number]["key"];

export default function ManagePage() {
  const { id: schoolId } = useParams() as { id: string };
  const [school, setSchool] = useState<SchoolManageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("info");

  useEffect(() => { fetchSchool(); }, [schoolId]);

  const fetchSchool = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/manage`);
      if (!res.ok) throw new Error("Impossible de charger les données de l'école");
      const data = await res.json();
      setSchool(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fonction pour obtenir le count à afficher dans chaque onglet (badge compteur)
  const getTabCount = (key: TabKey): number | null => {
    if (!school) return null;
    switch (key) {
      case "accreditations": return school._counts.accreditations;
      case "stats": return school._counts.statsRecords;
      case "campus-programs": return school._counts.programs;
      case "pricing": return school._counts.pricingRecords;
      case "rankings": return school._counts.rankingRecords;
      case "capacities": return school._counts.capacityRecords;
      default: return null;
    }
  };

  // Rendu du contenu de l'onglet actif (lazy loading — un seul monté à la fois)
  const renderTab = () => {
    if (!school) return null;
    switch (activeTab) {
      case "info":
        return <SchoolInfoTab schoolId={schoolId} school={school} onSchoolUpdate={fetchSchool} />;
      case "accreditations":
        return <AccreditationsTab schoolId={schoolId} />;
      case "stats":
        return <StatsTab schoolId={schoolId} />;
      case "campus-programs":
        return <CampusProgramsTab schoolId={schoolId} />;
      case "pricing":
        return <PricingTab schoolId={schoolId} />;
      case "rankings":
        return <RankingsTab schoolId={schoolId} />;
      case "capacities":
        return <CapacitiesTab schoolId={schoolId} />;
    }
  };

  // UI :
  // 1. Lien "← Retour aux écoles" (Link vers /admin/schools) — utiliser la classe .back-link existante dans campuses/page.tsx
  // 2. En-tête : Nom de l'école (h1) + domaine (code) + badge statut (badge badge-active)
  // 3. Barre d'onglets (.tabs-nav) avec les boutons (.tab-button / .tab-button.active)
  //    - Chaque bouton affiche : icon + label + badge compteur (si count > 0)
  // 4. Zone contenu (.tab-content) avec le rendu du tab actif
  // 5. Si loading : message de chargement centré
  // 6. Si error : alert alert-danger
}
```

**Points critiques :**
- Le `page.tsx` est le seul fichier `"use client"` — les onglets sont importés directement (pas de dynamic import nécessaire car le volume est faible).
- Chaque onglet reçoit `schoolId` en prop. L'onglet `info` reçoit aussi l'objet `school` et un callback `onSchoolUpdate`.
- `fetchSchool()` est partagé : quand un onglet modifie des données qui affectent les counts (ex: ajout programme), il peut appeler `fetchSchool()` via une prop optionnelle `onDataChange`.

---

#### Tâche 1.4 — Créer `SchoolInfoTab.tsx`

**Fichier à créer :** `app/admin/schools/[id]/manage/tabs/SchoolInfoTab.tsx`

**Données gérées :** `School.name`, `School.official_domain`, `School.status`

**Comportement :**
- Formulaire inline (.inline-form) pré-rempli avec les valeurs actuelles de `school`
- 3 champs :
  - `name` : input text, requis
  - `official_domain` : input text, requis
  - `status` : `<select>` avec options "ACTIVE", "INACTIVE", "DRAFT"
- Bouton "Enregistrer les modifications" → `PUT /api/admin/schools/${schoolId}` avec le body `{ name, official_domain, status }`
- Après succès : afficher une alerte succès temporaire (3s) + appeler `onSchoolUpdate()` pour rafraîchir le header

**Props :**
```tsx
interface SchoolInfoTabProps {
  schoolId: string;
  school: { name: string; official_domain: string; status: string };
  onSchoolUpdate: () => void;
}
```

**Structure :** Utiliser `.inline-form` + `.inline-form-grid` + `.inline-form-actions` (classes CSS créées en Phase 0).

---

#### Tâche 1.5 — Ajouter le bouton "Gérer le contenu" dans la liste des écoles

**Fichier à modifier :** `app/admin/schools/page.tsx`

**Modification :**
Dans le JSX de chaque ligne de la table (le `{filteredSchools.map(...)}`), dans la cellule "Actions" (le `<div>` avec les boutons Modifier/Supprimer), ajouter un **nouveau bouton avant** les boutons existants :

```tsx
<Link
  href={`/admin/schools/${school.id}/manage`}
  className="btn btn-primary btn-sm"
  style={{ padding: "6px 12px" }}
>
  ⚙️ Gérer le contenu
</Link>
```

**Import à ajouter :** `Link` est déjà importé en haut du fichier (utilisé pour le lien campus).

**Résultat visuel :** Chaque ligne de la table aura 3 boutons : `⚙️ Gérer le contenu` (bleu, primary) | `Modifier` (gris, secondary) | `Supprimer` (rouge, danger)

---

### Phase 2 — Onglet Accréditations

#### Tâche 2.1 — Créer `GET + POST /api/admin/schools/[id]/accreditations`

**Fichier à créer :** `app/api/admin/schools/[id]/accreditations/route.ts`

**Méthode GET :**
- Guard auth avec `guardAuth()`
- Extraire `id` des params (le schoolId)
- Vérifier que l'école existe (`prisma.school.findUnique({ where: { id } })`) → 404 si null
- Query : `prisma.accreditationRecord.findMany({ where: { schoolId: id }, orderBy: { accreditation_name: "asc" } })`
- Retourner le tableau JSON

**Méthode POST :**
- Guard auth
- Extraire `id` des params
- Parser le body : `{ accreditation_name, accreditation_type, year_obtained, is_active }`
- Validations :
  - `accreditation_name` : requis, non vide après trim → 400 si manquant
  - `accreditation_type` : requis, doit être dans `["international", "state", "label"]` → 400 sinon
  - `year_obtained` : requis, nombre entier ≥ 2000 et ≤ année courante + 2 → 400 sinon
  - `is_active` : optionnel, booléen, défaut `true`
- Vérifier l'école existe → 404
- Vérifier unicité `[schoolId, accreditation_name]` :
  ```typescript
  const existing = await prisma.accreditationRecord.findUnique({
    where: { schoolId_accreditation_name: { schoolId: id, accreditation_name: cleanName } }
  });
  if (existing) return NextResponse.json({ error: "Cette accréditation existe déjà pour cette école" }, { status: 400 });
  ```
- Créer : `prisma.accreditationRecord.create({ data: { schoolId: id, accreditation_name: cleanName, accreditation_type, year_obtained: parseInt(year_obtained), is_active } })`
- Retourner 201 avec l'objet créé

---

#### Tâche 2.2 — Créer `PUT + DELETE /api/admin/accreditations/[id]`

**Fichier à créer :** `app/api/admin/accreditations/[id]/route.ts`

**Méthode PUT :**
- Guard auth
- Extraire `id` des params (l'ID de l'AccreditationRecord, PAS le schoolId)
- Parser le body : `{ accreditation_name?, accreditation_type?, year_obtained?, is_active? }`
- Vérifier que le record existe : `prisma.accreditationRecord.findUnique({ where: { id } })` → 404 si null
- Si `accreditation_name` change, vérifier unicité `[schoolId, new_accreditation_name]` (en excluant le record actuel)
- Construire l'objet `data` avec uniquement les champs fournis
- Mettre à jour : `prisma.accreditationRecord.update({ where: { id }, data })`
- Retourner le record mis à jour

**Méthode DELETE :**
- Guard auth
- Extraire `id` des params
- Vérifier que le record existe → 404 si null
- Supprimer : `prisma.accreditationRecord.delete({ where: { id } })`
- Retourner `{ message: "Accréditation supprimée avec succès" }`

---

#### Tâche 2.3 — Créer `AccreditationsTab.tsx`

**Fichier à créer :** `app/admin/schools/[id]/manage/tabs/AccreditationsTab.tsx`

**Interface :**
- En-tête avec titre "Accréditations" + bouton "➕ Ajouter une accréditation"
- Grille de cards (.cards-grid) affichant chaque accréditation :
  - Titre : `accreditation_name` (ex: "EQUIS")
  - Badges : type (utiliser `.badge-type-international` / `.badge-type-state` / `.badge-type-label`) + statut actif/inactif
  - Méta : "Obtenue en YYYY"
  - Actions : bouton "Modifier" + bouton "Supprimer"
- Modal d'ajout/édition : formulaire avec les 4 champs (name, type dropdown, year, toggle actif)
- Modal de suppression : confirmation "Êtes-vous sûr de vouloir supprimer l'accréditation X ?"
- Si aucune accréditation : empty state "Aucune accréditation enregistrée"

**Props :** `{ schoolId: string }`

**Endpoints utilisés :**
- Chargement : `GET /api/admin/schools/${schoolId}/accreditations`
- Ajout : `POST /api/admin/schools/${schoolId}/accreditations`
- Modification : `PUT /api/admin/accreditations/${record.id}`
- Suppression : `DELETE /api/admin/accreditations/${record.id}`

---

### Phase 3 — Onglet Statistiques

#### Tâche 3.1 — Créer `GET + PUT /api/admin/schools/[id]/stats`

**Fichier à créer :** `app/api/admin/schools/[id]/stats/route.ts`

**Méthode GET :**
- Guard auth, extraire `id`
- Lire le query param `year` : `const { searchParams } = new URL(request.url); const year = searchParams.get("year");`
- Récupérer les années disponibles :
  ```typescript
  const allRecords = await prisma.schoolStatsRecord.findMany({
    where: { schoolId: id },
    select: { academic_year: true },
    orderBy: { academic_year: "desc" }
  });
  const availableYears = allRecords.map(r => r.academic_year);
  ```
- Si `year` fourni : récupérer le record spécifique avec `findUnique` via `{ schoolId_academic_year: { schoolId: id, academic_year: parseInt(year) } }`
- Retourner `{ availableYears, record: recordOuNull }`

**Méthode PUT (upsert) :**
- Guard auth, extraire `id`
- Parser le body : `{ academic_year, total_students, total_alumni, partner_companies, annual_internship_offers, abroad_campuses, partner_universities, permanent_professors, international_professors_pct, external_speakers_pct }`
- Validation : `academic_year` requis, entier ≥ 2000 et ≤ année courante + 2
- Vérifier l'école existe → 404
- Construire l'objet `data` avec tous les champs numériques (utiliser `parseInt()` ou `parseFloat()` selon le type, `null` si non fourni)
- Upsert :
  ```typescript
  const record = await prisma.schoolStatsRecord.upsert({
    where: { schoolId_academic_year: { schoolId: id, academic_year } },
    update: data,
    create: { schoolId: id, academic_year, ...data }
  });
  ```
- Retourner le record

---

#### Tâche 3.2 — Créer `DELETE /api/admin/schools/[id]/stats/[recordId]`

**Fichier à créer :** `app/api/admin/schools/[id]/stats/[recordId]/route.ts`

**Méthode DELETE :**
- Guard auth
- Extraire `recordId` des params : `const { recordId } = await params;`
- Vérifier que le record existe : `prisma.schoolStatsRecord.findUnique({ where: { id: recordId } })` → 404
- Vérifier que le record appartient bien à l'école `id` (sécurité) → 403 sinon
- Supprimer : `prisma.schoolStatsRecord.delete({ where: { id: recordId } })`
- Retourner succès

---

#### Tâche 3.3 — Créer `StatsTab.tsx`

**Fichier à créer :** `app/admin/schools/[id]/manage/tabs/StatsTab.tsx`

**Interface :**
- `YearSelector` en haut (importer depuis `../components/YearSelector`)
- Si année sélectionnée et record trouvé : formulaire inline (.inline-form) avec la grille (.inline-form-grid) de 9 champs numériques (voir §3.3 du plan)
- Si année sélectionnée mais pas de record : formulaire vide (champs à null) — le PUT créera le record via upsert
- Bouton "Enregistrer" dans .inline-form-actions
- Bouton "🗑️ Supprimer cette année" (danger) — uniquement si le record existe déjà

**Props :** `{ schoolId: string }`

**Fonctions clés :**
- `fetchStats(year?)` : GET endpoint, met à jour `availableYears` et `currentRecord`
- `handleSave()` : PUT endpoint avec l'année sélectionnée + valeurs du formulaire
- `handleDelete()` : DELETE endpoint avec confirmation dialog
- `handleCopyYear(fromYear, toYear)` : GET l'année source, PUT avec l'année cible

---

### Phase 4 — Onglet Campus & Programmes

#### Tâche 4.1 — Créer `GET + POST /api/admin/schools/[id]/programs`

**Fichier à créer :** `app/api/admin/schools/[id]/programs/route.ts`

**Méthode GET :**
- Guard auth, extraire `id` (schoolId)
- Query :
  ```typescript
  const programs = await prisma.program.findMany({
    where: { schoolId: id },
    orderBy: { name: "asc" },
    include: {
      campuses: {
        include: {
          campus: { select: { id: true, name: true, city: true } }
        }
      },
      _count: {
        select: { pricingRecords: true, rankingRecords: true }
      }
    }
  });
  ```
- Formatter la réponse pour aplatir les ProgramCampus :
  ```typescript
  const formatted = programs.map(p => ({
    ...p,
    associatedCampuses: p.campuses.map(pc => ({
      programCampusId: pc.id,
      campusId: pc.campus.id,
      campusName: pc.campus.name,
      campusCity: pc.campus.city,
    })),
  }));
  ```
  Supprimer le champ `campuses` brut de la réponse pour éviter la confusion.
- Retourner le tableau formaté

**Méthode POST :**
- Guard auth, extraire `id` (schoolId)
- Parser le body : `{ name, admission_exam, is_alternance_possible, is_expatriation_mandatory, min_expatriation_months, max_internship_months, campusIds }`
- Validations :
  - `name` : requis, non vide → 400
  - `campusIds` : requis, tableau non vide (≥ 1 campus) → 400
  - Vérifier unicité `[schoolId, name]` → 400 si doublon
  - Vérifier que chaque campusId existe ET appartient à l'école `id` → 400 sinon
- **Transaction Prisma** :
  ```typescript
  const result = await prisma.$transaction(async (tx) => {
    const program = await tx.program.create({
      data: {
        schoolId: id,
        name: name.trim(),
        admission_exam: admission_exam?.trim() || null,
        is_alternance_possible: !!is_alternance_possible,
        is_expatriation_mandatory: !!is_expatriation_mandatory,
        min_expatriation_months: min_expatriation_months ? parseInt(min_expatriation_months) : null,
        max_internship_months: max_internship_months ? parseInt(max_internship_months) : null,
      }
    });

    // Créer les ProgramCampus
    await Promise.all(campusIds.map((campusId: string) =>
      tx.programCampus.create({
        data: { programId: program.id, campusId }
      })
    ));

    return program;
  });
  ```
- Retourner 201 avec le programme créé

---

#### Tâche 4.2 — Créer `PUT + DELETE /api/admin/programs/[id]`

**Fichier à créer :** `app/api/admin/programs/[id]/route.ts`

**Méthode PUT :**
- Guard auth, extraire `id` (programId)
- Parser le body (tous les champs optionnels + `campusIds` optionnel)
- Vérifier que le programme existe : `prisma.program.findUnique({ where: { id } })` → 404
- Si `name` change, vérifier unicité `[schoolId, new_name]`
- **Transaction Prisma** :
  1. Mettre à jour les champs du Programme
  2. Si `campusIds` est fourni :
     - Récupérer les associations actuelles : `prisma.programCampus.findMany({ where: { programId: id } })`
     - Calculer le diff :
       - `toDelete` = campusIds actuels ABSENTS du nouveau tableau
       - `toCreate` = campusIds nouveaux ABSENTS de l'actuel
     - Supprimer les obsolètes : `prisma.programCampus.deleteMany({ where: { programId: id, campusId: { in: toDelete } } })`
     - Créer les nouveaux : `prisma.programCampus.createMany({ data: toCreate.map(...) })`

**Méthode DELETE :**
- Guard auth, extraire `id`
- Vérifier existence → 404
- Supprimer (cascade gérée par Prisma : ProgramCampus, PricingRecord, RankingRecord sont supprimés automatiquement)
- Retourner succès

---

#### Tâche 4.3 — Créer `CampusProgramsTab.tsx`

**Fichier à créer :** `app/admin/schools/[id]/manage/tabs/CampusProgramsTab.tsx`

**C'est l'onglet le plus complexe.** Il a deux zones :

**Zone Campus (haut) :**
- Titre "Campus" + bouton "➕ Ajouter un campus"
- Grille de cards (.cards-grid) pour chaque campus : nom + ville + actions (Modifier / Supprimer)
- Utilise les routes existantes : `GET/POST /api/admin/schools/${schoolId}/campuses` et `PUT/DELETE /api/admin/campuses/${campusId}`
- Modal ajout/édition : 2 champs (nom requis, ville optionnelle)
- Modal suppression : confirmation avec avertissement cascade

**Zone Programmes (bas) :**
- Titre "Programmes" + bouton "➕ Ajouter un programme"
- Table (.admin-table) avec colonnes :
  - Nom (fontWeight: 600)
  - Concours d'entrée (ou "—" si null)
  - Alternance (badge vert "Oui" / gris "Non")
  - Expatriation (badge vert "Oui" / gris "Non")
  - Campus associés : afficher les checkboxes de chaque campus de l'école. Chaque checkbox cochée = ProgramCampus existant.
    - **Au clic sur une checkbox** : mise à jour immédiate via PUT `/api/admin/programs/${programId}` avec le nouveau tableau `campusIds` (ajouter/retirer le campus du tableau)
  - Actions : Modifier | Supprimer
- Modal ajout : formulaire avec 6 champs (voir §3.4) + checkboxes campus
- Modal édition : même formulaire pré-rempli + checkboxes pré-cochées
- Modal suppression : confirmation avec avertissement "Cela supprimera aussi les tarifs, classements et capacités associés à ce programme"

**Props :** `{ schoolId: string }`

**Endpoints utilisés :** 6 endpoints (4 campus existants + 2 programmes nouveaux)

**État :** Charger les campus ET les programmes au montage (`Promise.all` sur les 2 fetches).

---

### Phase 5 — Onglet Tarifs

#### Tâche 5.1 — Créer `GET /api/admin/schools/[id]/pricing`

**Fichier à créer :** `app/api/admin/schools/[id]/pricing/route.ts`

**Méthode GET :**
- Guard auth, extraire `id` (schoolId)
- Lire query params : `year` et `programId`
- Construire le filtre :
  ```typescript
  const where: any = { program: { schoolId: id } };
  if (year) where.academic_year = parseInt(year as string);
  if (programId) where.programId = programId as string;
  ```
- Query :
  ```typescript
  const records = await prisma.pricingRecord.findMany({
    where,
    include: { program: { select: { id: true, name: true } } },
    orderBy: [{ program: { name: "asc" } }, { academic_year: "desc" }]
  });
  ```
- Récupérer les années disponibles :
  ```typescript
  const yearsRaw = await prisma.pricingRecord.findMany({
    where: { program: { schoolId: id } },
    select: { academic_year: true },
    distinct: ["academic_year"],
    orderBy: { academic_year: "desc" }
  });
  const availableYears = yearsRaw.map(r => r.academic_year);
  ```
- Retourner `{ availableYears, records }`

---

#### Tâche 5.2 — Créer `PUT /api/admin/programs/[id]/pricing`

**Fichier à créer :** `app/api/admin/programs/[id]/pricing/route.ts`

**Méthode PUT (upsert) :**
- Guard auth, extraire `id` (programId)
- Parser le body : `{ academic_year, currency, year_1_fee, year_2_fee, year_3_fee, year_4_fee, year_5_fee, total_fee, intl_year_1_fee, intl_total_fee, intl_currency, additional_fees_notes, source_url }`
- Validations :
  - `academic_year` : requis, entier ≥ 2000 → 400
  - Au moins un champ fee non null (year_1_fee OU total_fee OU ...) → 400 si tous null
  - Vérifier que le programme existe → 404
- Construire l'objet `data` : chaque champ fee = `parseInt(value) || null`, textes = `value?.trim() || null`, `currency` = `value || "EUR"`
- Upsert :
  ```typescript
  const record = await prisma.pricingRecord.upsert({
    where: { programId_academic_year: { programId: id, academic_year } },
    update: data,
    create: { programId: id, academic_year, ...data }
  });
  ```
- Retourner le record

---

#### Tâche 5.3 — Créer `DELETE /api/admin/pricing/[id]`

**Fichier à créer :** `app/api/admin/pricing/[id]/route.ts`

**Méthode DELETE :**
- Guard auth, extraire `id` (pricingRecordId)
- Vérifier existence → 404
- Supprimer
- Retourner succès

---

#### Tâche 5.4 — Créer `PricingTab.tsx`

**Fichier à créer :** `app/admin/schools/[id]/manage/tabs/PricingTab.tsx`

**Interface :**
- `YearSelector` (haut gauche) + `ProgramSelector` (haut droite)
- **Si "Tous les programmes" sélectionné :**
  - Table récapitulative : Programme | Total € | A1 | A2 | A3 | A4 | A5 | Intl Total | Actions
  - Chaque ligne = un PricingRecord pour l'année sélectionnée
  - Si un programme n'a pas de PricingRecord pour l'année → ne pas afficher la ligne (ou afficher "—")
  - Bouton "Modifier" par ligne → bascule vers la vue détaillée (sélectionne le programme)
- **Si un programme spécifique sélectionné :**
  - Formulaire inline (.inline-form) avec les 12 champs (voir §3.5)
  - Grille 3 colonnes pour les fees (year_1 à year_5 + total sur une ligne, intl_ sur une autre)
  - Champs texte en pleine largeur (additional_fees_notes, source_url)
  - Bouton "Enregistrer" + "🗑️ Supprimer" (si le record existe déjà)
- Si aucun programme n'existe : empty state "Aucun programme enregistré. Créez des programmes dans l'onglet Campus & Programmes."

**Props :** `{ schoolId: string }`

**Chargement initial :** Fetch les programmes de l'école (`GET /api/admin/schools/${schoolId}/programs` — pour alimenter le ProgramSelector) + fetch les tarifs.

---

### Phase 6 — Onglet Classements

#### Tâche 6.1 — Créer `GET /api/admin/schools/[id]/rankings`

**Fichier à créer :** `app/api/admin/schools/[id]/rankings/route.ts`

**Méthode GET :**
- Guard auth, extraire `id` (schoolId)
- Lire query params : `year` et `programId`
- Construire le filtre :
  ```typescript
  const where: any = { program: { schoolId: id } };
  if (year) where.academic_year = parseInt(year as string);
  if (programId) where.programId = programId as string;
  ```
- Query :
  ```typescript
  const records = await prisma.rankingRecord.findMany({
    where,
    include: { program: { select: { id: true, name: true } } },
    orderBy: [{ program: { name: "asc" } }, { ranking_name: "asc" }]
  });
  ```
- Récupérer les années distinctes (même pattern que Tâche 5.1)
- Retourner `{ availableYears, records }`

---

#### Tâche 6.2 — Créer `POST /api/admin/programs/[id]/rankings`

**Fichier à créer :** `app/api/admin/programs/[id]/rankings/route.ts`

**Méthode POST :**
- Guard auth, extraire `id` (programId)
- Parser le body : `{ ranking_name, rank, academic_year, source_url }`
- Validations :
  - `ranking_name` : requis, non vide → 400
  - `rank` : requis, entier ≥ 1 → 400
  - `academic_year` : requis, entier ≥ 2000 → 400
  - Vérifier que le programme existe → 404
  - Vérifier unicité `[programId, academic_year, ranking_name]` :
    ```typescript
    const existing = await prisma.rankingRecord.findUnique({
      where: { programId_academic_year_ranking_name: { programId: id, academic_year, ranking_name: ranking_name.trim() } }
    });
    ```
    → 400 si doublon : "Un classement avec ce nom existe déjà pour ce programme et cette année"
- Créer le record
- Retourner 201

---

#### Tâche 6.3 — Créer `PUT + DELETE /api/admin/rankings/[id]`

**Fichier à créer :** `app/api/admin/rankings/[id]/route.ts`

**Méthode PUT :**
- Guard auth, extraire `id` (rankingRecordId)
- Parser le body (champs optionnels)
- Vérifier existence → 404
- Si `ranking_name` ou `academic_year` change → vérifier la nouvelle unicité `[programId, academic_year, ranking_name]`
- Mettre à jour avec `prisma.rankingRecord.update()`

**Méthode DELETE :**
- Guard auth, extraire `id`
- Vérifier existence → 404
- Supprimer
- Retourner succès

---

#### Tâche 6.4 — Créer `RankingsTab.tsx`

**Fichier à créer :** `app/admin/schools/[id]/manage/tabs/RankingsTab.tsx`

**Interface :**
- `YearSelector` + `ProgramSelector` en haut
- Bouton "➕ Ajouter un classement"
- Table (.admin-table) : Programme | Nom du classement | Rang | Source | Actions
  - Le rang est affiché avec un badge coloré (ex: top 3 = vert, top 10 = bleu, 10+ = gris)
  - Source = lien cliquable si `source_url` fourni
  - Actions : Modifier | Supprimer
- Modal ajout : 4 champs (programId dropdown requis, ranking_name text requis, rank number requis, source_url optionnel)
  - Si un programme est déjà sélectionné dans le ProgramSelector, le pré-sélectionner dans le modal
  - Si une année est sélectionnée dans le YearSelector, la pré-remplir dans le modal
- Modal édition : même formulaire pré-rempli
- Modal suppression : confirmation

**Props :** `{ schoolId: string }`

---

### Phase 7 — Onglet Capacités

#### Tâche 7.1 — Créer `GET /api/admin/schools/[id]/capacities`

**Fichier à créer :** `app/api/admin/schools/[id]/capacities/route.ts`

**Méthode GET :**
- Guard auth, extraire `id` (schoolId)
- Lire query param `year`
- Construire le filtre — **attention**, la relation passe par `ProgramCampus → Campus → School` :
  ```typescript
  const where: any = {
    programCampus: {
      campus: { schoolId: id }
    }
  };
  if (year) where.academic_year = parseInt(year as string);
  ```
- Query :
  ```typescript
  const records = await prisma.capacityRecord.findMany({
    where,
    include: {
      programCampus: {
        include: {
          program: { select: { id: true, name: true } },
          campus: { select: { id: true, name: true, city: true } }
        }
      }
    },
    orderBy: { academic_year: "desc" }
  });
  ```
- Récupérer les années distinctes
- Retourner `{ availableYears, records }`

---

#### Tâche 7.2 — Créer `POST /api/admin/program-campuses/[id]/capacity`

**Fichier à créer :** `app/api/admin/program-campuses/[id]/capacity/route.ts`

**Méthode POST :**
- Guard auth, extraire `id` (programCampusId)
- Parser le body : `{ spots_available, academic_year, source_url }`
- Validations :
  - `spots_available` : requis, entier ≥ 0 → 400
  - `academic_year` : requis, entier ≥ 2000 → 400
  - Vérifier que le ProgramCampus existe → 404
  - Vérifier unicité `[programCampusId, academic_year]` :
    ```typescript
    const existing = await prisma.capacityRecord.findUnique({
      where: { programCampusId_academic_year: { programCampusId: id, academic_year } }
    });
    ```
    → 400 si doublon
- Créer le record
- Retourner 201

---

#### Tâche 7.3 — Créer `PUT + DELETE /api/admin/capacities/[id]`

**Fichier à créer :** `app/api/admin/capacities/[id]/route.ts`

**Méthode PUT :**
- Guard auth, extraire `id` (capacityRecordId)
- Parser le body (champs optionnels)
- Vérifier existence → 404
- `spots_available` si fourni : entier ≥ 0
- Si `academic_year` change → vérifier unicité
- Mettre à jour

**Méthode DELETE :**
- Guard auth, extraire `id`
- Vérifier existence → 404
- Supprimer
- Retourner succès

---

#### Tâche 7.4 — Créer `CapacitiesTab.tsx`

**Fichier à créer :** `app/admin/schools/[id]/manage/tabs/CapacitiesTab.tsx`

**Interface :**
- `YearSelector` en haut
- Bouton "➕ Ajouter une capacité"
- Table (.admin-table) : Programme | Campus | Places disponibles | Source | Actions
  - Le champ "Places disponibles" peut être édité inline (input number directement dans la cellule, avec sauvegarde au blur ou Enter)
  - Actions : Supprimer
- Modal ajout : 
  - **Sélecteur combiné Programme × Campus** : afficher un `<select>` groupé par programme, avec les campus de chaque programme comme options
    - Format : `<optgroup label="PGE"> <option>Campus Paris La Défense</option> <option>Campus Montpellier</option> </optgroup>`
    - La valeur sélectionnée est le `programCampusId`
  - Champs : `spots_available` (number requis), `academic_year` (pré-rempli), `source_url` (optionnel)
- Modal suppression : confirmation

**Props :** `{ schoolId: string }`

**Chargement initial :** Fetch les capacités + fetch les ProgramCampus de l'école (pour le sélecteur dans le modal d'ajout). Pour obtenir les ProgramCampus, utiliser `GET /api/admin/schools/${schoolId}/programs` et extraire les `associatedCampuses` de chaque programme.

---

## 8. Spécification API Détaillée

> Les spécifications API détaillées sont intégrées directement dans chaque tâche de la Section 7. Cette section ne contient que des rappels de synthèse.

### 8.1. Tableau Récapitulatif des Routes

| Route | Méthodes | Tâche | Description |
|---|---|---|---|
| `GET /api/admin/schools/[id]/manage` | GET | 1.1 | Données école enrichies + counts |
| `PUT /api/admin/schools/[id]` | PUT (modifié) | 1.2 | Ajout du champ `status` |
| `GET/POST /api/admin/schools/[id]/accreditations` | GET, POST | 2.1 | Liste + création accréditations |
| `PUT/DELETE /api/admin/accreditations/[id]` | PUT, DELETE | 2.2 | Modification + suppression |
| `GET/PUT /api/admin/schools/[id]/stats` | GET, PUT | 3.1 | Liste stats + upsert par année |
| `DELETE /api/admin/schools/[id]/stats/[recordId]` | DELETE | 3.2 | Supprimer une année de stats |
| `GET/POST /api/admin/schools/[id]/programs` | GET, POST | 4.1 | Liste programmes + création avec associations |
| `PUT/DELETE /api/admin/programs/[id]` | PUT, DELETE | 4.2 | Modification + suppression programme |
| `GET /api/admin/schools/[id]/pricing` | GET | 5.1 | Liste tarifs filtrables |
| `PUT /api/admin/programs/[id]/pricing` | PUT | 5.2 | Upsert tarif programme |
| `DELETE /api/admin/pricing/[id]` | DELETE | 5.3 | Supprimer tarif |
| `GET /api/admin/schools/[id]/rankings` | GET | 6.1 | Liste classements filtrables |
| `POST /api/admin/programs/[id]/rankings` | POST | 6.2 | Créer classement |
| `PUT/DELETE /api/admin/rankings/[id]` | PUT, DELETE | 6.3 | Modifier/supprimer classement |
| `GET /api/admin/schools/[id]/capacities` | GET | 7.1 | Liste capacités |
| `POST /api/admin/program-campuses/[id]/capacity` | POST | 7.2 | Créer capacité |
| `PUT/DELETE /api/admin/capacities/[id]` | PUT, DELETE | 7.3 | Modifier/supprimer capacité |

---

## 9. Tests Détaillés par Phase

> **INSTRUCTIONS :** Exécuter TOUS les tests de chaque phase avant de passer à la suivante. Chaque test a un résultat attendu précis. Si un test échoue, corriger le code avant de continuer.

### 9.0. Tests Phase 0 — CSS + Composants Partagés

| # | Test | Étapes | Résultat attendu |
|---|---|---|---|
| 0.1 | Build CSS | Lancer `npm run build` | Pas d'erreurs de build. Le fichier `globals.css` est compilé sans erreur. |
| 0.2 | Classes CSS | Inspecter manuellement le CSS ajouté | Aucune classe en doublon avec celles existantes dans `globals.css`. Les variables CSS (`var(--accent)`, etc.) sont toutes définies dans le `:root`. |
| 0.3 | TypeScript composants | Vérifier que `YearSelector.tsx` et `ProgramSelector.tsx` n'ont pas d'erreurs TypeScript | L'IDE ne montre aucune erreur rouge. Les props sont correctement typées. |

---

### 9.1. Tests Phase 1 — Page Principale + Onglet Infos

| # | Test | Étapes | Résultat attendu |
|---|---|---|---|
| 1.1 | API manage GET | Dans le navigateur connecté en admin, aller sur `/api/admin/schools/{ID}/manage` (remplacer {ID} par un vrai ID d'école existante) | Réponse JSON 200 avec les champs : `id`, `name`, `official_domain`, `status`, `_counts` (objet avec `campuses`, `programs`, `accreditations`, etc.). |
| 1.2 | API manage 404 | Aller sur `/api/admin/schools/uuid-inexistant/manage` | Réponse JSON 404 `{ "error": "École introuvable" }` |
| 1.3 | API manage 401 | En navigation privée (non connecté), aller sur `/api/admin/schools/{ID}/manage` | Réponse JSON 401 |
| 1.4 | Bouton liste | Aller sur `/admin/schools` | Chaque ligne de la table a un nouveau bouton bleu "⚙️ Gérer le contenu" dans la colonne Actions, **avant** les boutons Modifier/Supprimer |
| 1.5 | Navigation | Cliquer sur "⚙️ Gérer le contenu" d'une école | Redirection vers `/admin/schools/{ID}/manage`. La page charge sans erreur. L'en-tête affiche le nom de l'école, son domaine, et son statut. |
| 1.6 | Onglets visibles | Sur la page manage | Les 7 onglets sont visibles dans la barre de navigation : Infos, Accréditations, Statistiques, Campus & Programmes, Tarifs, Classements, Capacités. L'onglet "Infos" est actif par défaut. |
| 1.7 | Switching tabs | Cliquer sur chaque onglet | L'onglet cliqué devient actif (style `.tab-button.active`). Le contenu change. Pas d'erreur console. |
| 1.8 | Onglet Infos - affichage | L'onglet Infos est sélectionné | Un formulaire affiche les 3 champs pré-remplis : nom, domaine, statut (dropdown). |
| 1.9 | Onglet Infos - modification nom | Changer le nom de l'école → cliquer "Enregistrer" | Alerte succès. Le nom dans l'en-tête de la page se met à jour. Vérifier dans `/admin/schools` que le nom a changé. **Remettre le nom original après le test.** |
| 1.10 | Onglet Infos - modification statut | Changer le statut en "INACTIVE" → "Enregistrer" | Alerte succès. Le badge statut dans l'en-tête change. **Remettre en ACTIVE après le test.** |
| 1.11 | Onglet Infos - erreur doublon | Changer le nom pour le nom d'une AUTRE école existante → "Enregistrer" | Message d'erreur rouge "Une autre école possède déjà ce nom ou ce domaine officiel" |
| 1.12 | Lien retour | Cliquer sur "← Retour aux écoles" | Redirection vers `/admin/schools` |
| 1.13 | Build | `npm run build` | Pas d'erreurs |

---

### 9.2. Tests Phase 2 — Onglet Accréditations

| # | Test | Étapes | Résultat attendu |
|---|---|---|---|
| 2.1 | Affichage vide | Aller sur l'onglet Accréditations d'une école sans accréditations | Message "Aucune accréditation enregistrée" + bouton "➕ Ajouter" visible |
| 2.2 | Création | Cliquer "➕ Ajouter" → remplir : nom="EQUIS", type="international", année=2020, actif=true → valider | La card "EQUIS" apparaît dans la grille avec le badge type "international" et "Obtenue en 2020" |
| 2.3 | Création 2ème | Ajouter une 2ème accréditation : "AACSB", "international", 2018, true | 2 cards visibles, triées alphabétiquement (AACSB avant EQUIS) |
| 2.4 | Doublon refusé | Tenter d'ajouter à nouveau "EQUIS" | Message d'erreur "Cette accréditation existe déjà pour cette école" |
| 2.5 | Modification | Cliquer "Modifier" sur EQUIS → changer année en 2022 → valider | La card se met à jour : "Obtenue en 2022" |
| 2.6 | Modification nom | Modifier le nom d'EQUIS en "EQUIS (renouvelé)" → valider | Le nom change dans la card |
| 2.7 | Suppression | Cliquer "Supprimer" sur "AACSB" → confirmer | La card disparaît, il ne reste que "EQUIS (renouvelé)" |
| 2.8 | Validation champs vides | Tenter d'ajouter avec nom vide | Erreur 400, message visible à l'utilisateur |
| 2.9 | Validation type invalide | Tenter POST API directement avec `accreditation_type: "invalid"` | Erreur 400 |
| 2.10 | Badge compteur | Vérifier le badge compteur de l'onglet "Accréditations" dans la barre de tabs | Affiche "1" (ou le bon nombre) |
| 2.11 | Build | `npm run build` | Pas d'erreurs |

---

### 9.3. Tests Phase 3 — Onglet Statistiques

| # | Test | Étapes | Résultat attendu |
|---|---|---|---|
| 3.1 | Affichage vide | Aller sur l'onglet Stats d'une école sans stats | Le YearSelector affiche "Aucune année" et le bouton "➕ Nouvelle année" est visible |
| 3.2 | Ajouter année | Cliquer "➕ Nouvelle année" → entrer 2025 → valider | L'année 2025 apparaît dans le sélecteur, elle est auto-sélectionnée. Le formulaire est vide (champs à null). |
| 3.3 | Enregistrer stats | Remplir : total_students=8500, total_alumni=45000 → Enregistrer | Alerte succès. Les valeurs restent affichées. |
| 3.4 | Recharger page | Recharger la page → revenir à l'onglet Stats | L'année 2025 est sélectionnée. Les valeurs 8500 et 45000 sont affichées. |
| 3.5 | Modifier stats | Changer total_students en 9000 → Enregistrer | Succès, la valeur est mise à jour |
| 3.6 | Ajouter 2ème année | Ajouter l'année 2024 → remplir des valeurs différentes → Enregistrer | L'année 2024 apparaît dans le sélecteur. Le formulaire affiche les bonnes valeurs quand on switch. |
| 3.7 | Switch année | Sélectionner 2025 puis 2024 dans le dropdown | Les valeurs changent correctement à chaque switch |
| 3.8 | Copier année | Cliquer "📋 Copier depuis..." → sélectionner 2025 comme source → copier vers 2024 | Les valeurs de 2025 sont copiées dans 2024. Vérifier que les valeurs correspondent. |
| 3.9 | Supprimer année | Cliquer "🗑️ Supprimer cette année" sur 2024 → confirmer | L'année 2024 disparaît du sélecteur. Seul 2025 reste. |
| 3.10 | Validation % | Entrer `international_professors_pct = 150` (> 100) | Le formulaire accepte la saisie (c'est un Float, la validation est souple). Mais vérifier que la valeur est bien sauvée en BDD. |
| 3.11 | Build | `npm run build` | Pas d'erreurs |

---

### 9.4. Tests Phase 4 — Onglet Campus & Programmes

| # | Test | Étapes | Résultat attendu |
|---|---|---|---|
| 4.1 | Affichage campus | Aller sur Campus & Programmes | Les campus existants apparaissent en cards. S'il n'y en a pas, message "Aucun campus". |
| 4.2 | Ajouter campus | Ajouter un campus "Paris" (ville: "Paris") | La card apparaît |
| 4.3 | Ajouter campus 2 | Ajouter un campus "Lyon" (ville: "Lyon") | 2 cards campus |
| 4.4 | Affichage programmes vide | La zone Programmes affiche "Aucun programme" + bouton "➕ Ajouter" | OK |
| 4.5 | Ajouter programme | Cliquer "➕ Ajouter un programme" → remplir : nom="PGE", concours="Sésame", alternance=true, expatriation=true → cocher "Paris" ET "Lyon" → valider | Le programme "PGE" apparaît dans la table avec 2 checkboxes cochées (Paris ✅, Lyon ✅) |
| 4.6 | Décocher campus | Décocher "Lyon" dans les checkboxes du PGE | La checkbox se décoche. Vérifier en BDD que le ProgramCampus Paris-PGE existe mais pas Lyon-PGE. |
| 4.7 | Recocher campus | Recocher "Lyon" | Le ProgramCampus est recréé |
| 4.8 | Doublon programme refusé | Tenter d'ajouter un programme "PGE" (même nom) | Erreur "Un programme avec ce nom existe déjà pour cette école" |
| 4.9 | Programme sans campus | Tenter d'ajouter un programme sans cocher aucun campus | Erreur "Au moins un campus doit être sélectionné" |
| 4.10 | Modifier programme | Modifier le PGE → changer le nom en "Programme Grande École" | La table se met à jour |
| 4.11 | Supprimer campus avec programmes | Supprimer le campus "Lyon" → confirmer | Le campus disparaît. Le PGE n'a plus qu'une checkbox "Paris" (la checkbox Lyon a disparu). |
| 4.12 | Supprimer programme | Supprimer "Programme Grande École" → confirmer (lire l'avertissement cascade) | Le programme disparaît de la table |
| 4.13 | Build | `npm run build` | Pas d'erreurs |

---

### 9.5. Tests Phase 5 — Onglet Tarifs

**Pré-requis :** Au moins 1 programme et 1 campus doivent exister (créés en Phase 4).

| # | Test | Étapes | Résultat attendu |
|---|---|---|---|
| 5.1 | Affichage vide | Aller sur l'onglet Tarifs | Le YearSelector et le ProgramSelector sont visibles. Message "Aucun tarif enregistré" ou table vide. |
| 5.2 | Sélectionner programme | Choisir un programme dans le ProgramSelector | Le formulaire détaillé apparaît (12 champs), vide. |
| 5.3 | Ajouter tarif | Remplir : academic_year=2025, year_1_fee=12500, year_2_fee=13000, total_fee=50000 → Enregistrer | Succès. Les valeurs restent affichées. |
| 5.4 | Vue tous programmes | Sélectionner "Tous les programmes" | La table récapitulative affiche une ligne pour le programme avec les valeurs remplies. |
| 5.5 | Modifier tarif | Re-sélectionner le programme → changer total_fee en 55000 → Enregistrer | Succès, valeur mise à jour |
| 5.6 | Supprimer tarif | Cliquer "🗑️ Supprimer" → confirmer | Le tarif disparaît. Le formulaire repasse en mode vide (création). |
| 5.7 | Validation fee vides | Tenter d'enregistrer avec tous les fees à vide/null | Erreur "Au moins un tarif doit être renseigné" |
| 5.8 | Switch année | Ajouter un tarif pour 2024. Switcher entre 2025 et 2024. | Les valeurs changent selon l'année |
| 5.9 | Build | `npm run build` | Pas d'erreurs |

---

### 9.6. Tests Phase 6 — Onglet Classements

**Pré-requis :** Au moins 1 programme doit exister.

| # | Test | Étapes | Résultat attendu |
|---|---|---|---|
| 6.1 | Affichage vide | Aller sur l'onglet Classements | YearSelector + ProgramSelector visibles. Table vide ou message. |
| 6.2 | Ajouter classement | Cliquer "➕ Ajouter" → programme=PGE, ranking_name="Le Figaro", rank=3, academic_year=2025 → valider | La ligne apparaît dans la table : PGE | Le Figaro | 3 |
| 6.3 | Ajouter 2ème classement | Même programme, ranking_name="SIGEM", rank=5, year=2025 | 2 lignes dans la table |
| 6.4 | Doublon refusé | Tenter d'ajouter "Le Figaro" à nouveau pour PGE 2025 | Erreur "Un classement avec ce nom existe déjà pour ce programme et cette année" |
| 6.5 | Modifier classement | Modifier le rang du Figaro de 3 à 2 | La table se met à jour |
| 6.6 | Supprimer classement | Supprimer "SIGEM" → confirmer | La ligne disparaît |
| 6.7 | Filtre programme | Sélectionner un programme spécifique dans le ProgramSelector | Seuls les classements de ce programme apparaissent |
| 6.8 | Filtre année | Changer l'année dans le YearSelector | Les classements de l'année sélectionnée apparaissent |
| 6.9 | Validation rank | Tenter rank=0 ou rank=-1 | Erreur "Le rang doit être ≥ 1" |
| 6.10 | Build | `npm run build` | Pas d'erreurs |

---

### 9.7. Tests Phase 7 — Onglet Capacités

**Pré-requis :** Au moins 1 programme associé à au moins 1 campus (ProgramCampus existant).

| # | Test | Étapes | Résultat attendu |
|---|---|---|---|
| 7.1 | Affichage vide | Aller sur l'onglet Capacités | YearSelector visible. Table vide ou message. |
| 7.2 | Ajouter capacité | Cliquer "➕ Ajouter" → sélectionner une combinaison Programme × Campus → spots=350, year=2025 → valider | La ligne apparaît : Programme | Campus | 350 |
| 7.3 | Edit inline | Cliquer sur le nombre "350" dans la table → le modifier en 400 → appuyer Enter ou cliquer ailleurs | La valeur se met à jour (appel PUT en background). Pas de modal. |
| 7.4 | Doublon refusé | Tenter d'ajouter une capacité pour la même combinaison Programme-Campus et la même année | Erreur "Une capacité existe déjà pour ce programme-campus et cette année" |
| 7.5 | Supprimer capacité | Cliquer "Supprimer" → confirmer | La ligne disparaît |
| 7.6 | Validation spots négatif | Tenter spots_available=-1 | Erreur "Le nombre de places doit être ≥ 0" |
| 7.7 | Sélecteur combiné | Vérifier que le sélecteur dans le modal d'ajout affiche les programmes groupés avec leurs campus associés | Les options sont groupées par programme, seuls les campus associés à chaque programme apparaissent |
| 7.8 | Build | `npm run build` | Pas d'erreurs |

---

### 9.8. Test Final d'Intégration

| # | Test | Étapes | Résultat attendu |
|---|---|---|---|
| F.1 | Build complet | `npm run build` | Zéro erreurs TypeScript, zéro erreurs de build |
| F.2 | Navigation complète | Depuis `/admin/schools` → cliquer "Gérer le contenu" → naviguer dans les 7 onglets → retour aux écoles | Aucune erreur console, toutes les données chargent |
| F.3 | Cascade suppression programme | Créer un programme avec tarifs + rankings + capacités → Supprimer le programme | Vérifier que les tarifs, rankings et capacités associés ont disparu (vérifier en revenant sur les onglets respectifs) |
| F.4 | Cascade suppression campus | Créer un campus, y associer un programme → Supprimer le campus | Le programme perd l'association, les capacités liées à ce campus sont supprimées |
| F.5 | Cohérence counts | Ajouter plusieurs données (3 accréditations, 2 programmes, 5 tarifs) → vérifier les badges compteurs dans les onglets | Les compteurs correspondent au nombre réel de données |
| F.6 | Reload page | Recharger la page manage avec F5 | Les données rechargent correctement, l'onglet actif revient à "Infos" (comportement par défaut) |
| F.7 | Multi-user | Ouvrir la page manage dans 2 onglets de navigateur → modifier des données dans un onglet → recharger l'autre | Les données sont cohérentes (pas de cache stale) |

---

## 10. Résumé des Livrables

| Catégorie | Nombre de fichiers |
|---|---|
| Pages Frontend (composants React) | 10 fichiers (1 page + 7 tabs + 2 composants) |
| Routes API | 16 fichiers |
| Fichiers modifiés | 3 fichiers |
| **Total** | **29 fichiers** |

**Aucune migration Prisma** n'est nécessaire — le schéma existant couvre déjà tous les modèles (`Program`, `ProgramCampus`, `PricingRecord`, `RankingRecord`, `CapacityRecord`, `SchoolStatsRecord`, `AccreditationRecord`).

**Aucun changement de base de données** — on exploite le schéma existant en y ajoutant l'interface admin qui manquait.
