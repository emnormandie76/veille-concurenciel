-- AlterTable
ALTER TABLE "ContributionInbox" ADD COLUMN "submission_group_id" TEXT;

-- CreateIndex
CREATE INDEX "ContributionInbox_submission_group_id_idx" ON "ContributionInbox"("submission_group_id");
