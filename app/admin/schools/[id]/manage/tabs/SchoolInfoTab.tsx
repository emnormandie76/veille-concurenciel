"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import LastEdit from "../../LastEdit";

interface SchoolInfoTabProps {
  schoolId: string;
  school: {
    name: string;
    official_domain: string;
    status: string;
    // « Modifié par … le … » (étape 5, D29).
    last_edit: string | null;
  };
  onSchoolUpdate: () => void;
}

export default function SchoolInfoTab({
  schoolId,
  school,
  onSchoolUpdate,
}: SchoolInfoTabProps) {
  const [name, setName] = useState(school.name);
  const [officialDomain, setOfficialDomain] = useState(school.official_domain);
  const [status, setStatus] = useState(school.status);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/admin/schools/${schoolId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          official_domain: officialDomain.trim(),
          status,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la mise à jour");
      }

      setSuccess("Informations de l'école enregistrées avec succès.");
      onSchoolUpdate();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card aria-labelledby="school-info-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <CardHeader title="Informations générales de l'école" titleId="school-info-title" />
        <LastEdit text={school.last_edit} />
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="school-name" label="Nom de l'école *">
            {(control) => (
              <Input
                {...control}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={loading}
              />
            )}
          </Field>

          <Field id="school-domain" label="Domaine officiel *">
            {(control) => (
              <Input
                {...control}
                type="text"
                className="font-mono"
                value={officialDomain}
                onChange={(e) => setOfficialDomain(e.target.value)}
                required
                disabled={loading}
                placeholder="ex: emlv.fr"
              />
            )}
          </Field>

          <Field id="school-status" label="Statut">
            {(control) => (
              <Select {...control} value={status} onChange={(e) => setStatus(e.target.value)} disabled={loading}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
                <option value="DRAFT">DRAFT</option>
              </Select>
            )}
          </Field>
        </div>

        <div className="flex justify-end border-t border-line pt-4">
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? "Enregistrement..." : "Enregistrer les modifications"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
