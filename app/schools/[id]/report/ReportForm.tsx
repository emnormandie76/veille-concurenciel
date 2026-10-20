"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { TEXT_LINK } from "@/components/ui/text-link";
import {
  CATEGORY_LABELS,
  MESSAGE_MAX_LENGTH,
  MESSAGE_MIN_LENGTH,
  REPORT_CATEGORIES,
} from "@/lib/content-reports";
import { SOURCE_URL_MAX_LENGTH } from "@/lib/provenance";

interface ReportFormProps {
  schoolId: string;
  campuses: Array<{ id: string; name: string; city: string | null }>;
  programs: Array<{ id: string; name: string }>;
  /** « school », « campus:<id> » ou « program:<id> ». */
  initialTarget: string;
}

type Feedback = { kind: "success" | "error"; message: string } | null;

/** « campus:<id> » → l'identifiant du campus ; sinon `null`. */
function idOf(target: string, kind: "campus" | "program"): string | null {
  return target.startsWith(`${kind}:`) ? target.slice(kind.length + 1) : null;
}

/**
 * Le formulaire de signalement (plan gestion-contenu, étape 6). Le corps ne
 * porte que l'école, la cible, la catégorie, le message et le lien : l'auteur
 * est pris dans la session par la route, qui revérifie tout le reste.
 */
export default function ReportForm({ schoolId, campuses, programs, initialTarget }: ReportFormProps) {
  const [target, setTarget] = useState(initialTarget);
  const [category, setCategory] = useState("");
  const [message, setMessage] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId,
          campusId: idOf(target, "campus"),
          programId: idOf(target, "program"),
          category,
          message,
          source_url: sourceUrl,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
      if (!res.ok) {
        const error = typeof body?.error === "string" ? body.error : "Le signalement n'a pas pu être envoyé.";
        setFeedback({ kind: "error", message: error });
        return;
      }
      setFeedback({
        kind: "success",
        message: typeof body?.message === "string" ? body.message : "Merci : votre signalement est transmis aux gestionnaires.",
      });
      setCategory("");
      setMessage("");
      setSourceUrl("");
    } catch {
      setFeedback({ kind: "error", message: "Une erreur réseau est survenue. Veuillez réessayer." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      {feedback && (
        <Alert tone={feedback.kind === "success" ? "success" : "danger"}>
          {feedback.message}
          {feedback.kind === "success" && (
            <>
              {" "}
              <Link href="/account" className={TEXT_LINK}>
                Voir mes signalements
              </Link>
            </>
          )}
        </Alert>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id="report-target" label="Ce que vous signalez">
          {(control) => (
            <Select {...control} value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
              <option value="school">L&apos;école en général</option>
              {campuses.length > 0 && (
                <optgroup label="Un campus">
                  {campuses.map((campus) => (
                    <option key={campus.id} value={`campus:${campus.id}`}>
                      {campus.city ? `${campus.name} (${campus.city})` : campus.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {programs.length > 0 && (
                <optgroup label="Un programme">
                  {programs.map((program) => (
                    <option key={program.id} value={`program:${program.id}`}>
                      {program.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          )}
        </Field>

        <Field id="report-category" label="Catégorie" hint="Elle dit aux gestionnaires où corriger.">
          {(control) => (
            <Select {...control} value={category} onChange={(e) => setCategory(e.target.value)} required disabled={busy}>
              <option value="" disabled>
                Choisissez une catégorie
              </option>
              {REPORT_CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="report-message"
          label="Ce qui est à corriger"
          hint={`Ce qui est faux et, si vous la connaissez, la bonne valeur : de ${MESSAGE_MIN_LENGTH} à 2 000 caractères.`}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              minLength={MESSAGE_MIN_LENGTH}
              maxLength={MESSAGE_MAX_LENGTH}
              required
              disabled={busy}
            />
          )}
        </Field>

        <Field
          id="report-source"
          label="Lien vers une source (facultatif)"
          hint="Une adresse web (https://…) où vérifier l'information."
        >
          {(control) => (
            <Input
              {...control}
              type="url"
              inputMode="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              maxLength={SOURCE_URL_MAX_LENGTH}
              placeholder="https://"
              disabled={busy}
            />
          )}
        </Field>

        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Envoi…" : "Envoyer le signalement"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
