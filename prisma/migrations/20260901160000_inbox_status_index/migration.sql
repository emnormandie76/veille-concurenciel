-- Index sur la file de traitement du crowdsourcing.
--
-- process_pending_submissions() filtre sur status et trie sur "createdAt" a
-- chaque passage — toutes les minutes. Aucun index ne couvrait ces colonnes ;
-- seul submission_group_id en possedait un. La politique de reessai des
-- tickets 'Failed' rend cette requete plus lourde encore.
--
-- CreateIndex
CREATE INDEX "ContributionInbox_status_createdAt_idx" ON "ContributionInbox"("status", "createdAt");
