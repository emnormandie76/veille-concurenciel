-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MODERATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "official_domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campus" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,

    CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "admission_exam" TEXT,
    "is_alternance_possible" BOOLEAN NOT NULL DEFAULT false,
    "is_expatriation_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "min_expatriation_months" INTEGER,
    "max_internship_months" INTEGER,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRecord" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "academic_year" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "year_1_fee" INTEGER,
    "year_2_fee" INTEGER,
    "year_3_fee" INTEGER,
    "year_4_fee" INTEGER,
    "year_5_fee" INTEGER,
    "total_fee" INTEGER,
    "intl_year_1_fee" INTEGER,
    "intl_total_fee" INTEGER,
    "intl_currency" TEXT,
    "additional_fees_notes" TEXT,
    "source_url" TEXT,

    CONSTRAINT "PricingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapacityRecord" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "academic_year" INTEGER NOT NULL,
    "spots_available" INTEGER NOT NULL,
    "source_url" TEXT,

    CONSTRAINT "CapacityRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingRecord" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "academic_year" INTEGER NOT NULL,
    "ranking_name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "source_url" TEXT,

    CONSTRAINT "RankingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolStatsRecord" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academic_year" INTEGER NOT NULL,
    "total_students" INTEGER,
    "total_alumni" INTEGER,
    "partner_companies" INTEGER,
    "annual_internship_offers" INTEGER,
    "abroad_campuses" INTEGER,
    "partner_universities" INTEGER,
    "permanent_professors" INTEGER,
    "international_professors_pct" DOUBLE PRECISION,
    "external_speakers_pct" DOUBLE PRECISION,

    CONSTRAINT "SchoolStatsRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccreditationRecord" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "accreditation_name" TEXT NOT NULL,
    "year_obtained" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AccreditationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionInbox" (
    "id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "schoolId" TEXT,
    "campusId" TEXT,
    "programId" TEXT,
    "user_text" TEXT,
    "urls" TEXT[],
    "ai_category" TEXT NOT NULL,
    "ai_extracted_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'Pending_AI',
    "year_assumed" BOOLEAN NOT NULL DEFAULT false,
    "data_conflict_warning" BOOLEAN NOT NULL DEFAULT false,
    "program_name_mismatch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributionInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronTarget" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "programId" TEXT,
    "data_category" TEXT NOT NULL,
    "last_failed_attempt" TIMESTAMP(3),
    "failed_attempts_count" INTEGER NOT NULL DEFAULT 0,
    "is_blacklisted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CronTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "School_name_key" ON "School"("name");

-- CreateIndex
CREATE UNIQUE INDEX "School_official_domain_key" ON "School"("official_domain");

-- CreateIndex
CREATE UNIQUE INDEX "Campus_schoolId_name_key" ON "Campus"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Program_campusId_name_key" ON "Program"("campusId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRecord_programId_academic_year_key" ON "PricingRecord"("programId", "academic_year");

-- CreateIndex
CREATE UNIQUE INDEX "CapacityRecord_programId_academic_year_key" ON "CapacityRecord"("programId", "academic_year");

-- CreateIndex
CREATE UNIQUE INDEX "RankingRecord_programId_academic_year_ranking_name_key" ON "RankingRecord"("programId", "academic_year", "ranking_name");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolStatsRecord_schoolId_academic_year_key" ON "SchoolStatsRecord"("schoolId", "academic_year");

-- CreateIndex
CREATE UNIQUE INDEX "AccreditationRecord_schoolId_accreditation_name_key" ON "AccreditationRecord"("schoolId", "accreditation_name");

-- CreateIndex
CREATE UNIQUE INDEX "CronTarget_schoolId_programId_data_category_key" ON "CronTarget"("schoolId", "programId", "data_category");

-- AddForeignKey
ALTER TABLE "Campus" ADD CONSTRAINT "Campus_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRecord" ADD CONSTRAINT "PricingRecord_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapacityRecord" ADD CONSTRAINT "CapacityRecord_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingRecord" ADD CONSTRAINT "RankingRecord_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolStatsRecord" ADD CONSTRAINT "SchoolStatsRecord_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccreditationRecord" ADD CONSTRAINT "AccreditationRecord_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CronTarget" ADD CONSTRAINT "CronTarget_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CronTarget" ADD CONSTRAINT "CronTarget_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
