# Schéma de base de données (PostgreSQL / Prisma)

> **Mise à jour** : 1er septembre 2026. Ce document décrivait encore le modèle
> **antérieur** au refactor `Program` — `Program.campusId`, `CapacityRecord.programId`,
> pas de `ProgramCampus`. Il est ici remis en phase avec `prisma/schema.prisma`.

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
  id            String   @id @default(uuid())
  username      String   @unique
  password_hash String                        // bcrypt, 12 tours
  role          String   @default("MODERATOR") // "ADMIN" | "MODERATOR"
  createdAt     DateTime @default(now())
}

// ── ENTITÉS PRINCIPALES ───────────────────────────────────────────

model School {
  id              String                @id @default(uuid())
  name            String                @unique
  official_domain String                @unique
  status          String                @default("ACTIVE")
  accreditations  AccreditationRecord[]
  campuses        Campus[]
  programs        Program[]              // ← relation directe
  statsRecords    SchoolStatsRecord[]
}

model Campus {
  id              String          @id @default(uuid())
  schoolId        String
  name            String
  city            String?
  school          School          @relation(fields: [schoolId], references: [id], onDelete: Cascade)
  programCampuses ProgramCampus[]

  @@unique([schoolId, name])
}

model Program {
  id                        String          @id @default(uuid())
  schoolId                  String          // ← et non campusId
  name                      String
  admission_exam            String?
  is_alternance_possible    Boolean         @default(false)
  is_expatriation_mandatory Boolean         @default(false)
  min_expatriation_months   Int?
  max_internship_months     Int?
  campuses                  ProgramCampus[]
  pricingRecords            PricingRecord[]
  rankingRecords            RankingRecord[]
  school                    School          @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@unique([schoolId, name])   // ← unicité PAR ÉCOLE
}

model ProgramCampus {
  id              String           @id @default(uuid())
  programId       String
  campusId        String
  program         Program          @relation(fields: [programId], references: [id], onDelete: Cascade)
  campus          Campus           @relation(fields: [campusId], references: [id], onDelete: Cascade)
  capacityRecords CapacityRecord[]

  @@unique([programId, campusId])
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

  @@unique([programId, academic_year])
}

model CapacityRecord {
  id              String        @id @default(uuid())
  programCampusId String        // ← et non programId
  academic_year   Int
  spots_available Int
  source_url      String?
  programCampus   ProgramCampus @relation(fields: [programCampusId], references: [id], onDelete: Cascade)

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
  school                       School @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@unique([schoolId, academic_year])
}

model AccreditationRecord {
  id                 String  @id @default(uuid())
  schoolId           String
  accreditation_name String
  year_obtained      Int
  is_active          Boolean @default(true)
  // "international" = EQUIS, AACSB, AMBA, BSIS… | "label" = CGE, Qualiopi… | "state" = Grade Master, CTI…
  accreditation_type String  @default("international")
  school             School  @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@unique([schoolId, accreditation_name])
}

// ── ZONE TAMPON ───────────────────────────────────────────────────

model ContributionInbox {
  id                    String   @id @default(uuid())
  source_type           String   // "User_Submission" | "Automated_AI"
  schoolId              String?
  campusId              String?
  programId             String?
  programCampusId       String?
  user_text             String?
  urls                  String[]
  ai_category           String
  ai_extracted_json     Json?
  status                String   @default("Pending_AI")
  year_assumed          Boolean  @default(false)
  data_conflict_warning Boolean  @default(false)
  program_name_mismatch Boolean  @default(false)
  createdAt             DateTime @default(now())
  submission_group_id   String?

  @@index([submission_group_id])
  @@index([status, createdAt])
}
```

> **La table `CronTarget` a été supprimée** (migration
> `20260701100000_remove_cron_target`). Le pipeline n'entretient plus de liste
> noire ; les échecs de scan sont journalisés.

---

## 3. Chaîne relationnelle

```
School (1) ──→ (N) Campus
School (1) ──→ (N) Program ──→ (N) PricingRecord
                            ──→ (N) RankingRecord
School (1) ──→ (N) SchoolStatsRecord
School (1) ──→ (N) AccreditationRecord

Program (N) ←──→ (N) Campus   via ProgramCampus
ProgramCampus (1) ──→ (N) CapacityRecord
```

| Niveau de la donnée | Rattachement |
|---------------------|--------------|
| École — stats, accréditations | `School` |
| Programme — tarifs, classements | `Program` |
| **Programme × campus — capacités** | **`ProgramCampus`** |

---

## 4. Migrations

Cinq migrations, à appliquer par `prisma migrate deploy` :

| Migration | Contenu |
|-----------|---------|
| `20260520095936_init` | schéma initial (modèle antérieur au refactor) |
| `20260521170000_add_submission_group_id` | `ContributionInbox.submission_group_id` + index |
| `20260701100000_remove_cron_target` | suppression de `CronTarget` |
| `20260901120000_program_campus_refactor` | **refactor `Program` — écrite à la main** |
| `20260901160000_inbox_status_index` | `@@index([status, createdAt])` sur l'inbox |

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

### Règles d'exploitation

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
| `Failed` | erreur inattendue ; porte un compteur de tentatives |

`Failed` n'est pas terminal : le ticket est rejoué après un délai, puis supprimé
au bout de N tentatives. Charge utile écrite dans `ai_extracted_json` :

```json
{ "error": "...", "processing_attempts": 2,
  "failed_at": "2026-09-01T09:29:08Z", "failed_at_epoch": 1788000000.0 }
```

Le doublon numérique `failed_at_epoch` existe parce que la file d'attente
compare cette valeur **en SQL** : un `::timestamptz` sur une chaîne issue d'un
JSON lève une erreur si la valeur est malformée et ferait tomber toute la boucle
de traitement.

> Politique complète : [`decision-retention-tickets.md`](../memory/decision-retention-tickets.md).

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
- **`ContributionInbox` n'a aucune clé étrangère.** `schoolId`, `campusId`,
  `programId` et `programCampusId` sont de simples `String?`. Rien en base ne
  rattrape une incohérence : **le contrôle d'appartenance doit être fait
  applicativement**, comme le fait `POST /api/contribute`.
- **Upsert obligatoire** lors du transfert vers la production : les contraintes
  `@@unique` sont là pour ça.
- **Upsert et changement de statut dans une même transaction.** Séparés, un échec
  du second laissait la donnée écrite et le ticket ouvert — l'admin revalidait
  et écrasait.
- **Statuts et catégories circulent en chaînes libres**, dupliquées entre Python
  et TypeScript, sans énumération. Une faute de frappe crée un état inatteignable
  silencieusement. *Dette connue, non traitée.*
- **`User.role` est un `String`** avec `MODERATOR` par défaut et aucune
  contrainte ; les contrôles reposent sur une comparaison exacte à `"ADMIN"`.
- **Typage JSONB** : `ai_extracted_json` est mappé sur `JSONB`. Les clés générées
  par l'IA doivent correspondre aux champs attendus par les tables `_Record`.
- **Edge cases** : voir `edgecase.md` pour l'origine de `year_assumed`,
  `additional_fees_notes`, etc.
