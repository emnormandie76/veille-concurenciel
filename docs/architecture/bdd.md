# Schéma de base de données (PostgreSQL / Prisma)

> **Mise à jour** : 28 septembre 2026 — aligné sur `prisma/schema.prisma` et ses
> 10 migrations (branche `newresearch`). Ajouts depuis le 1er septembre :
> `PipelineJob`, `ProgramCampusAttachment`, `ProgramPlacement`,
> `Program.campus_policy_note`, `ContributionInbox.raw_report`, clés étrangères
> et contraintes `CHECK` sur l'inbox, `AccreditationRecord.year_obtained`
> facultatif.
> **16 octobre 2026** (plan gestion-contenu, étape 1) : 11e migration,
> `20261016120000_three_roles` : `User.role` passe aux trois rôles `USER`,
> `GESTIONNAIRE`, `ADMIN` (défaut `USER`). Appliquée sur la branche Neon `dev`
> le 16 octobre, sur `main` le 19 octobre (étape 3).
> **16 octobre 2026** (étape 2) : 12e migration,
> `20261016150000_whitelist_accounts` : la liste blanche. `User` reçoit
> l'adresse, le nom affiché, l'état, la date de première connexion et la
> version de session ; `username` et `password_hash` deviennent facultatifs.
> Appliquée sur `dev` le 16 octobre, sur `main` le 19 octobre (étape 3).
> **20 octobre 2026** (étape 5) : 13e migration,
> `20261019120000_content_provenance` : la **provenance** de chaque donnée.
> Les neuf tables de données reçoivent `updated_at`, `updated_by_id` (clé vers
> `User`, `ON DELETE RESTRICT`) et `updated_via` (D10, D11, D24) ;
> `SchoolStatsRecord`, `AccreditationRecord` et `Program` reçoivent
> `source_url` (D12). Appliquée sur `dev`, puis sur `main` le 20 octobre,
> avant la mise en production du code qui la lit.
> **20 octobre 2026** (étape 6) : 14e migration,
> `20261020120000_content_reports` : les **signalements**, dans une table
> neuve, `ContentReport` (D13), jamais dans `ContributionInbox` (piège 6).
> Appliquée sur la branche Neon `dev`, puis sur `main` le 20 octobre, avant
> la mise en production du code qui la lit.
> **20 octobre 2026** (étape 7) : 15e migration,
> `20261020150000_research_launches` : le **journal des lancements de l'IA**,
> dans une table neuve, `ResearchLaunch` (D14), tenue par Next.js seul ;
> `PipelineJob`, que le backend gelé écrit, n'est pas touchée. Appliquée sur
> la branche Neon `dev` le 20 octobre ; `main` à la prochaine mise en
> production, avant le code qui la lit.

Référence du projet School Data Pipeline. La source de vérité reste
[`prisma/schema.prisma`](../../prisma/schema.prisma) ; ce document en explique
les intentions.

---

## 1. Principes architecturaux

1. **Séparation des entités et des données temporelles.** Les données immuables
   (nom d'école, nom de programme) sont séparées de celles qui évoluent chaque
   année (prix, classements, effectifs), stockées dans des tables `_Record`
   portant une colonne `academic_year`.

2. **Standardisation des programmes.** Aucune table par type de diplôme. Tout est
   un `Program`. Les spécificités métier passent par des attributs
   (`admission_exam`, `is_alternance_possible`…).

3. **Double zone — tampon et production.** `ContributionInbox` recueille les
   données brutes issues de l'IA ou du crowdsourcing ; elles ne rejoignent les
   tables de production qu'après validation humaine.

4. **Un programme appartient à une ÉCOLE, pas à un campus.** *(règle issue du
   refactor `Program` — c'est le changement structurant du modèle actuel)*
   L'association aux campus passe par la table `ProgramCampus`. Un même
   programme ouvert sur trois campus = **un** `Program` + **trois**
   `ProgramCampus`.

5. **La capacité d'accueil varie par campus.** `CapacityRecord` référence
   `programCampusId`, jamais `programId`. Les tarifs et classements, eux,
   restent au niveau du programme.

6. **Le détail année par année est une table fille, pas une clé élargie.**
   `ProgramCampusAttachment` pend de `ProgramCampus` sans en changer l'identité :
   **zéro ligne fille = le sens actuel de l'arête, inchangé**. Rien n'est à
   rétro-remplir, et les chemins qui lisent ou suppriment une arête ne voient
   aucune différence.

---

## 2. Modèle de données actuel

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  // L'URL vit dans prisma.config.ts depuis Prisma 7, plus dans ce bloc.
}

// ── AUTHENTIFICATION ──────────────────────────────────────────────

model User {
  id              String    @id @default(uuid())
  username        String?   @unique             // ancien identifiant : comptes d'avant la liste blanche (D3)
  email           String?   @unique             // adresse de travail, en minuscules ; domaine imposé par lib/accounts.ts (D5)
  display_name    String?                       // nom affiché (D6)
  password_hash   String?                       // bcrypt, 12 tours ; vide tant que la personne n'a pas fait sa première connexion
  role            String    @default("USER")    // CHECK : "USER" | "GESTIONNAIRE" | "ADMIN"
  status          String    @default("INVITED") // CHECK : "INVITED" | "ACTIVE" | "DISABLED"
  first_login_at  DateTime?
  session_version Int       @default(0)         // recopiée dans le jeton ; augmentée par une remise à zéro (D20)
  createdAt       DateTime  @default(now())
  // relations inverses de la provenance (étape 5) : updatedSchools, updatedCampuses,
  // updatedPrograms… une par table de données ; la clé RESTRICT garde le nom (D24)
  reports         ContentReport[] @relation("ContentReportAuthor")   // étape 6, RESTRICT (D38)
  handledReports  ContentReport[] @relation("ContentReportHandler")  // étape 6, RESTRICT (D38)
  researchLaunches ResearchLaunch[]                                  // étape 7, RESTRICT (D42)
}

// ── ENTITÉS PRINCIPALES ───────────────────────────────────────────

model School {
  id              String                @id @default(uuid())
  name            String                @unique
  official_domain String                @unique  // peut porter un chemin : "em-strasbourg.com/fr"
  status          String                @default("ACTIVE")
  accreditations  AccreditationRecord[]
  campuses        Campus[]
  contributions   ContributionInbox[]
  contentReports  ContentReport[]       // signalements (étape 6)
  pipelineJobs    PipelineJob[]
  programs        Program[]              // ← relation directe
  statsRecords    SchoolStatsRecord[]

  // Provenance (étape 5, D10, D11) : la DERNIÈRE modification, posée par le code
  // (lib/provenance.ts) avec l'auteur de la session ; vide pour une ligne d'avant
  // la migration. Les trois colonnes sont vides ensemble ou pleines ensemble (CHECK).
  updated_at      DateTime?
  updated_by_id   String?
  updated_via     String?                // CHECK : "MANUAL" | "AI" | "REPORT"
  updatedBy       User?    @relation(fields: [updated_by_id], references: [id], onDelete: Restrict)
}

model Campus {
  id              String              @id @default(uuid())
  schoolId        String
  name            String              // tel qu'en base : "Lyon campus", "Campus Saint‑Étienne" (U+2011)
  city            String?
  contributions   ContributionInbox[]
  contentReports  ContentReport[]
  school          School              @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  programCampuses ProgramCampus[]
  updated_at      DateTime?                     // provenance (étape 5) : voir School
  updated_by_id   String?
  updated_via     String?
  updatedBy       User?    @relation(fields: [updated_by_id], references: [id], onDelete: Restrict)

  @@unique([schoolId, name])
}

model Program {
  id                        String             @id @default(uuid())
  schoolId                  String             // ← et non campusId
  name                      String
  admission_exam            String?
  is_alternance_possible    Boolean            @default(false)
  is_expatriation_mandatory Boolean            @default(false)
  min_expatriation_months   Int?
  max_internship_months     Int?
  campus_policy_note        String?            // contrainte de campus publiée en prose
  source_url                String?            // lien source de la fiche (D12, étape 5)
  campuses                  ProgramCampus[]
  placements                ProgramPlacement[]
  contributions             ContributionInbox[]
  contentReports            ContentReport[]
  pricingRecords            PricingRecord[]
  rankingRecords            RankingRecord[]
  school                    School             @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  updated_at      DateTime?                     // provenance (étape 5) : voir School
  updated_by_id   String?
  updated_via     String?
  updatedBy       User?    @relation(fields: [updated_by_id], references: [id], onDelete: Restrict)

  @@unique([schoolId, name])   // ← unicité PAR ÉCOLE
}

model ProgramCampus {
  id              String                    @id @default(uuid())
  programId       String
  campusId        String
  program         Program                   @relation(fields: [programId], references: [id], onDelete: Cascade)
  campus          Campus                    @relation(fields: [campusId], references: [id], onDelete: Cascade)
  capacityRecords CapacityRecord[]
  contributions   ContributionInbox[]
  attachments     ProgramCampusAttachment[]

  @@unique([programId, campusId])   // INCHANGÉ par le rattachement année par année
}

// Détail année par année d'une arête. ZÉRO ligne = sens actuel, inchangé.
model ProgramCampusAttachment {
  id              String        @id @default(uuid())
  programCampusId String
  study_year      Int                              // 1, 2, 3… — jamais 0 ici
  regime          String        @default("ANY")    // "INITIAL" | "ALTERNANCE" | "ANY"
  languages       String[]      @default([])
  note            String?
  source_url      String?
  programCampus   ProgramCampus @relation(fields: [programCampusId], references: [id], onDelete: Cascade)
  updated_at      DateTime?                     // provenance (étape 5) : voir School
  updated_by_id   String?
  updated_via     String?
  updatedBy       User?    @relation(fields: [updated_by_id], references: [id], onDelete: Restrict)

  @@unique([programCampusId, study_year, regime])
}

// Lieux annoncés qui ne sont PAS des campus de l'école. Aucun chemin d'écriture.
model ProgramPlacement {
  id         String  @id @default(uuid())
  programId  String
  study_year Int     @default(0)            // 0 = non précisée — sentinelle, pas NULL
  regime     String  @default("ANY")
  label      String                         // tel que publié, non normalisé
  kind       String  @default("UNSPECIFIED") // PARTNER | REGION | REMOTE | UNSPECIFIED
  note       String?
  source_url String?
  program    Program @relation(fields: [programId], references: [id], onDelete: Cascade)

  @@unique([programId, study_year, regime, label])
}

// ── TABLES TEMPORELLES ────────────────────────────────────────────

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
  program               Program @relation(fields: [programId], references: [id], onDelete: Cascade)
  updated_at      DateTime?                     // provenance (étape 5) : voir School
  updated_by_id   String?
  updated_via     String?
  updatedBy       User?    @relation(fields: [updated_by_id], references: [id], onDelete: Restrict)

  @@unique([programId, academic_year])
}

model CapacityRecord {
  id              String        @id @default(uuid())
  programCampusId String        // ← et non programId
  academic_year   Int
  spots_available Int
  source_url      String?
  programCampus   ProgramCampus @relation(fields: [programCampusId], references: [id], onDelete: Cascade)
  updated_at      DateTime?                     // provenance (étape 5) : voir School
  updated_by_id   String?
  updated_via     String?
  updatedBy       User?    @relation(fields: [updated_by_id], references: [id], onDelete: Restrict)

  @@unique([programCampusId, academic_year])
}

model RankingRecord {
  id            String  @id @default(uuid())
  programId     String
  academic_year Int
  ranking_name  String
  rank          Int
  source_url    String?
  program       Program @relation(fields: [programId], references: [id], onDelete: Cascade)
  updated_at      DateTime?                     // provenance (étape 5) : voir School
  updated_by_id   String?
  updated_via     String?
  updatedBy       User?    @relation(fields: [updated_by_id], references: [id], onDelete: Restrict)

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
  international_professors_pct Float?   // entier 0-100 (46 = 46 %)
  external_speakers_pct        Float?
  source_url                   String?  // D12, étape 5
  school                       School @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  updated_at      DateTime?                     // provenance (étape 5) : voir School
  updated_by_id   String?
  updated_via     String?
  updatedBy       User?    @relation(fields: [updated_by_id], references: [id], onDelete: Restrict)

  @@unique([schoolId, academic_year])
}

model AccreditationRecord {
  id                 String  @id @default(uuid())
  schoolId           String
  accreditation_name String
  year_obtained      Int?    // NULL = inconnue (l'ancien 0 partait en production comme une vraie année)
  is_active          Boolean @default(true)
  // "international" = EQUIS, AACSB, AMBA, BSIS… | "label" = CGE, Qualiopi… | "state" = Grade Master, CTI…
  accreditation_type String  @default("international")
  source_url         String? // D12, étape 5
  school             School  @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  updated_at      DateTime?                     // provenance (étape 5) : voir School
  updated_by_id   String?
  updated_via     String?
  updatedBy       User?    @relation(fields: [updated_by_id], references: [id], onDelete: Restrict)

  @@unique([schoolId, accreditation_name])
}

// ── SUIVI DU PIPELINE ─────────────────────────────────────────────

model PipelineJob {
  id          String    @id @default(uuid())
  schoolId    String
  phase       String
  source      String    @default("manual")  // "manual" | "cron"
  status      String    @default("queued")  // CHECK : queued | running | completed | failed
  worker_id   String?                       // processus propriétaire : détecte les orphelins
  progress    Json?
  result      Json?
  error       String?
  started_at  DateTime  @default(now())
  updated_at  DateTime  @default(now())
  finished_at DateTime?
  school      School    @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([schoolId, status])
  @@index([status, updated_at])
}

// ── ZONE TAMPON ───────────────────────────────────────────────────

model ContributionInbox {
  id                    String   @id @default(uuid())
  source_type           String   // CHECK : "User_Submission" | "Automated_AI"
  schoolId              String?
  campusId              String?
  programId             String?
  programCampusId       String?
  user_text             String?
  urls                  String[]
  ai_category           String   // CHECK : Program_Discovery | Pricing | Ranking | Capacity | SchoolStats | Accreditation
  ai_extracted_json     Json?
  status                String   @default("Pending_AI") // CHECK : Pending_AI | Pending_Admin | Validated | Rejected | Failed
  year_assumed          Boolean  @default(false)
  data_conflict_warning Boolean  @default(false)
  program_name_mismatch Boolean  @default(false)
  createdAt             DateTime @default(now())
  submission_group_id   String?
  raw_report            String?  // rapport Tavily Research intégral
  school                School?        @relation(fields: [schoolId], references: [id], onDelete: SetNull)
  campus                Campus?        @relation(fields: [campusId], references: [id], onDelete: SetNull)
  program               Program?       @relation(fields: [programId], references: [id], onDelete: SetNull)
  programCampus         ProgramCampus? @relation(fields: [programCampusId], references: [id], onDelete: SetNull)

  @@index([submission_group_id])
  @@index([schoolId])
  @@index([programId])
  @@index([status, createdAt])
}

// ── SIGNALEMENTS (étape 6) ────────────────────────────────────────

model ContentReport {
  id            String    @id @default(uuid())
  author_id     String                        // le compte de la session, jamais le corps de la requête
  schoolId      String
  campusId      String?                       // un campus OU un programme de l'école, ou rien (l'école)
  programId     String?
  target_type   String                        // CHECK : SCHOOL | CAMPUS | PROGRAM
  target_label  String                        // le nom de la cible à l'envoi (D37)
  category      String                        // CHECK : SCHOOL_INFO | CAMPUS_PROGRAM | PRICING | CAPACITY | RANKING | STATS | ACCREDITATION | OTHER
  message       String                        // CHECK : 10 à 2 000 caractères
  source_url    String?                       // règle D27 (D34)
  status        String    @default("OPEN")   // CHECK : OPEN | RESOLVED | REJECTED
  response      String?                       // la réponse du gestionnaire, 1 000 caractères au plus (D36)
  handled_by_id String?
  handled_at    DateTime?
  created_at    DateTime  @default(now())
  author    User     @relation("ContentReportAuthor", fields: [author_id], references: [id], onDelete: Restrict)
  handledBy User?    @relation("ContentReportHandler", fields: [handled_by_id], references: [id], onDelete: Restrict)
  school    School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  campus    Campus?  @relation(fields: [campusId], references: [id], onDelete: SetNull)
  program   Program? @relation(fields: [programId], references: [id], onDelete: SetNull)

  @@index([status, created_at])
  @@index([schoolId])
  @@index([author_id])
}

// ── JOURNAL DES LANCEMENTS DE L'IA (étape 7) ──────────────────────

model ResearchLaunch {
  id              String   @id @default(uuid())
  kind            String                        // CHECK : TARGETED (recherche ciblée) | DUE_PASSES (passes dues réelles)
  triggered_by_id String                        // le compte de la session, jamais le corps de la requête
  launched_at     DateTime @default(dbgenerated("CURRENT_TIMESTAMP"))  // l'heure de la base, comme PipelineJob.started_at (D40)
  status          String   @default("PENDING") // CHECK : PENDING | STARTED | NOT_STARTED | UNKNOWN (D41)
  request         Json                          // le corps envoyé au backend, et l'école d'une recherche ciblée
  max_passes      Int?                          // passes dues : 1 à 5, borne de la fenêtre (D40)
  job_id          String?                       // recherche ciblée : l'id rendu par le backend, sans clé vers PipelineJob
  http_status     Int?                          // la réponse : code HTTP…
  detail          String?                       // …et message, 1 000 caractères au plus
  triggeredBy User @relation(fields: [triggered_by_id], references: [id], onDelete: Restrict)

  @@index([kind, launched_at])
  @@index([job_id])
}
```

> Les contraintes `CHECK` ne sont pas visibles dans `schema.prisma` : elles
> vivent dans la migration `20260902120000_inbox_relations_and_enum_guards`,
> posées `NOT VALID` (elles s'appliquent à toute écriture future sans exiger la
> conformité de l'historique). Celles de `User` et de la provenance sont dans
> leurs migrations (§4).

> **La table `CronTarget` a été supprimée** (migration
> `20260701100000_remove_cron_target`). Le pipeline n'entretient plus de liste
> noire ; un échec est tracé dans `PipelineJob`.

---

## 3. Chaîne relationnelle

```
School (1) ──→ (N) Campus
School (1) ──→ (N) Program ──→ (N) PricingRecord
                            ──→ (N) RankingRecord
                            ──→ (N) ProgramPlacement
School (1) ──→ (N) SchoolStatsRecord
School (1) ──→ (N) AccreditationRecord
School (1) ──→ (N) PipelineJob

Program (N) ←──→ (N) Campus   via ProgramCampus
ProgramCampus (1) ──→ (N) CapacityRecord
ProgramCampus (1) ──→ (N) ProgramCampusAttachment

ContributionInbox ──→ School? · Campus? · Program? · ProgramCampus?   (ON DELETE SET NULL)
ContentReport ──→ User (auteur, traitant : RESTRICT) · School (CASCADE) · Campus? · Program? (SET NULL)
ResearchLaunch ──→ User (lanceur : RESTRICT)      ·· PipelineJob par job_id ou par fenêtre, sans clé
```

| Niveau de la donnée | Rattachement |
|---------------------|--------------|
| École — stats, accréditations | `School` |
| Programme — tarifs, classements, lieux hors du parc, note de campus | `Program` |
| **Programme × campus — capacités** | **`ProgramCampus`** |
| **Programme × campus × année × régime — langues** | **`ProgramCampusAttachment`** |

---

## 4. Migrations

Quinze migrations, à appliquer par `prisma migrate deploy` (ou
`npm run db:migrate` par WebSocket). La onzième, `20261016120000_three_roles`,
et la douzième, `20261016150000_whitelist_accounts`, sont arrivées sur `dev` le
16 octobre 2026 et sur `main` le 19 octobre (étape 3 du plan gestion-contenu,
avant la fusion dans la branche Git `main`). La treizième,
`20261019120000_content_provenance` (étape 5), est arrivée sur `dev` puis
sur `main` le 20 octobre, avant la fusion de l'étape 5 dans la branche Git
`main`. La quatorzième, `20261020120000_content_reports` (étape 6), est
arrivée sur `dev` puis sur `main` le 20 octobre, avant la fusion du code qui
la lit (« Mon compte » la lit). Les quatorze sont appliquées sur les deux
branches Neon. La quinzième, `20261020150000_research_launches` (étape 7),
est appliquée sur `dev` le 20 octobre ; `main` la recevra à la prochaine mise
en production, **avant** le code qui la lit (l'historique de `/admin/cron`).

| Migration | Contenu |
|-----------|---------|
| `20260520095936_init` | schéma initial (modèle antérieur au refactor) |
| `20260521170000_add_submission_group_id` | `ContributionInbox.submission_group_id` + index |
| `20260701100000_remove_cron_target` | suppression de `CronTarget` |
| `20260901120000_program_campus_refactor` | **refactor `Program` — écrite à la main** |
| `20260901160000_inbox_status_index` | `@@index([status, createdAt])` sur l'inbox |
| `20260902100000_pipeline_job_state` | table `PipelineJob` : l'état des jobs quitte la mémoire du processus |
| `20260902110000_accreditation_year_nullable` | `year_obtained` facultatif ; les `0` existants deviennent `NULL` |
| `20260902120000_inbox_relations_and_enum_guards` | clés étrangères `SET NULL` sur l'inbox, contraintes `CHECK` (statut, catégorie, `source_type`, `User.role`, `PipelineJob.status`) |
| `20260903120000_inbox_raw_report` | `ContributionInbox.raw_report` |
| `20260904120000_program_campus_attachment` | `ProgramCampusAttachment`, `ProgramPlacement`, `Program.campus_policy_note` — **strictement additive** |
| `20261016120000_three_roles` | **écrite à la main** : remplace `User_role_check` par les trois rôles (`USER`, `GESTIONNAIRE`, `ADMIN`, `NOT VALID`), convertit `MODERATOR` en `GESTIONNAIRE`, défaut `USER`. Ne touche que `User`, que le backend Python ne lit pas |
| `20261016150000_whitelist_accounts` | **écrite à la main, additive** : `username` et `password_hash` facultatifs ; `email` (index unique `User_email_key`), `display_name`, `status` (les comptes existants `ACTIVE`, puis défaut `INVITED`), `first_login_at`, `session_version` (défaut 0) ; cinq contraintes `CHECK`, posées validées (les lignes existantes les tiennent) : `User_status_check`, `User_password_status_check` (actif ⇔ mot de passe), `User_invited_email_check`, `User_identity_check` (adresse ou identifiant), `User_email_lower_check`. Ne touche que `User` |
| `20261019120000_content_provenance` | **écrite à la main, additive, colonnes facultatives seulement** : `source_url` sur `SchoolStatsRecord`, `AccreditationRecord` et `Program` (D12) ; sur les neuf tables de données (`School`, `Campus`, `Program`, `PricingRecord`, `CapacityRecord`, `RankingRecord`, `SchoolStatsRecord`, `AccreditationRecord`, `ProgramCampusAttachment`), `updated_at`, `updated_by_id` et `updated_via`, avec par table une clé `<Table>_updated_by_id_fkey` vers `User` (`ON DELETE RESTRICT`, D24) et deux contraintes `CHECK` : `<Table>_updated_via_check` (`MANUAL`, `AI`, `REPORT`) et `<Table>_provenance_check` (les trois colonnes vides ensemble ou pleines ensemble). Aucun index, aucune donnée réécrite : les lignes existantes restent « non suivies ». Le backend gelé lit ces tables (`SELECT *` dans le diff de la Phase 2) mais ne compare que ses propres colonnes : il n'est pas touché |
| `20261020120000_content_reports` | **écrite à la main, additive** : une table neuve, `ContentReport` (D13), ses trois index et ses cinq clés : l'auteur (`author_id`) et celui qui traite (`handled_by_id`) vers `User` en `ON DELETE RESTRICT` (D38), l'école en `CASCADE`, le campus et le programme en `SET NULL` (D37). Sept contraintes `CHECK` : `ContentReport_target_type_check`, `_target_check` (une cible fine à la fois), `_category_check` (huit catégories), `_message_check` (10 à 2 000 caractères), `_status_check` (`OPEN`, `RESOLVED`, `REJECTED`), `_response_check` (1 000 caractères au plus), `_handled_check` (en attente : personne ne l'a traité ; fermé : qui et quand). Aucune table existante modifiée, aucune ligne écrite ; le backend gelé ne la connaît pas |
| `20261020150000_research_launches` | **écrite à la main, additive** : une table neuve, `ResearchLaunch` (D14), ses deux index (`kind, launched_at` ; `job_id`) et une seule clé : le lanceur (`triggered_by_id`) vers `User` en `ON DELETE RESTRICT` (D42). `launched_at` en `DEFAULT CURRENT_TIMESTAMP`, l'heure de la base (D40). Six contraintes `CHECK` : `ResearchLaunch_kind_check` (`TARGETED`, `DUE_PASSES`), `_status_check` (`PENDING`, `STARTED`, `NOT_STARTED`, `UNKNOWN`), `_max_passes_check` (1 à 5 pour des passes dues, vide pour une recherche ciblée), `_job_check` (une recherche ciblée partie porte l'id de son job ; des passes dues n'en ont pas), `_answer_check` (en attente : pas de réponse ; sinon un code HTTP), `_detail_check` (1 000 caractères au plus). **Aucune clé vers `PipelineJob`** : le backend purge ses jobs, une clé bloquerait sa purge. Aucune table existante modifiée, aucune ligne écrite ; le backend gelé ne la connaît pas |

### Ce qu'il faut savoir sur la migration de rattrapage

Le refactor `Program` avait été appliqué à `schema.prisma` **sans jamais générer
de migration** ; les bases étaient alignées par `prisma db push`. La migration
`20260901120000` comble cet écart.

Elle a été **écrite à la main**, parce que la version générée par
`prisma migrate diff` était destructrice :

```sql
-- version auto-générée, NON retenue
ALTER TABLE "Program" DROP COLUMN "campusId", ADD COLUMN "schoolId" TEXT NOT NULL;
CREATE TABLE "ProgramCampus" (...);   -- créée vide
```

Elle échouait sur toute table peuplée et perdait le lien programme ↔ campus.
La version retenue procède dans cet ordre :

1. colonnes nullables ajoutées,
2. rétro-remplissage (`Program.schoolId` déduit du campus ; `ProgramCampus`
   peuplée depuis `Program.campusId` ; `CapacityRecord.programCampusId` déduit),
3. `SET NOT NULL`,
4. **puis seulement** suppression des anciennes colonnes.

**Contrainte d'ordre permanente** : `ProgramCampus` se peuple depuis
`Program.campusId`. Toute future migration touchant ce lien doit respecter la
même séquence reprise → suppression.

Elle porte deux garde-fous `RAISE EXCEPTION` :

- **programmes orphelins** — un `campusId` pointant vers un campus disparu ;
- **collision d'unicité** — l'ancienne contrainte était `(campusId, name)`, la
  nouvelle est `(schoolId, name)`. *« MSc Finance » à Paris* et *« MSc Finance »
  à Lyon* étaient deux `Program` légitimes et se percutent désormais. Le refactor
  suppose qu'ils soient **fusionnés** en un `Program` relié à deux
  `ProgramCampus` — un arbitrage métier (quel tarif garder ? quel classement ?)
  qu'aucune migration ne peut trancher seule. La migration s'arrête donc avec un
  message explicite.

### Ce qu'il faut savoir sur la migration du rattachement campus

`20260904120000_program_campus_attachment` n'ajoute que des tables et une
colonne nullable. `ProgramCampus` et son unique `(programId, campusId)` ne sont
**pas** touchés, pas plus que `CapacityRecord` : sept chemins lisent ou écrivent
une arête (validation de découverte, gestion d'école, contribution, Phase 2,
écrans de capacité), dont deux auraient perdu des données en silence si
l'identité de l'arête avait changé. Aucun fichier applicatif n'a eu besoin
d'être modifié pour l'accueillir.

Elle a été appliquée le 15 septembre 2026 **par le port 443**, le réseau du
poste de développement coupant le protocole Postgres sur 5432 : SQL du fichier
et ligne `_prisma_migrations` dans une seule transaction, sur `DIRECT_URL`,
après une répétition terminée par `ROLLBACK`. Le checksum attendu par Prisma est
le **sha256 des octets de `migration.sql`** ; les 10 checksums en base se
reproduisent.

### Règles d'exploitation

- **Ne jamais lancer `prisma migrate dev`, `migrate reset` ni `db push` contre
  la base Neon** : ils proposent de la réinitialiser.
- **`prisma db push` est proscrit hors développement local.** C'est son usage qui
  a produit la désynchronisation. Un garde-fou de CI le vérifie.
- Une base alignée par `db push` doit être **baselinée**
  (`prisma migrate resolve --applied <migration>`), pas migrée.
- **Prisma 7 exige `SHADOW_DATABASE_URL`** dans `prisma.config.ts` pour
  régénérer une migration depuis l'historique
  (`migrate diff --from-migrations`). L'option `--shadow-database-url` n'existe
  plus en ligne de commande, et `--to-schema-datamodel` est devenu `--to-schema`.
- **`env()` ne lit pas la variable** : il construit un objet de référence que
  Prisma résout plus tard. Un objet est toujours vrai, donc
  `env("DIRECT_URL") || env("DATABASE_URL")` retournait **systématiquement** la
  première branche — le repli annoncé en commentaire n'existait pas, et les
  migrations échouaient au lieu de basculer. L'arbitrage se fait désormais sur
  `process.env`, **avant** l'appel :

  ```ts
  const MIGRATION_URL_VAR = process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL";
  url: env(MIGRATION_URL_VAR),
  ```

---

## 5. Cycle de vie d'un ticket `ContributionInbox`

| Statut | Signification |
|--------|---------------|
| `Pending_AI` | en attente de traitement par le pipeline |
| `Pending_Admin` | données extraites, en attente de validation humaine |
| `Validated` | transféré en production ; **posé uniquement si une donnée a réellement été écrite** |
| `Rejected` | écarté (page incompatible, catégorie inconnue) |
| `Failed` | erreur inattendue (crowdsourcing) ; ou rapport Research rangé (pipeline) |

Les cinq valeurs sont gardées en base par `ContributionInbox_status_check`, et
listées dans `lib/contribution.ts` et `backend/constants.py`.

**`Failed` côté crowdsourcing** (`User_Submission`) n'est pas terminal : le
ticket est rejoué après un délai, puis supprimé au bout de N tentatives. Charge
utile écrite dans `ai_extracted_json` :

```json
{ "error": "...", "processing_attempts": 2,
  "failed_at": "2026-09-01T09:29:08Z", "failed_at_epoch": 1788000000.0 }
```

Le doublon numérique `failed_at_epoch` existe parce que la file d'attente
compare cette valeur **en SQL** : un `::timestamptz` sur une chaîne issue d'un
JSON lève une erreur si la valeur est malformée et ferait tomber toute la boucle
de traitement.

> Politique complète : [`decision-retention-tickets.md`](../memory/decision-retention-tickets.md).

**`Failed` côté pipeline** (`Automated_AI`, catégorie `Program_Discovery`) :
l'extraction Gemini d'un rapport Research a échoué, et le rapport est rangé
pour ne pas être repayé. Il n'est jamais rejoué par le processeur de
crowdsourcing, qui ne lit que les `User_Submission`.

```json
{ "parked_reason": "research_report_parked",
  "last_error": "Extraction Gemini indisponible: …", "extraction_attempts": 2 }
```

La passe de Phase 1 suivante pour la même école le reprend (moins de 7 jours) ;
une extraction réussie le supprime.

### Les trois charges d'un ticket `Program_Discovery`

| Charge | Statut | Écrite en production par |
|---|---|---|
| `discovered_campuses` | `Pending_Admin` | `PUT /api/admin/inbox/[id]/validate` |
| `campus_attachments` (+ `campus_policy_notes`) | `Pending_Admin` | `PUT /api/admin/inbox/[id]/attachments` |
| `parked_reason` | `Failed` | rien — `/validate` le refuse ; le rejeter le retire |

---

## 6. Directives pour les agents futurs

- **Pas de table par diplôme.** Tout type de formation s'insère dans `Program`.
- **Pas de table `_Record` par campus.** Seule la capacité varie par campus, et
  c'est `ProgramCampus` qui porte cette dimension.
- **Un `Program` est unique par `(schoolId, name)`.** Ne jamais créer un doublon
  pour distinguer deux campus : créer un `ProgramCampus` supplémentaire.
- **Ne jamais écrire un `CapacityRecord` sans campus identifiable.** La route de
  validation **refuse** l'import plutôt que de choisir un campus au hasard —
  c'était un défaut corrigé (`findFirst` sans `orderBy` renvoyait une ligne
  arbitraire, et l'ordre PostgreSQL sans `ORDER BY` n'est même pas stable).
- **Les clés de `ContributionInbox` sont de vraies clés étrangères en
  `ON DELETE SET NULL`** : supprimer une école détache ses tickets sans les
  détruire. Une clé étrangère ne prouve pas l'**appartenance** : que `campusId`
  appartienne bien à `schoolId` reste à vérifier applicativement, comme le
  faisait `POST /api/contribute` (retirée le 16 octobre 2026, plan
  gestion-contenu, D2).
- **Upsert obligatoire** lors du transfert vers la production : les contraintes
  `@@unique` sont là pour ça.
- **Upsert et changement de statut dans une même transaction.** Séparés, un échec
  du second laissait la donnée écrite et le ticket ouvert — l'admin revalidait
  et écrasait.
- **Statuts, catégories et `source_type` sont des énumérations gardées** :
  `lib/contribution.ts` et `backend/constants.py` (vérifiées l'une contre l'autre
  par `test_contribution_enums.py`), plus une contrainte `CHECK` en base. Ajouter
  une valeur impose de modifier les deux listes **et** d'écrire une migration qui
  remplace la contrainte.
- **`User.role` est un `String` gardé par `CHECK (role IN ('USER', 'GESTIONNAIRE', 'ADMIN'))`**
  (migration `20261016120000_three_roles`) ; la liste de référence est
  `USER_ROLES` dans `lib/roles.ts` (`test/roles-migration.test.ts`). Les
  contrôles d'accès relisent le rôle en base et le comparent exactement
  (`lib/auth.ts`) ; un rôle inconnu ne vaut que `USER`.
- **`User.status` est un `String` gardé par `CHECK (status IN ('INVITED', 'ACTIVE', 'DISABLED'))`**
  (migration `20261016150000_whitelist_accounts`) ; la liste de référence est
  `ACCOUNT_STATUSES` dans `lib/accounts.ts` (`test/accounts-migration.test.ts`).
  Seul un compte `ACTIVE` se connecte et a une session (`lib/sign-in.ts`,
  `lib/auth.ts`) ; la base garantit qu'il est le seul à avoir un mot de passe.
- **Toute écriture d'une table de données pose sa provenance**
  (migration `20261019120000_content_provenance`) : `updated_by_id` est le
  compte de la **session** (jamais une valeur du corps de la requête),
  `updated_at` la date du serveur, `updated_via` l'origine : `MANUAL` (saisie
  dans le back-office), `AI` (validée depuis l'inbox ; l'auteur est l'admin qui
  valide, D11), `REPORT` (signalement, étape 6). Le module de référence est
  `lib/provenance.ts` (`UPDATE_ORIGINS`, `provenance()`), vérifié contre la
  migration par `test/provenance-migration.test.ts`. Seule la **dernière**
  modification est connue, et une suppression ne laisse pas de trace (D10).
  Pas de `@updatedAt` de Prisma : il daterait aussi une écriture sans auteur.
- **Un compte qui figure comme auteur ne se supprime pas** : la clé
  `ON DELETE RESTRICT` le refuse (P2003), et la route répond 409 ; il se
  désactive (D24). Il en va de même de l'auteur d'un signalement et de celui
  qui l'a traité (D38), et de qui a lancé une recherche IA (D42).
- **Un signalement n'entre jamais dans `ContributionInbox`** (D13, piège 6) :
  il va dans `ContentReport`, que seul Next.js écrit (`/api/admin/reports`).
  L'auteur et celui qui traite viennent de la session ; le nom de la cible
  est lu en base à l'envoi, et la cible doit appartenir à l'école. Listes et
  bornes de référence : `lib/content-reports.ts`, vérifié contre la
  migration par `test/content-reports-migration.test.ts`. Traiter un
  signalement ne date aucune donnée (D32) : `updated_via = REPORT` reste
  permis par la contrainte, sans servir.
- **Next.js n'écrit jamais `PipelineJob`** (D14, piège 5) : la table est au
  backend gelé, qui l'écrit et la purge. Qui a lancé une recherche se lit dans
  `ResearchLaunch`, que seul Next.js écrit (`trigger-research`,
  `run-due-passes`), **avant** l'appel au backend : si cette écriture échoue,
  rien ne part (D41). Le lanceur vient de la session. Une recherche ciblée se
  relie à son job par l'id que le backend rend ; une passe due par la
  **fenêtre** de son lancement (D40) : les jobs `rotation` créés à partir de
  son heure et avant le lancement suivant qui a pu partir, au plus
  `max_passes`. D'où `launched_at` à l'heure de la base : `@default(now())`
  donnerait l'heure du poste, que le client Prisma 7 calcule lui-même. Listes
  et règles de référence : `lib/research-launches.ts`, vérifié contre la
  migration par `test/research-launches-migration.test.ts`, qui vérifie aussi
  qu'aucun fichier de `app/` ni de `lib/` n'écrit `PipelineJob`.
- **Ne jamais créer une arête `ProgramCampus` depuis le rattachement campus.**
  Une arête ouvre une option dans les menus de capacité et une tâche `Capacity`
  facturée à chaque passe de Phase 2 ; elle passe par la validation d'une
  découverte ou par l'écran de gestion. Le type `AttachmentTx` de
  `lib/campus-attachment.ts` l'interdit à la compilation.
- **Ne jamais supprimer une ligne `ProgramCampusAttachment` parce qu'une passe
  ne l'a pas revue.** Elle ressort en `stale` ; seul l'admin supprime.
- **Pour un couple `(programCampusId, study_year)`, le régime est soit
  entièrement `ANY`, soit entièrement nommé.** La règle est tenue à l'écriture :
  la contrainte d'exclusion qui l'exprimerait exige `btree_gist`, que Prisma ne
  sait pas déclarer.
- **`ProgramPlacement.study_year = 0` signifie « non précisée »**, et non `NULL` :
  sous PostgreSQL, deux `NULL` sont distincts et l'unique laisserait entrer deux
  fois le même lieu.
- **Typage JSONB** : `ai_extracted_json` est mappé sur `JSONB`. Les clés générées
  par l'IA doivent correspondre aux champs attendus par les tables `_Record`.
- **Edge cases** : voir `edgecase.md` pour l'origine de `year_assumed`,
  `additional_fees_notes`, etc.
