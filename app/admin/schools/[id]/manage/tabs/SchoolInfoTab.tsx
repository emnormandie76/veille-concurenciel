"use client";

import { useState } from "react";

interface SchoolInfoTabProps {
  schoolId: string;
  school: {
    name: string;
    official_domain: string;
    status: string;
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
    <div className="inline-form">
      <h3 className="tab-section-title" style={{ marginBottom: "20px" }}>
        Informations générales de l'école
      </h3>

      {error && <div className="alert alert-danger" style={{ marginBottom: "20px" }}>{error}</div>}
      {success && <div className="alert alert-success" style={{ marginBottom: "20px" }}>{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="inline-form-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="school-name">
              Nom de l'école *
            </label>
            <input
              id="school-name"
              type="text"
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="school-domain">
              Domaine officiel *
            </label>
            <input
              id="school-domain"
              type="text"
              className="form-control"
              value={officialDomain}
              onChange={(e) => setOfficialDomain(e.target.value)}
              required
              disabled={loading}
              placeholder="ex: emlv.fr"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="school-status">
              Statut
            </label>
            <select
              id="school-status"
              className="form-control"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={loading}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
              <option value="DRAFT">DRAFT</option>
            </select>
          </div>
        </div>

        <div className="inline-form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Enregistrement..." : "Enregistrer les modifications"}
          </button>
        </div>
      </form>
    </div>
  );
}
