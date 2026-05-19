# Documentation du Schéma de Base de Données (PostgreSQL / Prisma)

Ce document décrit l'architecture de la base de données relationnelle du projet School Data Pipeline. Il est conçu pour servir de référence aux agents IA et préparer l'intégration future avec l'ORM Prisma.

## 1. Philosophie et Principes Architecturaux

Le schéma repose sur quatre principes fondamentaux :
1. **Séparation des Entités et des Données Temporelles :** Les données immuables (ex: le nom de l'école ou du programme) sont séparées des données qui évoluent chaque année (prix, classements, effectifs). Ces dernières sont stockées dans des tables de type `_Record` avec une colonne `academic_year`.
2. **Standardisation des Programmes :** Il n'y a pas de tables distinctes par type de diplôme (pas de table "Bachelor" ni "PGE"). Tout est un `Program` lié à un `Campus`. Les spécificités métier sont gérées par des attributs (ex: `admission_exam`).
3. **Double Zone (Buffer vs Production) :** Le système intègre une zone tampon (`ContributionInbox`) pour les données brutes issues de l'IA (Workflow B) ou du Crowdsourcing (Workflow A), qui ne rejoignent les tables "Rigides" qu'après validation humaine (Human-in-the-loop).
4. **Architecture Multi-Campus :** Une école possède N campus (ex: "EMLV Paris La Défense", "EMLV Montpellier"). Chaque campus a ses propres programmes et tarifs. Cela évite les confusions quand une même école affiche des prix différents selon la localisation.

## 2. Modèle de Données (Format Prisma)

Voici la modélisation conceptuelle au format Prisma Schema Language (`schema.prisma`), prête à être implémentée.

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ------------------------------------------------------
// AUTHENTIFICATION ET RÔLES
// ------------------------------------------------------

model User {
  id              String   @id @default(uuid())
  username        String   @unique
  password_hash   String
  role            String   @default("MODERATOR") // "ADMIN" ou "MODERATOR"
  createdAt       DateTime @default(now())
}

// Rôles :
// - ADMIN : tous les droits + gestion des modérateurs (créer/supprimer)
// - MODERATOR : mêmes droits que l'Admin sauf la gestion des utilisateurs
// Pas d'auto-inscription. L'Admin crée les comptes et communique les identifiants.

// ------------------------------------------------------
// ENTITÉS PRINCIPALES (Immuables)
// ------------------------------------------------------

model School {
  id              String   @id @default(uuid())
  name            String   @unique
  official_domain String   @unique
  status          String   @default("ACTIVE") // ACTIVE, INACTIVE, DRAFT

  // Relations
  campuses        Campus[]
  statsRecords    SchoolStatsRecord[]
  accreditations  AccreditationRecord[]
  cronTargets     CronTarget[]
}

model Campus {
  id              String   @id @default(uuid())
  schoolId        String
  name            String   // ex: "Campus Paris La Défense", "Campus Montpellier"
  city            String?  // ex: "Paris", "Montpellier"

  // Relations
  school          School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  programs        Program[]

  @@unique([schoolId, name])
}

model Program {
  id                        String   @id @default(uuid())
  campusId                  String
  name                      String   // ex: "Programme Grande École", "Bachelor", "IBBA"
  admission_exam            String?  // ex: "Concours Sésame"
  is_alternance_possible    Boolean  @default(false)
  is_expatriation_mandatory Boolean  @default(false)
  min_expatriation_months   Int?
  max_internship_months     Int?

  // Relations
  campus          Campus            @relation(fields: [campusId], references: [id], onDelete: Cascade)
  pricingRecords  PricingRecord[]
  capacityRecords CapacityRecord[]
  rankingRecords  RankingRecord[]
  cronTargets     CronTarget[]

  @@unique([campusId, name])
}

// ------------------------------------------------------
// TABLES TEMPORELLES "RECORDS" (Données évolutives)
// ------------------------------------------------------

model PricingRecord {
  id                    String  @id @default(uuid())
  programId             String
  academic_year         Int
  currency              String  @default("EUR")
  year_1_fee            Int?
  year_2_fee            Int?
  year_3_fee            Int?
  year_4_fee            Int?
  year_5_fee            Int?
  total_fee             Int?
  intl_year_1_fee       Int?
  intl_total_fee        Int?
  intl_currency         String?
  additional_fees_notes String?
  source_url            String?

  program Program @relation(fields: [programId], references: [id], onDelete: Cascade)

  @@unique([programId, academic_year])
}

model CapacityRecord {
  id              String  @id @default(uuid())
  programId       String
  academic_year   Int
  spots_available Int
  source_url      String?

  program Program @relation(fields: [programId], references: [id], onDelete: Cascade)

  @@unique([programId, academic_year])
}

model RankingRecord {
  id            String  @id @default(uuid())
  programId     String
  academic_year Int
  ranking_name  String  // ex: "Le Parisien", "SIGEM", "FT"
  rank          Int
  source_url    String?

  program Program @relation(fields: [programId], references: [id], onDelete: Cascade)

  @@unique([programId, academic_year, ranking_name])
}

model SchoolStatsRecord {
  id                           String @id @default(uuid())
  schoolId                     String
  academic_year                Int
  total_students               Int?
  total_alumni                 Int?
  partner_companies            Int?
  annual_internship_offers     Int?
  abroad_campuses              Int?
  partner_universities         Int?
  permanent_professors         Int?
  international_professors_pct Float?
  external_speakers_pct        Float?

  school School @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@unique([schoolId, academic_year])
}

model AccreditationRecord {
  id                 String  @id @default(uuid())
  schoolId           String
  accreditation_name String  // ex: "EQUIS", "AACSB", "AMBA"
  year_obtained      Int
  is_active          Boolean @default(true)

  school School @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@unique([schoolId, accreditation_name])
}

// ------------------------------------------------------
// PIPELINE IA ET AUTOMATISATION
// ------------------------------------------------------

model ContributionInbox {
  id                     String   @id @default(uuid())
  source_type            String   // "User_Submission" ou "Automated_AI"
  schoolId               String?  // Rattachement à l'école (toujours renseigné sauf exceptions)
  campusId               String?  // Rattachement au campus (nullable selon le niveau de donnée)
  programId              String?  // Rattachement au programme (nullable selon le niveau de donnée)
  user_text              String?  
  urls                   String[] // URLs fournies ou trouvées
  ai_category            String   // "Pricing", "Ranking", "Capacity", "SchoolStats", "Accreditation", "Program_Discovery"
  ai_extracted_json      Json?    // Résultat brut JSON de l'IA (modèles Gemma)
  status                 String   @default("Pending_AI") // Pending_AI, Pending_Admin, Validated, Rejected
  year_assumed           Boolean  @default(false)
  data_conflict_warning  Boolean  @default(false)
  program_name_mismatch  Boolean  @default(false)
  createdAt              DateTime @default(now())

  // Note: Les FK schoolId/campusId/programId sont optionnelles car :
  // - Pour "Program_Discovery" (Phase 1), seul schoolId est renseigné
  // - Pour les données de niveau école (SchoolStats, Accreditation), campusId/programId sont null
  // - Pour les données de niveau programme (Pricing, Ranking, Capacity), les 3 sont renseignés
}

model CronTarget {
  id                    String    @id @default(uuid())
  schoolId              String
  programId             String?
  data_category         String    // "Pricing", "Ranking", "Capacity", "Program_Discovery"
  last_failed_attempt   DateTime?
  failed_attempts_count Int       @default(0)
  is_blacklisted        Boolean   @default(false)

  school  School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  program Program? @relation(fields: [programId], references: [id], onDelete: Cascade)

  @@unique([schoolId, programId, data_category])
}
```

## 3. Chaîne Relationnelle

```
School (1) ──→ (N) Campus (1) ──→ (N) Program (1) ──→ (N) PricingRecord
                                                    ──→ (N) CapacityRecord
                                                    ──→ (N) RankingRecord

School (1) ──→ (N) SchoolStatsRecord
School (1) ──→ (N) AccreditationRecord
School (1) ──→ (N) CronTarget
```

Les données de niveau **école** (stats, accréditations) sont rattachées directement à `School`.
Les données de niveau **programme** (tarifs, classements, capacités) passent par `Campus → Program`.

## 4. Directives pour les Agents IA futurs

Lors de l'implémentation de nouvelles fonctionnalités ou de la manipulation des données :
- **Pas de tables par diplôme :** Ne jamais créer de table `Master` ou `BTS`. Tout nouveau type de formation s'insère dans la table `Program`.
- **Pas de tables par campus :** Ne jamais dupliquer les tables `_Record` par campus. Un `Program` est déjà rattaché à un `Campus`, donc un `PricingRecord` est implicitement lié à un campus via son programme.
- **Typage JSONB :** Le champ `ai_extracted_json` (ContributionInbox) est mappé sur le type `JSONB` de PostgreSQL par Prisma. L'agent IA doit s'assurer que les clés générées par le LLM (Gemma) correspondent scrupuleusement aux champs attendus dans les tables `_Record` pour faciliter le mapping lors de la validation par l'Admin.
- **Upserting :** Les contraintes d'unicité (`@@unique`) définies dans le schéma sont cruciales. Elles garantissent qu'on ne créera pas deux tarifs pour la même école sur la même année. Lors du transfert d'une donnée validée depuis la `ContributionInbox` vers une table finale, l'agent doit utiliser la méthode `upsert` de Prisma (création si inexistant, mise à jour si existant).
- **Niveaux de rattachement dans l'Inbox :** Les FK `schoolId`, `campusId` et `programId` de la `ContributionInbox` reflètent le niveau de sélection de l'utilisateur ou la cible du pipeline automatisé. Ne pas forcer un rattachement si l'information concerne un niveau supérieur (ex: une stat école n'a pas de `programId`).
- **Edge Cases :** Consulter le fichier `edgecase.md` pour comprendre l'origine logique de champs spécifiques tels que `year_assumed` (Edge Case 2.1) ou `additional_fees_notes` (Edge Case 8).
