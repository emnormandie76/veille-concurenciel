"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminPage } from "@/components/layout/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Textarea } from "@/components/ui/Field";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { TEXT_LINK } from "@/components/ui/text-link";
import { RESPONSE_MAX_LENGTH, type ManagerReport, type ReportDecision } from "@/lib/content-reports";

/**
 * La vue des signalements (plan gestion-contenu, étape 6, D31), pour les
 * gestionnaires et les admins.
 *
 * Chaque signalement dit l'école, la cible, la catégorie, le message, le lien
 * éventuel et le nom de son auteur (D39, jamais son adresse). « Ouvrir
 * l'onglet » mène à l'onglet de gestion de la catégorie, où la correction se
 * fait (et reste `MANUAL`, D32) ; « Traiter » et « Rejeter » ferment le
 * signalement, avec une réponse facultative que l'auteur lit sur « Mon
 * compte » (D36). Un signalement fermé ne change plus.
 *
 * Les règles sont tenues par les routes /api/admin/reports ; cet écran ne
 * fait que les montrer.
 */

type Tab = "open" | "closed";
type Decision = { report: ManagerReport; status: ReportDecision } | null;

const STATUS_TONES: Record<string, BadgeTone> = {
  OPEN: "warning",
  RESOLVED: "success",
  REJECTED: "neutral",
};

/** Lit le message d'une réponse ; un corps illisible donne le message par défaut. */
async function messageOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
  const message = res.ok ? body?.message : body?.error;
  return typeof message === "string" ? message : fallback;
}

type Loaded = { ok: true; open: ManagerReport[]; closed: ManagerReport[] } | { ok: false; error: string };

/** Lit les signalements, sans toucher à l'état de l'écran (l'appelant applique le résultat). */
async function loadReports(): Promise<Loaded> {
  try {
    const res = await fetch("/api/admin/reports");
    if (!res.ok) return { ok: false, error: await messageOf(res, "Impossible de charger les signalements.") };
    const body = (await res.json()) as { open: ManagerReport[]; closed: ManagerReport[] };
    return { ok: true, open: body.open, closed: body.closed };
  } catch {
    return { ok: false, error: "Une erreur réseau est survenue. Rechargez la page." };
  }
}

function ReportCard({ report, onDecide }: { report: ManagerReport; onDecide?: (status: ReportDecision) => void }) {
  return (
    <Card aria-labelledby={`report-${report.id}-title`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={`report-${report.id}-title`} className="font-display text-lg leading-snug font-semibold text-ink">
            {report.school.name}
          </h2>
          <p className="text-sm text-ink-2">{report.target}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{report.category_label}</Badge>
          <Badge tone={STATUS_TONES[report.status] ?? "neutral"}>{report.status_label}</Badge>
        </div>
      </div>

      <p className="text-sm leading-relaxed whitespace-pre-line text-ink">{report.message}</p>

      <p className="text-xs text-ink-2">
        Signalé par {report.author ?? "un compte inconnu"} le {report.created_label}
        {report.source_href && (
          <>
            {" · "}
            <a href={report.source_href} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
              Source
            </a>
          </>
        )}
      </p>

      {report.status !== "OPEN" && (
        <div className="flex flex-col gap-1 rounded-control bg-surface-2 px-3 py-2 text-sm">
          <span className="text-xs text-ink-2">
            {report.status_label} par {report.handled_by ?? "un compte inconnu"} le {report.handled_label}
          </span>
          <span className="whitespace-pre-line text-ink">{report.response ?? "Sans réponse à l'auteur."}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Link href={report.manage_href} className={buttonClasses({ size: "sm" })}>
          Ouvrir l&apos;onglet de gestion
        </Link>
        {onDecide && (
          <>
            <Button size="sm" variant="primary" onClick={() => onDecide("RESOLVED")}>
              Traiter
            </Button>
            <Button size="sm" variant="danger-soft" onClick={() => onDecide("REJECTED")}>
              Rejeter
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

export default function ReportsManagerClient() {
  const [open, setOpen] = useState<ManagerReport[]>([]);
  const [closed, setClosed] = useState<ManagerReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("open");

  const [decision, setDecision] = useState<Decision>(null);
  const [response, setResponse] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((loaded: Loaded) => {
    if (loaded.ok) {
      setOpen(loaded.open);
      setClosed(loaded.closed);
      setError(null);
    } else {
      setError(loaded.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadReports().then(apply);
  }, [apply]);

  const decide = (report: ManagerReport, status: ReportDecision) => {
    setDecision({ report, status });
    setResponse("");
    setDialogError(null);
  };
  const close = () => {
    if (!busy) setDecision(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decision) return;
    setBusy(true);
    setDialogError(null);
    try {
      const res = await fetch(`/api/admin/reports/${decision.report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision.status, response }),
      });
      if (!res.ok) {
        setDialogError(await messageOf(res, "L'opération a échoué."));
        return;
      }
      setDecision(null);
      setNotice(await messageOf(res, "Signalement fermé."));
      apply(await loadReports());
    } catch {
      setDialogError("Une erreur réseau est survenue. Veuillez réessayer.");
    } finally {
      setBusy(false);
    }
  };

  const resolving = decision?.status === "RESOLVED";

  return (
    <AdminPage
      title="Signalements"
      description="Les informations que les collègues signalent depuis les fiches. Corrigez la donnée dans l'onglet de gestion, puis marquez le signalement traité, ou rejetez-le. Votre réponse s'affiche sur «&nbsp;Mon compte&nbsp;» de son auteur."
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des signalements...</p>
      ) : (
        <div>
          <Tabs
            label="Signalements"
            idPrefix="reports"
            value={tab}
            onValueChange={(value) => setTab(value as Tab)}
            items={[
              { value: "open", label: "En attente", count: open.length },
              { value: "closed", label: "Fermés", count: closed.length },
            ]}
          />
          <TabPanel idPrefix="reports" value="open" selected={tab === "open"}>
            {open.length === 0 ? (
              <p className="text-sm text-ink-2">Aucun signalement en attente.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {open.map((report) => (
                  <li key={report.id}>
                    <ReportCard report={report} onDecide={(status) => decide(report, status)} />
                  </li>
                ))}
              </ul>
            )}
          </TabPanel>
          <TabPanel idPrefix="reports" value="closed" selected={tab === "closed"}>
            {closed.length === 0 ? (
              <p className="text-sm text-ink-2">Aucun signalement fermé.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {closed.map((report) => (
                  <li key={report.id}>
                    <ReportCard report={report} />
                  </li>
                ))}
              </ul>
            )}
            {closed.length >= 100 && (
              <p className="pt-3 text-xs text-ink-2">Les 100 derniers signalements fermés ; les plus anciens restent en base.</p>
            )}
          </TabPanel>
        </div>
      )}

      {decision && (
        <Dialog
          key={`${decision.status}-${decision.report.id}`}
          titleId="reports-dialog-title"
          onClose={close}
          title={resolving ? "Marquer le signalement traité ?" : "Rejeter le signalement ?"}
        >
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-ink-2">
              {resolving
                ? "Corrigez d'abord la donnée dans l'onglet de gestion : marquer le signalement traité ne modifie rien sur la fiche."
                : "Le signalement est fermé sans modification de la fiche."}{" "}
              Un signalement fermé ne se rouvre pas.
            </p>
            <Field
              id="reports-response"
              label="Réponse à l'auteur (facultative)"
              hint={"Elle s'affiche sur « Mon compte » de l'auteur ; 1 000 caractères au plus."}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={4}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  maxLength={RESPONSE_MAX_LENGTH}
                  disabled={busy}
                  data-autofocus
                />
              )}
            </Field>
            <DialogFooter>
              <Button onClick={close} disabled={busy}>
                Annuler
              </Button>
              <Button type="submit" variant={resolving ? "primary" : "danger"} disabled={busy}>
                {busy ? "En cours…" : resolving ? "Marquer traité" : "Rejeter le signalement"}
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}
    </AdminPage>
  );
}
