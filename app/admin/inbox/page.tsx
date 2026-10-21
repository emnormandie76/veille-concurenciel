"use client";

/**
 * app/admin/inbox/page.tsx — Dashboard ContributionInbox (Étape 3)
 *
 * Interface complète de validation des tickets :
 * - Liste paginée avec filtres (status, ai_category)
 * - Panneau de détail latéral (slide-over)
 * - Formulaire répéteur pour Program_Discovery (Super Ticket)
 * - Formulaires spécifiques par catégorie (Pricing, Ranking, Capacity, SchoolStats, Accreditation)
 * - Badges d'alerte visuels : year_assumed, data_conflict_warning, program_name_mismatch
 * - Actions : Valider (→ upsert tables rigides) / Rejeter
 *
 * Référence : task.md §3, architecture.md §5.2, bdd.md §4 (upsert)
 *
 * Plan gestion-contenu, étape 9, lot 4 : l'écran passe à la charte graphique,
 * le style seulement (partie IA gelée, règle 10) ; requêtes, textes et
 * identifiants restent. Décisions du propriétaire : le panneau de détail est
 * un dialogue collé à droite, fermé aussi par un clic à côté (D76) ; un ton
 * de badge par état (D77, ./ticket-tones.ts) ; ni émoji (D56) ni ✓, ✕, ⚠ en
 * tête des textes (D78) ; un lien n'est cliquable qu'en http(s) (D79) ; le
 * bandeau des contributions en attente au ton « info » (D80). L'erreur d'une
 * purge s'affiche dans sa fenêtre (D67).
 */

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { AdminPage } from "@/components/layout/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/Table";
import { TEXT_LINK } from "@/components/ui/text-link";
import { ExternalIcon, PinIcon } from "@/app/schools/icons";
import { CONTRIBUTION_CATEGORIES, CONTRIBUTION_STATUSES, STATUS_PENDING_AI } from "@/lib/contribution";
import { hasCampusAttachmentBlock } from "@/lib/campus-attachment";
import { describePendingAi } from "@/lib/pipeline-history";
import { sourceHref } from "@/lib/provenance";
import { readRefreshedTicket, TICKET_REFRESH_ERROR } from "@/lib/ticket-refresh";
import { displayedTicketSources } from "@/lib/ticket-sources";
import { FLAG_TONES, matchConfidence, ticketStatusTone } from "./ticket-tones";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface DiscoveredProgram {
  name: string;
  admission_exam?: string | null;
  is_alternance_possible?: boolean | null;
  is_expatriation_mandatory?: boolean | null;
}

interface DiscoveredCampus {
  name: string;
  city?: string | null;
  programs: DiscoveredProgram[];
}

interface Ticket {
  id: string;
  source_type: string;
  ai_category: string;
  status: string;
  schoolId: string | null;
  campusId: string | null;
  programId: string | null;
  user_text: string | null;
  urls: string[];
  ai_extracted_json: Record<string, unknown> | null;
  year_assumed: boolean;
  data_conflict_warning: boolean;
  program_name_mismatch: boolean;
  createdAt: string;
  schoolName?: string | null;
  /** `School.official_domain`, pour le bloc « Sources » (lib/ticket-sources.ts). */
  schoolOfficialDomain?: string | null;
  campusName?: string | null;
  programName?: string | null;
}

// Les listes viennent de lib/contribution.ts : elles étaient recopiées ici, et
// « Failed » y manquait déjà — un ticket en échec était invisible au filtre.
const STATUS_OPTIONS = ["", ...CONTRIBUTION_STATUSES];
const CATEGORY_OPTIONS = ["", ...CONTRIBUTION_CATEGORIES];

// ──────────────────────────────────────────────
// Pièces communes
// ──────────────────────────────────────────────

/**
 * Un lien vers une page du web, tiré d'un ticket (contenu venu de l'IA et du
 * web) : cliquable en http(s) seulement, en nouvel onglet ; une autre adresse
 * reste du texte (D79, comme D27 et D72). `icon` ajoute l'icône de lien
 * externe à un texte court (« source ») ; un intitulé long (une fiche, une
 * adresse) s'en passe : sur plusieurs lignes, l'icône restait à côté du bloc.
 */
function WebLink({ url, icon = false, children }: { url: string | null | undefined; icon?: boolean; children: ReactNode }) {
  const href = sourceHref(url);
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={icon ? cx(TEXT_LINK, "inline-flex items-center gap-1") : TEXT_LINK}>
      {children}
      {icon && <ExternalIcon />}
    </a>
  );
}

/** La croix des boutons d'icône qui retirent un élément (D78). */
function RemoveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

/** Le JSON brut d'un ticket, replié, en lecture seule. */
function RawJson({ json }: { json: unknown }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-ink-2">Voir JSON brut complet</summary>
      <pre className="mt-2 max-h-50 overflow-auto rounded-control border border-line bg-surface-2 p-3 font-mono text-xs text-ink">
        {JSON.stringify(json, null, 2)}
      </pre>
    </details>
  );
}

/** Le titre d'une section du panneau de détail. */
function FormTitle({ children }: { children: ReactNode }) {
  return <h3 className="font-display text-base leading-snug font-semibold text-ink">{children}</h3>;
}

// ──────────────────────────────────────────────
// Composant principal
// ──────────────────────────────────────────────

export default function InboxPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtres
  const [filterStatus, setFilterStatus] = useState("Pending_Admin");
  const [filterCategory, setFilterCategory] = useState("");

  // Panneau de détail
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Contributions Pending_AI : elles attendent le backend local, qui ne tourne
  // que lorsque l'admin le lance (plan backend-local).
  const [pendingAi, setPendingAi] = useState<number | null>(null);

  // Purge
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeStatuses, setPurgeStatuses] = useState<string[]>(["Validated", "Rejected"]);
  const [purgeCount, setPurgeCount] = useState<number | null>(null);
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const LIMIT = 20;

  // Le compte suit chaque rechargement de la liste (filtres, validation, purge).
  const fetchPendingAi = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/inbox?status=${STATUS_PENDING_AI}&limit=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPendingAi(data.pagination.total);
    } catch (err: unknown) {
      // La liste affiche déjà l'erreur de lecture : le bandeau s'efface.
      console.warn("[inbox] Compte des contributions Pending_AI impossible :", err);
      setPendingAi(null);
    }
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (filterStatus) params.set("status", filterStatus);
      if (filterCategory) params.set("ai_category", filterCategory);

      const res = await fetch(`/api/admin/inbox?${params}`);
      if (!res.ok) throw new Error("Impossible de charger les tickets");
      const data = await res.json();
      setTickets(data.data);
      setTotal(data.pagination.total);
      void fetchPendingAi();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterCategory, fetchPendingAi]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const openTicket = (t: Ticket) => {
    setSelectedTicket(JSON.parse(JSON.stringify(t))); // deep copy pour édition
    setPanelOpen(true);
    setActionMsg(null);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setSelectedTicket(null);
  };

  const handleValidate = async (overrideJson?: Record<string, unknown>) => {
    if (!selectedTicket) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const body = overrideJson ?? selectedTicket.ai_extracted_json ?? {};
      const res = await fetch(`/api/admin/inbox/${selectedTicket.id}/validate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la validation");
      setActionMsg({ type: "success", text: data.message || "Ticket validé" });
      fetchTickets();
      // Mettre à jour le ticket affiché
      setSelectedTicket((prev) => prev ? { ...prev, status: "Validated" } : null);
    } catch (err: unknown) {
      setActionMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur inconnue" });
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!selectedTicket) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/inbox/${selectedTicket.id}/reject`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors du rejet");
      setActionMsg({ type: "success", text: "Ticket rejeté" });
      fetchTickets();
      setSelectedTicket((prev) => prev ? { ...prev, status: "Rejected" } : null);
    } catch (err: unknown) {
      setActionMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur inconnue" });
    } finally {
      setActionLoading(false);
    }
  };

  const fetchPurgeCount = async (statuses: string[]) => {
    try {
      let totalCount = 0;
      for (const status of statuses) {
        const res = await fetch(`/api/admin/inbox?status=${status}&limit=1`);
        if (res.ok) {
          const data = await res.json();
          totalCount += data.pagination.total;
        }
      }
      setPurgeCount(totalCount);
    } catch {
      setPurgeCount(null);
    }
  };

  const handlePurge = async () => {
    setPurgeLoading(true);
    setPurgeError(null);
    try {
      const res = await fetch("/api/admin/inbox/purge", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statuses: purgeStatuses }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la purge");
      setPurgeModalOpen(false);
      fetchTickets();
    } catch (err: unknown) {
      // D67 : dans la fenêtre, restée ouverte ; la page derrière est inerte.
      setPurgeError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setPurgeLoading(false);
    }
  };

  // Échap, « Annuler » et un clic à côté ne ferment pas la fenêtre pendant la purge.
  const closePurge = () => {
    if (!purgeLoading) setPurgeModalOpen(false);
  };

  const totalPages = Math.ceil(total / LIMIT);
  // Trois liens au plus pour un ticket du pipeline, y compris ceux écrits
  // avant la coupe ; les contributions du public gardent toutes leurs URL.
  const selectedSources = selectedTicket
    ? displayedTicketSources(selectedTicket, selectedTicket.schoolOfficialDomain ?? null)
    : [];

  return (
    <AdminPage
      title="Boîte de Réception — Validation IA"
      description="Examinez et validez les données extraites par le pipeline IA avant publication."
      actions={
        <>
          <span className="text-sm text-ink-2">
            {total} ticket{total !== 1 ? "s" : ""}
          </span>
          <Button
            id="btn-open-purge"
            variant="danger-soft"
            onClick={() => {
              setPurgeError(null);
              setPurgeModalOpen(true);
              fetchPurgeCount(purgeStatuses);
            }}
          >
            Purger
          </Button>
        </>
      }
    >
      {pendingAi !== null && describePendingAi(pendingAi) && (
        <Alert tone="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {describePendingAi(pendingAi)} Passage en <code className="font-mono text-xs">Pending_Admin</code> au prochain
              lancement du backend, sur le poste de l&apos;admin.
            </span>
            {filterStatus !== STATUS_PENDING_AI && (
              <Button
                size="sm"
                onClick={() => {
                  setFilterStatus(STATUS_PENDING_AI);
                  setPage(1);
                }}
              >
                Voir
              </Button>
            )}
          </div>
        </Alert>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {/* ── Filtres ── */}
      <div className="flex flex-wrap items-end gap-3">
        <Field id="filter-status" label="Statut" className="w-50">
          {(control) => (
            <Select
              {...control}
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            >
              <option value="">Tous les statuts</option>
              {STATUS_OPTIONS.filter(Boolean).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="filter-category" label="Catégorie" className="w-55">
          {(control) => (
            <Select
              {...control}
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
            >
              <option value="">Toutes les catégories</option>
              {CATEGORY_OPTIONS.filter(Boolean).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          )}
        </Field>

        {(filterStatus || filterCategory) && (
          <Button onClick={() => { setFilterStatus(""); setFilterCategory(""); setPage(1); }}>
            Réinitialiser
          </Button>
        )}
      </div>

      {/* ── Table des tickets ── */}
      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des tickets...</p>
      ) : tickets.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-6 py-12 text-center text-sm text-ink-2">
          Aucun ticket trouvé avec ces filtres.
        </p>
      ) : (
        <Table caption="Tickets">
          <THead>
            <Tr>
              <Th>Catégorie</Th>
              <Th>Source</Th>
              <Th>École / Campus / Parcours</Th>
              <Th>Alertes</Th>
              <Th>Statut</Th>
              <Th>Date</Th>
              <Th align="right">Action</Th>
            </Tr>
          </THead>
          <TBody>
            {tickets.map((t) => (
              <Tr
                key={t.id}
                className="cursor-pointer transition-colors hover:bg-surface-2"
                onClick={() => openTicket(t)}
              >
                <Td className="font-semibold text-ink">{t.ai_category}</Td>
                <Td className="text-xs text-ink-2">{t.source_type}</Td>
                <Td>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-ink">
                      {t.schoolName || (t.schoolId ? t.schoolId.substring(0, 8) + "…" : "—")}
                    </span>
                    {(t.campusName || t.programName) && (
                      <div className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-ink-2">
                        {t.campusName && (
                          <span className="inline-flex items-center gap-0.5">
                            <PinIcon />
                            {t.campusName}
                          </span>
                        )}
                        {t.programName && <span>{t.programName}</span>}
                      </div>
                    )}
                  </div>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {t.year_assumed && (
                      <span title="Année supposée par l'IA">
                        <Badge tone={FLAG_TONES.year_assumed}>Année supposée</Badge>
                      </span>
                    )}
                    {t.data_conflict_warning && (
                      <span title="Conflit de données détecté">
                        <Badge tone={FLAG_TONES.data_conflict_warning}>Conflit</Badge>
                      </span>
                    )}
                    {t.program_name_mismatch && (
                      <span title="Nom de programme incohérent">
                        <Badge tone={FLAG_TONES.program_name_mismatch}>Nom incohérent</Badge>
                      </span>
                    )}
                  </div>
                </Td>
                <Td>
                  <Badge tone={ticketStatusTone(t.status)}>{t.status}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-ink-2">
                  {new Date(t.createdAt).toLocaleDateString("fr-FR")}
                </Td>
                <Td align="right">
                  <Button
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); openTicket(t); }}
                  >
                    Examiner →
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Précédent
          </Button>
          <span className="px-3 text-sm text-ink-2">
            Page {page} / {totalPages}
          </span>
          <Button
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Suivant →
          </Button>
        </div>
      )}

      {/* ── Panneau de détail, collé à droite (D76) ── */}
      {panelOpen && selectedTicket && (
        <Dialog placement="side" closeOnBackdrop titleId="inbox-panel-title" title={selectedTicket.ai_category} onClose={closePanel}>
          <div className="flex flex-col gap-1 border-b border-line pb-4">
            <p className="text-xs break-all text-ink-2">ID: {selectedTicket.id}</p>
            {(selectedTicket.schoolName || selectedTicket.schoolId) && (
              <div className="flex flex-col gap-0.5 pt-1">
                <span className="font-semibold text-ink">{selectedTicket.schoolName || selectedTicket.schoolId}</span>
                {(selectedTicket.campusName || selectedTicket.programName) && (
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-2">
                    {selectedTicket.campusName && (
                      <span className="inline-flex items-center gap-1">
                        <PinIcon />
                        {selectedTicket.campusName}
                      </span>
                    )}
                    {selectedTicket.programName && <span>{selectedTicket.programName}</span>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Badges d'alerte — toujours visibles (task.md §3.3) */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ticketStatusTone(selectedTicket.status)}>{selectedTicket.status}</Badge>
            <span className="text-xs text-ink-2">{selectedTicket.source_type}</span>
            {selectedTicket.year_assumed && (
              <Badge tone={FLAG_TONES.year_assumed} wrap>Année supposée — Vérifier l&apos;année</Badge>
            )}
            {selectedTicket.data_conflict_warning && (
              <Badge tone={FLAG_TONES.data_conflict_warning} wrap>Conflit de données — Sources contradictoires</Badge>
            )}
            {selectedTicket.program_name_mismatch && (
              <Badge tone={FLAG_TONES.program_name_mismatch} wrap>Nom de programme incohérent</Badge>
            )}
          </div>

          {/* URLs source : trois au plus pour un ticket du pipeline (lib/ticket-sources.ts) */}
          {selectedSources.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold text-ink">Sources :</p>
              <ul className="flex flex-col gap-1">
                {selectedSources.map((url, i) => (
                  <li key={i} className="text-xs break-all text-ink-2">
                    <WebLink url={url}>{url}</WebLink>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Commentaire utilisateur — bloc secondaire, conditionnel */}
          {selectedTicket.user_text && (
            <aside className="border-l-3 border-line-strong pl-3">
              <p className="mb-1 text-xs font-semibold tracking-wider text-ink-2 uppercase">
                Note du contributeur
              </p>
              <p className="text-sm text-ink">{selectedTicket.user_text}</p>
            </aside>
          )}

          {/* ── Formulaire par catégorie ── */}
          <div>
            {selectedTicket.ai_category === "Program_Discovery" &&
            hasCampusAttachmentBlock(selectedTicket.ai_extracted_json) ? (
              // Même catégorie, autre charge : ces lignes s'écrivent par la
              // route voisine, jamais par le formulaire répéteur.
              <CampusAttachmentsForm
                ticket={selectedTicket}
                disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
                onWritten={() => {
                  fetchTickets();
                  setSelectedTicket((prev) => (prev ? { ...prev, status: "Validated" } : null));
                }}
              />
            ) : selectedTicket.ai_category === "Program_Discovery" ? (
              <ProgramDiscoveryForm
                ticket={selectedTicket}
                onValidate={handleValidate}
                loading={actionLoading}
                disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
              />
            ) : selectedTicket.ai_category === "Accreditation" ? (
              <AccreditationListForm
                ticket={selectedTicket}
                onValidate={handleValidate}
                loading={actionLoading}
                disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
              />
            ) : (selectedTicket.ai_extracted_json as any)?.programs ? (
              <MultiProgramForm
                ticket={selectedTicket}
                onValidate={handleValidate}
                loading={actionLoading}
                disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
                onRefreshTicket={async () => {
                  // Recharger le ticket depuis l'API pour avoir le JSON mis à
                  // jour. Un échec s'affiche : l'admin ne doit pas valider
                  // sans le savoir sur des données anciennes (F6,
                  // lib/ticket-refresh.ts).
                  try {
                    const res = await fetch(`/api/admin/inbox/${selectedTicket.id}`);
                    const refreshed = readRefreshedTicket<Ticket>(
                      res.status,
                      await res.json().catch(() => null)
                    );
                    if (refreshed.ok) setSelectedTicket(refreshed.ticket);
                    else setActionMsg({ type: "error", text: refreshed.error });
                  } catch {
                    setActionMsg({ type: "error", text: TICKET_REFRESH_ERROR });
                  }
                  fetchTickets();
                }}
              />
            ) : (
              <GenericForm
                ticket={selectedTicket}
                onValidate={handleValidate}
                loading={actionLoading}
                disabled={selectedTicket.status === "Validated" || selectedTicket.status === "Rejected"}
              />
            )}
          </div>

          {/* Message d'action */}
          {actionMsg && (
            <Alert tone={actionMsg.type === "success" ? "success" : "danger"}>{actionMsg.text}</Alert>
          )}

          {/* Bouton Rejeter (commun à toutes les catégories) */}
          {selectedTicket.status !== "Validated" && selectedTicket.status !== "Rejected" && (
            <div className="border-t border-line pt-4">
              <Button
                id="btn-reject-ticket"
                variant="danger"
                className="w-full"
                onClick={handleReject}
                disabled={actionLoading}
              >
                {actionLoading ? "Rejet en cours..." : "Rejeter ce ticket"}
              </Button>
            </div>
          )}
        </Dialog>
      )}

      {/* ── Fenêtre de purge ── */}
      {purgeModalOpen && (
        <Dialog titleId="inbox-purge-title" title="Purger les tickets traités" onClose={closePurge} closeOnBackdrop>
          {purgeError && <Alert tone="danger">{purgeError}</Alert>}

          <Field id="purge-status-filter" label="Statuts à supprimer">
            {(control) => (
              <Select
                {...control}
                value={purgeStatuses.join(",")}
                onChange={(e) => {
                  const val = e.target.value;
                  const newStatuses = val.split(",");
                  setPurgeStatuses(newStatuses);
                  fetchPurgeCount(newStatuses);
                }}
                data-autofocus
              >
                <option value="Validated,Rejected">Validés + Rejetés</option>
                <option value="Validated">Validés uniquement</option>
                <option value="Rejected">Rejetés uniquement</option>
              </Select>
            )}
          </Field>

          {purgeCount !== null && (
            <p className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-center text-sm text-ink">
              <strong className="font-semibold">{purgeCount}</strong> ticket{purgeCount !== 1 ? "s" : ""} seront supprimés définitivement
            </p>
          )}

          <DialogFooter>
            <Button onClick={closePurge} disabled={purgeLoading}>
              Annuler
            </Button>
            <Button
              id="btn-confirm-purge"
              variant="danger"
              onClick={handlePurge}
              disabled={purgeLoading || purgeCount === 0}
            >
              {purgeLoading ? "Suppression..." : "Confirmer la suppression"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </AdminPage>
  );
}

// ──────────────────────────────────────────────
// Formulaire répéteur — Program_Discovery (Super Ticket)
// Référence : task.md §3.2, architecture.md §5.2
// ──────────────────────────────────────────────

function ProgramDiscoveryForm({
  ticket,
  onValidate,
  loading,
  disabled,
}: {
  ticket: Ticket;
  onValidate: (data: Record<string, unknown>) => void;
  loading: boolean;
  disabled: boolean;
}) {
  const initial = ticket.ai_extracted_json as { discovered_campuses?: DiscoveredCampus[] } | null;

  const [campuses, setCampuses] = useState<DiscoveredCampus[]>(
    initial?.discovered_campuses ?? []
  );

  const updateCampusName = (ci: number, val: string) => {
    setCampuses((prev) => prev.map((c, i) => i === ci ? { ...c, name: val } : c));
  };

  const updateCampusCity = (ci: number, val: string) => {
    setCampuses((prev) => prev.map((c, i) => i === ci ? { ...c, city: val } : c));
  };

  const removeCampus = (ci: number) => {
    setCampuses((prev) => prev.filter((_, i) => i !== ci));
  };

  const addCampus = () => {
    setCampuses((prev) => [...prev, { name: "", city: "", programs: [] }]);
  };

  const updateProgram = (ci: number, pi: number, field: keyof DiscoveredProgram, val: string | boolean | null) => {
    setCampuses((prev) =>
      prev.map((c, i) =>
        i !== ci ? c : {
          ...c,
          programs: c.programs.map((p, j) =>
            j !== pi ? p : { ...p, [field]: val }
          ),
        }
      )
    );
  };

  const removeProgram = (ci: number, pi: number) => {
    setCampuses((prev) =>
      prev.map((c, i) =>
        i !== ci ? c : { ...c, programs: c.programs.filter((_, j) => j !== pi) }
      )
    );
  };

  const addProgram = (ci: number) => {
    setCampuses((prev) =>
      prev.map((c, i) =>
        i !== ci ? c : {
          ...c,
          programs: [...c.programs, { name: "", admission_exam: null, is_alternance_possible: false, is_expatriation_mandatory: false }],
        }
      )
    );
  };

  const handleSubmit = () => {
    onValidate({ discovered_campuses: campuses });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FormTitle>Campus & Programmes découverts ({campuses.length} campus)</FormTitle>
        {!disabled && (
          <Button id="btn-add-campus" size="sm" onClick={addCampus}>
            + Ajouter un campus
          </Button>
        )}
      </div>

      {campuses.length === 0 && (
        <p className="text-sm text-ink-2 italic">Aucun campus détecté dans le JSON.</p>
      )}

      {campuses.map((campus, ci) => (
        <div key={ci} className="flex flex-col gap-3 rounded-card border border-line bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="font-semibold text-ink">Campus {ci + 1}</strong>
            {!disabled && (
              <Button size="sm" variant="danger-soft" onClick={() => removeCampus(ci)}>
                Supprimer campus
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`campus-name-${ci}`} label="Nom du campus *">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={campus.name}
                  onChange={(e) => updateCampusName(ci, e.target.value)}
                  disabled={disabled}
                  placeholder="ex: Campus Paris La Défense"
                />
              )}
            </Field>
            <Field id={`campus-city-${ci}`} label="Ville">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={campus.city ?? ""}
                  onChange={(e) => updateCampusCity(ci, e.target.value)}
                  disabled={disabled}
                  placeholder="ex: Paris"
                />
              )}
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">
                Programmes ({campus.programs.length})
              </span>
              {!disabled && (
                <Button size="sm" onClick={() => addProgram(ci)}>
                  + Programme
                </Button>
              )}
            </div>

            {campus.programs.map((prog, pi) => (
              <div key={pi} className="flex items-start gap-2 rounded-control border border-line bg-surface p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Field id={`prog-name-${ci}-${pi}`} label="Nom exact du programme">
                    {(control) => (
                      <Input
                        {...control}
                        type="text"
                        value={prog.name}
                        onChange={(e) => updateProgram(ci, pi, "name", e.target.value)}
                        disabled={disabled}
                        placeholder="Nom exact du programme"
                      />
                    )}
                  </Field>
                  <Field id={`prog-exam-${ci}-${pi}`} label="Concours d'admission (optionnel)">
                    {(control) => (
                      <Input
                        {...control}
                        type="text"
                        value={prog.admission_exam ?? ""}
                        onChange={(e) => updateProgram(ci, pi, "admission_exam", e.target.value || null)}
                        disabled={disabled}
                        placeholder="Concours d'admission (optionnel)"
                      />
                    )}
                  </Field>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-accent"
                        checked={prog.is_alternance_possible ?? false}
                        onChange={(e) => updateProgram(ci, pi, "is_alternance_possible", e.target.checked)}
                        disabled={disabled}
                      />
                      Alternance possible
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-accent"
                        checked={prog.is_expatriation_mandatory ?? false}
                        onChange={(e) => updateProgram(ci, pi, "is_expatriation_mandatory", e.target.checked)}
                        disabled={disabled}
                      />
                      Expatriation obligatoire
                    </label>
                  </div>
                </div>
                {!disabled && (
                  <Button
                    size="icon"
                    variant="danger-soft"
                    aria-label="Supprimer ce programme"
                    title="Supprimer ce programme"
                    onClick={() => removeProgram(ci, pi)}
                  >
                    <RemoveIcon />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {!disabled && (
        <Button
          id="btn-validate-discovery"
          variant="primary"
          className="w-full"
          onClick={handleSubmit}
          disabled={loading || campuses.length === 0}
        >
          {loading ? "Validation en cours..." : "Valider — Créer Campus & Programmes"}
        </Button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Rattachement campus — lignes-années et notes de politique de campus
//
// Un ticket Program_Discovery qui porte `campus_attachments` vient de la
// collecte de la Phase 1. Il ne crée ni Campus, ni Program, ni arête : chaque
// ligne se pose sur une arête ProgramCampus existante, et une ligne dont
// l'arête manque ressort en conflit `edge_missing`. L'admin retire ici ce
// qu'il refuse ; le corps envoyé prime sur le JSON du ticket.
// ──────────────────────────────────────────────

interface CampusAttachmentClaim {
  programId: string | null;
  campusId: string | null;
  program?: string | null;
  campus?: string | null;
  fiche?: string | null;
  study_year: number;
  regime?: string | null;
  languages?: string[];
  note?: string | null;
  source_url?: string | null;
}

interface CampusPolicyNoteClaim {
  programId: string | null;
  program?: string | null;
  fiche?: string | null;
  note: string;
}

interface WriteCounts {
  created: number;
  updated: number;
  unchanged: number;
}

interface AttachmentWriteResult {
  message?: string;
  written?: WriteCounts;
  stale?: Array<{ program: string | null; campus: string | null; study_year: number; regime: string }>;
  policy_notes?: { written: WriteCounts };
  conflicts?: Array<{
    type: string;
    program?: string | null;
    campus?: string | null;
    study_year?: number;
    regime?: string;
    effect: string;
  }>;
}

function CampusAttachmentsForm({
  ticket,
  disabled,
  onWritten,
}: {
  ticket: Ticket;
  disabled: boolean;
  onWritten: () => void;
}) {
  const initial = ticket.ai_extracted_json as {
    campus_attachments?: CampusAttachmentClaim[];
    campus_policy_notes?: CampusPolicyNoteClaim[];
    collector?: {
      unresolved_claims?: unknown[];
      placements_not_written?: number;
      pages_read?: number;
      plan_at_collection?: {
        attachments?: { create: number; update: number; unchanged: number };
        policy_notes?: { create: number; update: number; unchanged: number };
      };
    };
  } | null;
  const planned = initial?.collector?.plan_at_collection;

  const [rows, setRows] = useState<CampusAttachmentClaim[]>(() =>
    [...(initial?.campus_attachments ?? [])].sort((a, b) =>
      `${a.program} ${a.campus} ${a.study_year} ${a.regime}`.localeCompare(
        `${b.program} ${b.campus} ${b.study_year} ${b.regime}`
      )
    )
  );
  const [notes, setNotes] = useState<CampusPolicyNoteClaim[]>(initial?.campus_policy_notes ?? []);
  const [writing, setWriting] = useState(false);
  const [result, setResult] = useState<AttachmentWriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const removed =
    (initial?.campus_attachments?.length ?? 0) - rows.length +
    (initial?.campus_policy_notes?.length ?? 0) - notes.length;

  const handleWrite = async () => {
    setWriting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/inbox/${ticket.id}/attachments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campus_attachments: rows, campus_policy_notes: notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de l'écriture");
      setResult(data);
      onWritten();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setWriting(false);
    }
  };

  const conflictsByType = (result?.conflicts ?? []).reduce<Record<string, number>>((acc, c) => {
    acc[c.type] = (acc[c.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-3">
      <FormTitle>
        Rattachement campus — {rows.length} ligne(s)-année(s), {notes.length} note(s)
      </FormTitle>
      {planned && (
        <p className="text-sm text-ink">
          Au moment de la collecte : {planned.attachments?.create ?? 0} ligne(s) à créer,{" "}
          {planned.attachments?.update ?? 0} à mettre à jour, {planned.attachments?.unchanged ?? 0} déjà
          en base ; {(planned.policy_notes?.create ?? 0) + (planned.policy_notes?.update ?? 0)} note(s) à
          écrire. La route recalcule ce plan au moment d&apos;écrire.
        </p>
      )}
      <p className="text-xs leading-relaxed text-ink-2">
        Aucune arête n&apos;est créée : une ligne dont l&apos;arête ProgramCampus manque n&apos;est pas
        écrite. Aucune ligne n&apos;est supprimée.
        {initial?.collector?.placements_not_written
          ? ` ${initial.collector.placements_not_written} lieu(x) hors parc collecté(s) ne sont pas proposé(s) : ProgramPlacement n'a pas de chemin d'écriture.`
          : ""}
        {initial?.collector?.unresolved_claims?.length
          ? ` ${initial.collector.unresolved_claims.length} ligne(s) sans programme ou campus en base sont écartée(s) (voir le JSON brut).`
          : ""}
      </p>

      {rows.length > 0 && (
        <Table caption="Rattachement campus">
          <THead>
            <Tr>
              <Th>Programme</Th>
              <Th>Campus</Th>
              <Th>Année</Th>
              <Th>Régime</Th>
              <Th>Langues</Th>
              <Th>Fiche</Th>
              {!disabled && <Th />}
            </Tr>
          </THead>
          <TBody>
            {rows.map((row, index) => (
              <Tr key={`${row.programId}-${row.campusId}-${row.study_year}-${row.regime}-${row.fiche}-${index}`}>
                <Td>{row.program ?? row.programId}</Td>
                <Td>{row.campus ?? row.campusId}</Td>
                <Td>{row.study_year}</Td>
                <Td>{row.regime ?? "ANY"}</Td>
                <Td>{(row.languages ?? []).join(", ") || "—"}</Td>
                <Td className="text-xs">
                  {row.source_url ? (
                    <WebLink url={row.source_url}>
                      {row.fiche ?? "source"}
                    </WebLink>
                  ) : (
                    row.fiche ?? "—"
                  )}
                </Td>
                {!disabled && (
                  <Td>
                    <Button
                      size="icon"
                      variant="danger-soft"
                      aria-label="Retirer cette ligne avant l'écriture"
                      title="Retirer cette ligne avant l'écriture"
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <RemoveIcon />
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {notes.map((note, index) => (
        <div key={`${note.programId}-${index}`} className="flex flex-col gap-2 rounded-card border border-line bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="font-semibold text-ink">Note de politique de campus — {note.program ?? note.programId}</strong>
            {!disabled && (
              <Button
                size="sm"
                variant="danger-soft"
                onClick={() => setNotes((prev) => prev.filter((_, i) => i !== index))}
              >
                Retirer
              </Button>
            )}
          </div>
          <p className="text-sm text-ink">« {note.note} »</p>
        </div>
      ))}

      {removed > 0 && !disabled && (
        <p className="text-xs text-ink-2">
          {removed} élément(s) retiré(s) : ils ne seront pas écrits.
        </p>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {result && (
        <Alert tone="success">
          <div>{result.message}</div>
          {Object.keys(conflictsByType).length > 0 && (
            <div className="mt-1.5 text-xs">
              Non écrit ou fusionné :{" "}
              {Object.entries(conflictsByType)
                .map(([type, count]) => `${type} ×${count}`)
                .join(" · ")}
            </div>
          )}
          {(result.stale?.length ?? 0) > 0 && (
            <div className="mt-1.5 text-xs">
              {result.stale!.length} ligne(s) en base non réaffirmée(s), conservée(s) :{" "}
              {result.stale!.map((s) => `${s.program} · ${s.campus} · année ${s.study_year}`).join(" ; ")}
            </div>
          )}
        </Alert>
      )}

      <RawJson json={ticket.ai_extracted_json} />

      {!disabled && (
        <Button
          id="btn-write-campus-attachments"
          variant="primary"
          className="w-full"
          onClick={handleWrite}
          disabled={writing || rows.length + notes.length === 0}
        >
          {writing
            ? "Écriture en cours..."
            : `Écrire ${rows.length} ligne(s)-année(s) et ${notes.length} note(s)`}
        </Button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Formulaire générique — Pricing, Ranking, Capacity, SchoolStats, Accreditation
// Référence : task.md §3.3, architecture.md §5.3
// ──────────────────────────────────────────────

// Une voie d'admission d'un ticket Capacity au nouveau format.
interface CapacityChannel {
  spots_available: number;
  academic_year?: number | null;
  admission_channel?: string | null;
  source_url?: string | null;
}

/** Le libellé d'un champ, et son astérisque s'il est requis. */
function fieldLabel(label: string, required?: boolean): ReactNode {
  return (
    <>
      {label}
      {required && <span className="text-danger"> *</span>}
    </>
  );
}

function GenericForm({
  ticket,
  onValidate,
  loading,
  disabled,
}: {
  ticket: Ticket;
  onValidate: (data: Record<string, unknown>) => void;
  loading: boolean;
  disabled: boolean;
}) {
  const [formData, setFormData] = useState<Record<string, unknown>>(
    (ticket.ai_extracted_json as Record<string, unknown>) ?? {}
  );

  const update = (key: string, val: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: val }));
  };

  const fields = getFieldsForCategory(ticket.ai_category);

  // Capacity nouveau format : le pipeline extrait une entrée par voie
  // d'admission (SESAME, ACCÈS, Parcoursup…), parce que c'est ainsi que les
  // places sont publiées. CapacityRecord n'en garde qu'une par année, et la
  // recomposition est un arbitrage — donc humain. Les voies sont affichées
  // ici ; laisser « Places disponibles » vide fait appliquer la règle par
  // défaut du serveur (total publié s'il existe, somme sinon), et y saisir un
  // chiffre prime sur le tableau.
  const capacityChannels = (
    (ticket.ai_extracted_json as { capacities?: CapacityChannel[] } | null)?.capacities ?? []
  ).filter((item) => item && item.spots_available != null);

  return (
    <div className="flex flex-col gap-4">
      <FormTitle>Données extraites — {ticket.ai_category}</FormTitle>

      {capacityChannels.length > 0 && (
        <div className="flex flex-col gap-2 rounded-control border border-line px-3.5 py-3 text-compact">
          <strong className="font-semibold text-ink">
            Voies d&apos;admission détectées ({capacityChannels.length})
          </strong>
          <ul className="flex list-disc flex-col gap-1 pl-4.5">
            {capacityChannels.map((item, idx) => (
              <li key={idx}>
                <strong className="font-semibold">{item.spots_available}</strong> place(s)
                {item.admission_channel ? ` — ${item.admission_channel}` : ""}
                {item.academic_year ? ` (${item.academic_year})` : ""}
                {item.source_url && (
                  <>
                    {" — "}
                    <WebLink url={item.source_url} icon>
                      source
                    </WebLink>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="text-ink-2">
            Laisser « Places disponibles » vide applique la règle par défaut :
            le total publié s&apos;il en existe un, la somme des voies sinon.
            Un chiffre saisi ici fait autorité.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(({ key, label, type, required }) => (
          <Field key={key} id={`field-${key}`} label={fieldLabel(label, required)}>
            {(control) =>
              type === "boolean" ? (
                <Select
                  {...control}
                  value={String(formData[key] ?? "")}
                  onChange={(e) => update(key, e.target.value === "true" ? true : e.target.value === "false" ? false : null)}
                  disabled={disabled}
                >
                  <option value="">—</option>
                  <option value="true">Oui</option>
                  <option value="false">Non</option>
                </Select>
              ) : type === "number" ? (
                <Input
                  {...control}
                  type="number"
                  className="font-mono tabular-nums"
                  value={formData[key] != null ? String(formData[key]) : ""}
                  onChange={(e) => update(key, e.target.value ? Number(e.target.value) : null)}
                  disabled={disabled}
                />
              ) : (
                <Input
                  {...control}
                  type="text"
                  value={formData[key] != null ? String(formData[key]) : ""}
                  onChange={(e) => update(key, e.target.value || null)}
                  disabled={disabled}
                />
              )
            }
          </Field>
        ))}
      </div>

      {/* JSON brut (lecture seule) */}
      <RawJson json={ticket.ai_extracted_json} />

      {!disabled && (
        <Button
          id="btn-validate-generic"
          variant="primary"
          className="w-full"
          onClick={() => onValidate(formData)}
          disabled={loading}
        >
          {loading ? "Validation en cours..." : `Valider et publier — ${ticket.ai_category}`}
        </Button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Définition des champs par catégorie
// ──────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "boolean";
  required?: boolean;
}

function getFieldsForCategory(category: string): FieldDef[] {
  switch (category) {
    case "Pricing":
      return [
        { key: "academic_year", label: "Année académique", type: "number", required: true },
        { key: "currency", label: "Devise", type: "text" },
        { key: "year_1_fee", label: "Frais Année 1 (€)", type: "number" },
        { key: "year_2_fee", label: "Frais Année 2 (€)", type: "number" },
        { key: "year_3_fee", label: "Frais Année 3 (€)", type: "number" },
        { key: "year_4_fee", label: "Frais Année 4 (€)", type: "number" },
        { key: "year_5_fee", label: "Frais Année 5 (€)", type: "number" },
        { key: "total_fee", label: "Total cursus (€)", type: "number" },
        { key: "intl_year_1_fee", label: "Frais An.1 Non-UE", type: "number" },
        { key: "intl_total_fee", label: "Total Non-UE", type: "number" },
        { key: "intl_currency", label: "Devise Non-UE", type: "text" },
        { key: "additional_fees_notes", label: "Frais annexes (notes)", type: "text" },
        { key: "source_url", label: "URL source", type: "text" },
        { key: "year_assumed", label: "Année supposée ?", type: "boolean" },
        { key: "data_conflict_warning", label: "Conflit de données ?", type: "boolean" },
      ];

    case "Ranking":
      return [
        { key: "ranking_name", label: "Nom du classement", type: "text", required: true },
        { key: "rank", label: "Rang", type: "number", required: true },
        { key: "academic_year", label: "Année académique", type: "number", required: true },
        { key: "source_url", label: "URL source", type: "text" },
        { key: "data_conflict_warning", label: "Conflit de données ?", type: "boolean" },
      ];

    case "Capacity":
      return [
        { key: "spots_available", label: "Places disponibles", type: "number", required: true },
        { key: "academic_year", label: "Année académique", type: "number", required: true },
        { key: "source_url", label: "URL source", type: "text" },
        { key: "year_assumed", label: "Année supposée ?", type: "boolean" },
      ];

    case "SchoolStats":
      return [
        { key: "academic_year", label: "Année académique", type: "number", required: true },
        { key: "total_students", label: "Total étudiants", type: "number" },
        { key: "total_alumni", label: "Total alumni", type: "number" },
        { key: "partner_companies", label: "Entreprises partenaires", type: "number" },
        { key: "annual_internship_offers", label: "Offres de stage/an", type: "number" },
        { key: "abroad_campuses", label: "Campus à l'étranger", type: "number" },
        { key: "partner_universities", label: "Univ. partenaires", type: "number" },
        { key: "permanent_professors", label: "Profs permanents", type: "number" },
        { key: "international_professors_pct", label: "% Profs internationaux", type: "number" },
        { key: "external_speakers_pct", label: "% Intervenants externes", type: "number" },
      ];

    case "Accreditation":
      return [
        { key: "accreditation_name", label: "Nom accréditation", type: "text", required: true },
        // Non requise : l'année n'est pas toujours publiée, et la colonne
        // accepte désormais NULL plutôt que la sentinelle 0.
        { key: "year_obtained", label: "Année d'obtention", type: "number" },
        { key: "is_active", label: "Active ?", type: "boolean" },
      ];

    default:
      return [];
  }
}

// ──────────────────────────────────────────────
// Formulaire répéteur — Accreditation (Liste d'accréditations)
// ──────────────────────────────────────────────

interface AccreditationListItem {
  accreditation_name: string;
  accreditation_type: "international" | "label" | "state";
  // null = année inconnue. L'ancienne sentinelle 0 partait en production
  // comme une année réelle.
  year_obtained: number | null;
  is_active: boolean;
  source_url?: string | null;
}

function AccreditationListForm({
  ticket,
  onValidate,
  loading,
  disabled,
}: {
  ticket: Ticket;
  onValidate: (data: Record<string, unknown>) => void;
  loading: boolean;
  disabled: boolean;
}) {
  const initial = ticket.ai_extracted_json as {
    accreditations?: AccreditationListItem[];
    accreditation_name?: string;
    accreditation_type?: "international" | "label" | "state";
    year_obtained?: number | null;
    is_active?: boolean;
    source_url?: string | null;
  } | null;

  const [accreditations, setAccreditations] = useState<AccreditationListItem[]>(() => {
    if (initial?.accreditations && Array.isArray(initial.accreditations)) {
      return initial.accreditations.map((item) => ({
        accreditation_name: item.accreditation_name || "",
        accreditation_type: item.accreditation_type || "international",
        year_obtained: item.year_obtained ?? null,
        is_active: item.is_active ?? true,
        source_url: item.source_url || null,
      }));
    }
    // Rétrocompatibilité : format objet unique
    if (initial?.accreditation_name) {
      return [{
        accreditation_name: initial.accreditation_name,
        accreditation_type: initial.accreditation_type || "international",
        year_obtained: initial.year_obtained ?? null,
        is_active: initial.is_active ?? true,
        source_url: initial.source_url || null,
      }];
    }
    return [];
  });

  const updateItem = (index: number, field: keyof AccreditationListItem, val: any) => {
    setAccreditations((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: val } : item))
    );
  };

  const removeItem = (index: number) => {
    setAccreditations((prev) => prev.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setAccreditations((prev) => [
      ...prev,
      { accreditation_name: "", accreditation_type: "international", year_obtained: new Date().getFullYear(), is_active: true },
    ]);
  };

  const handleSubmit = () => {
    onValidate({ accreditations });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FormTitle>Accréditations et Labels détectés ({accreditations.length})</FormTitle>
        {!disabled && (
          <Button size="sm" onClick={addItem}>
            + Ajouter
          </Button>
        )}
      </div>

      {accreditations.length === 0 && (
        <p className="text-sm text-ink-2 italic">Aucune accréditation détectée dans le JSON.</p>
      )}

      {accreditations.map((item, idx) => (
        <div key={idx} className="flex flex-col gap-3 rounded-card border border-line bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink-2">
              Item #{idx + 1}
            </span>
            {!disabled && (
              <Button size="sm" variant="danger-soft" onClick={() => removeItem(idx)}>
                Supprimer
              </Button>
            )}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field id={`accreditation-${idx}-name`} label="Nom">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={item.accreditation_name}
                  onChange={(e) => updateItem(idx, "accreditation_name", e.target.value)}
                  disabled={disabled}
                />
              )}
            </Field>

            <Field id={`accreditation-${idx}-type`} label="Type">
              {(control) => (
                <Select
                  {...control}
                  value={item.accreditation_type}
                  onChange={(e) => updateItem(idx, "accreditation_type", e.target.value as any)}
                  disabled={disabled}
                >
                  <option value="international">International (EQUIS, AACSB, AMBA...)</option>
                  <option value="state">Reconnu par l&apos;État (Grade, CTI...)</option>
                  <option value="label">Label / Certif (CGE, Qualiopi, DDRS...)</option>
                </Select>
              )}
            </Field>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field id={`accreditation-${idx}-year`} label="Année d'obtention">
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  className="font-mono tabular-nums"
                  value={item.year_obtained ?? ""}
                  onChange={(e) => updateItem(idx, "year_obtained", e.target.value ? Number(e.target.value) : null)}
                  disabled={disabled}
                />
              )}
            </Field>

            <Field id={`accreditation-${idx}-active`} label="Statut actif">
              {(control) => (
                <Select
                  {...control}
                  value={String(item.is_active)}
                  onChange={(e) => updateItem(idx, "is_active", e.target.value === "true")}
                  disabled={disabled}
                >
                  <option value="true">Actif</option>
                  <option value="false">Inactif (Expiré)</option>
                </Select>
              )}
            </Field>
          </div>

          {item.source_url && (
            <p className="text-xs break-all text-ink-2">
              Source : <WebLink url={item.source_url}>{item.source_url}</WebLink>
            </p>
          )}
        </div>
      ))}

      {!disabled && (
        <Button
          id="btn-validate-accreditations"
          variant="primary"
          className="w-full"
          onClick={handleSubmit}
          disabled={loading || accreditations.length === 0}
        >
          {loading ? "Validation en cours..." : "Valider et Publier ces accréditations"}
        </Button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Formulaire répéteur — Multi-Programme (Pricing, Ranking, Capacity)
// Affiche les programmes matchés par l'IA avec leur données extraites
// ──────────────────────────────────────────────

interface MatchedProgramEntry {
  extracted_program_name: string;
  matched_program_id: string | null;
  matched_program_name: string | null;
  match_confidence: "exact" | "fuzzy" | "none";
  data: Record<string, unknown>;
}

interface UnmatchedProgramEntry {
  extracted_program_name: string;
  reason: string;
}

interface MultiProgramJson {
  programs: MatchedProgramEntry[];
  unmatched_programs: UnmatchedProgramEntry[];
  source_url?: string;
  year_assumed?: boolean;
  data_conflict_warning?: boolean;
}

function MultiProgramForm({
  ticket,
  onValidate,
  loading,
  disabled,
  onRefreshTicket,
}: {
  ticket: Ticket;
  onValidate: (data: Record<string, unknown>) => void;
  loading: boolean;
  disabled: boolean;
  onRefreshTicket?: () => Promise<void>;
}) {
  const initial = ticket.ai_extracted_json as MultiProgramJson | null;
  const [programs, setPrograms] = useState<MatchedProgramEntry[]>(initial?.programs ?? []);
  const [unmatchedPrograms, setUnmatchedPrograms] = useState<UnmatchedProgramEntry[]>(initial?.unmatched_programs ?? []);
  const [creatingPrograms, setCreatingPrograms] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Mettre à jour l'état si le ticket parent change
  useEffect(() => {
    const fresh = ticket.ai_extracted_json as MultiProgramJson | null;
    if (fresh) {
      setPrograms(fresh.programs ?? []);
      setUnmatchedPrograms(fresh.unmatched_programs ?? []);
    }
  }, [ticket]);

  // Les champs éditables dépendent de la catégorie
  const fields = getFieldsForCategory(ticket.ai_category);

  const updateProgramData = (progIdx: number, key: string, val: unknown) => {
    setPrograms((prev) =>
      prev.map((p, i) =>
        i !== progIdx ? p : { ...p, data: { ...p.data, [key]: val } }
      )
    );
  };

  const removeProgram = (progIdx: number) => {
    setPrograms((prev) => prev.filter((_, i) => i !== progIdx));
  };

  const handleSubmit = () => {
    onValidate({
      programs,
      unmatched_programs: unmatchedPrograms,
      source_url: initial?.source_url,
      year_assumed: initial?.year_assumed,
      data_conflict_warning: initial?.data_conflict_warning,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <FormTitle>
        Données extraites — {ticket.ai_category} ({programs.length} programme{programs.length !== 1 ? "s" : ""})
      </FormTitle>

      {/* Programmes matchés */}
      {programs.map((prog, idx) => {
        const conf = matchConfidence(prog.match_confidence);
        return (
          <div key={idx} className="flex flex-col gap-3 rounded-card border border-line bg-surface-2 p-4">
            {/* Header du programme */}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col items-start gap-1">
                <span className="text-sm font-bold text-ink">
                  {prog.matched_program_name || prog.extracted_program_name}
                </span>
                {prog.extracted_program_name !== prog.matched_program_name && prog.matched_program_name && (
                  <span className="text-xs text-ink-2 italic">
                    Nom extrait : « {prog.extracted_program_name} »
                  </span>
                )}
                <Badge tone={conf.tone} className="mt-1">
                  {conf.label}
                </Badge>
              </div>
              {!disabled && (
                <Button size="sm" variant="danger-soft" onClick={() => removeProgram(idx)}>
                  Retirer
                </Button>
              )}
            </div>

            {/* Champs de données */}
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map(({ key, label, type, required }) => (
                <Field key={key} id={`program-${idx}-${key}`} label={fieldLabel(label, required)}>
                  {(control) =>
                    type === "boolean" ? (
                      <Select
                        {...control}
                        value={String(prog.data[key] ?? "")}
                        onChange={(e) =>
                          updateProgramData(
                            idx,
                            key,
                            e.target.value === "true" ? true : e.target.value === "false" ? false : null
                          )
                        }
                        disabled={disabled}
                      >
                        <option value="">—</option>
                        <option value="true">Oui</option>
                        <option value="false">Non</option>
                      </Select>
                    ) : type === "number" ? (
                      <Input
                        {...control}
                        type="number"
                        className="font-mono tabular-nums"
                        value={prog.data[key] != null ? String(prog.data[key]) : ""}
                        onChange={(e) => updateProgramData(idx, key, e.target.value ? Number(e.target.value) : null)}
                        disabled={disabled}
                      />
                    ) : (
                      <Input
                        {...control}
                        type="text"
                        value={prog.data[key] != null ? String(prog.data[key]) : ""}
                        onChange={(e) => updateProgramData(idx, key, e.target.value || null)}
                        disabled={disabled}
                      />
                    )
                  }
                </Field>
              ))}
            </div>
          </div>
        );
      })}

      {/* Programmes non matchés */}
      {unmatchedPrograms.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-danger">
            Programmes non matchés ({unmatchedPrograms.length})
          </h4>
          <ul className="flex flex-col gap-1.5">
            {unmatchedPrograms.map((up, idx) => (
              <li key={idx} className="rounded-control border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-ink">
                <strong className="font-semibold">{up.extracted_program_name}</strong>
                <span className="ml-2 text-ink-2">— {up.reason}</span>
              </li>
            ))}
          </ul>

          {createMsg && (
            <Alert tone={createMsg.type === "success" ? "success" : "danger"}>{createMsg.text}</Alert>
          )}

          {!disabled && (
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              disabled={creatingPrograms}
              onClick={async () => {
                setCreatingPrograms(true);
                setCreateMsg(null);
                try {
                  const programNames = unmatchedPrograms.map((u) => u.extracted_program_name);
                  const res = await fetch(`/api/admin/inbox/${ticket.id}/create-programs`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ programNames }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || "Erreur lors de la création");

                  // Update local React state instantly with new updated JSON
                  if (data.updatedJson) {
                    setPrograms(data.updatedJson.programs || []);
                    setUnmatchedPrograms(data.updatedJson.unmatched_programs || []);
                  }

                  setCreateMsg({ type: "success", text: `${data.count} programme(s) créé(s) et rattaché(s) au ticket` });

                  // Refresh parent ticket in background
                  if (onRefreshTicket) await onRefreshTicket();
                } catch (err: unknown) {
                  setCreateMsg({ type: "error", text: err instanceof Error ? err.message : "Erreur inconnue" });
                } finally {
                  setCreatingPrograms(false);
                }
              }}
            >
              {creatingPrograms ? "Création en cours..." : `Créer et rattacher les ${unmatchedPrograms.length} programme(s)`}
            </Button>
          )}
        </div>
      )}

      {/* JSON brut */}
      <RawJson json={ticket.ai_extracted_json} />

      {!disabled && (
        <Button
          variant="primary"
          className="w-full"
          onClick={handleSubmit}
          disabled={loading || programs.length === 0}
        >
          {loading ? "Validation en cours..." : `Valider — ${programs.length} programme(s) ${ticket.ai_category}`}
        </Button>
      )}
    </div>
  );
}
