"use client";

import { useEffect, useState } from "react";
import YearSelector from "../components/YearSelector";

interface StatsRecord {
  id?: string;
  academic_year: number;
  total_students: number | null;
  total_alumni: number | null;
  partner_companies: number | null;
  annual_internship_offers: number | null;
  abroad_campuses: number | null;
  partner_universities: number | null;
  permanent_professors: number | null;
  international_professors_pct: number | null;
  external_speakers_pct: number | null;
}

export default function StatsTab({ schoolId }: { schoolId: string }) {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [record, setRecord] = useState<StatsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states
  const [totalStudents, setTotalStudents] = useState<string>("");
  const [totalAlumni, setTotalAlumni] = useState<string>("");
  const [partnerCompanies, setPartnerCompanies] = useState<string>("");
  const [internshipOffers, setInternshipOffers] = useState<string>("");
  const [abroadCampuses, setAbroadCampuses] = useState<string>("");
  const [partnerUniversities, setPartnerUniversities] = useState<string>("");
  const [permanentProfessors, setPermanentProfessors] = useState<string>("");
  const [intlProfessorsPct, setIntlProfessorsPct] = useState<string>("");
  const [externalSpeakersPct, setExternalSpeakersPct] = useState<string>("");

  useEffect(() => {
    fetchStats();
  }, [schoolId]);

  const fetchStats = async (year?: number) => {
    setLoading(true);
    setError(null);
    try {
      const url = year
        ? `/api/admin/schools/${schoolId}/stats?year=${year}`
        : `/api/admin/schools/${schoolId}/stats`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Erreur de chargement des statistiques");
      const data = await res.json();

      setAvailableYears(data.availableYears || []);
      const currentYear = year || (data.availableYears && data.availableYears.length > 0 ? data.availableYears[0] : new Date().getFullYear());
      setSelectedYear(currentYear);
      applyRecordToForm(data.record);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const applyRecordToForm = (rec: StatsRecord | null) => {
    setRecord(rec);
    if (rec) {
      setTotalStudents(rec.total_students !== null ? String(rec.total_students) : "");
      setTotalAlumni(rec.total_alumni !== null ? String(rec.total_alumni) : "");
      setPartnerCompanies(rec.partner_companies !== null ? String(rec.partner_companies) : "");
      setInternshipOffers(rec.annual_internship_offers !== null ? String(rec.annual_internship_offers) : "");
      setAbroadCampuses(rec.abroad_campuses !== null ? String(rec.abroad_campuses) : "");
      setPartnerUniversities(rec.partner_universities !== null ? String(rec.partner_universities) : "");
      setPermanentProfessors(rec.permanent_professors !== null ? String(rec.permanent_professors) : "");
      setIntlProfessorsPct(rec.international_professors_pct !== null ? String(rec.international_professors_pct) : "");
      setExternalSpeakersPct(rec.external_speakers_pct !== null ? String(rec.external_speakers_pct) : "");
    } else {
      setTotalStudents("");
      setTotalAlumni("");
      setPartnerCompanies("");
      setInternshipOffers("");
      setAbroadCampuses("");
      setPartnerUniversities("");
      setPermanentProfessors("");
      setIntlProfessorsPct("");
      setExternalSpeakersPct("");
    }
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    fetchStats(year);
  };

  const handleCopyYear = async (fromYear: number, toYear: number) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const resSource = await fetch(`/api/admin/schools/${schoolId}/stats?year=${fromYear}`);
      if (!resSource.ok) throw new Error("Impossible de lire les données de l'année source");
      const dataSource = await resSource.json();
      if (!dataSource.record) throw new Error("Aucune donnée pour l'année source choisie");

      const sourceRec = dataSource.record;

      const body = {
        academic_year: toYear,
        total_students: sourceRec.total_students,
        total_alumni: sourceRec.total_alumni,
        partner_companies: sourceRec.partner_companies,
        annual_internship_offers: sourceRec.annual_internship_offers,
        abroad_campuses: sourceRec.abroad_campuses,
        partner_universities: sourceRec.partner_universities,
        permanent_professors: sourceRec.permanent_professors,
        international_professors_pct: sourceRec.international_professors_pct,
        external_speakers_pct: sourceRec.external_speakers_pct,
      };

      const resSave = await fetch(`/api/admin/schools/${schoolId}/stats`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resSave.ok) throw new Error("Erreur lors de la copie des données");

      setSuccess(`Statistiques copiées depuis l'année ${fromYear} vers ${toYear}.`);
      fetchStats(toYear);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedYear) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    const body = {
      academic_year: selectedYear,
      total_students: totalStudents,
      total_alumni: totalAlumni,
      partner_companies: partnerCompanies,
      annual_internship_offers: internshipOffers,
      abroad_campuses: abroadCampuses,
      partner_universities: partnerUniversities,
      permanent_professors: permanentProfessors,
      international_professors_pct: intlProfessorsPct,
      external_speakers_pct: externalSpeakersPct,
    };

    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/stats`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la sauvegarde");

      setSuccess(`Statistiques de l'année ${selectedYear} enregistrées.`);
      fetchStats(selectedYear);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteYear = async () => {
    if (!record || !record.id) return;
    if (!confirm(`Supprimer les statistiques pour l'année ${selectedYear} ?`)) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/stats/${record.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erreur lors de la suppression");

      setSuccess(`Statistiques de l'année ${selectedYear} supprimées.`);
      fetchStats();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <YearSelector
        availableYears={availableYears}
        selectedYear={selectedYear}
        onYearChange={handleYearChange}
        onCopyYear={handleCopyYear}
        loading={loading || saving}
      />

      {error && <div className="alert alert-danger" style={{ marginBottom: "20px" }}>{error}</div>}
      {success && <div className="alert alert-success" style={{ marginBottom: "20px" }}>{success}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Chargement des statistiques...
        </div>
      ) : selectedYear ? (
        <form onSubmit={handleSubmit} className="inline-form">
          <h3 className="tab-section-title" style={{ marginBottom: "20px" }}>
            Statistiques globales — Année {selectedYear}
          </h3>

          <div className="inline-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="total_students">
                Nombre total d'étudiants
              </label>
              <input
                id="total_students"
                type="number"
                className="form-control"
                value={totalStudents}
                onChange={(e) => setTotalStudents(e.target.value)}
                placeholder="ex: 8500"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="total_alumni">
                Nombre total de diplômés (Alumni)
              </label>
              <input
                id="total_alumni"
                type="number"
                className="form-control"
                value={totalAlumni}
                onChange={(e) => setTotalAlumni(e.target.value)}
                placeholder="ex: 45000"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="partner_companies">
                Entreprises partenaires
              </label>
              <input
                id="partner_companies"
                type="number"
                className="form-control"
                value={partnerCompanies}
                onChange={(e) => setPartnerCompanies(e.target.value)}
                placeholder="ex: 500"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="annual_internship_offers">
                Offres de stage annuelles
              </label>
              <input
                id="annual_internship_offers"
                type="number"
                className="form-control"
                value={internshipOffers}
                onChange={(e) => setInternshipOffers(e.target.value)}
                placeholder="ex: 12000"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="abroad_campuses">
                Campus à l'étranger
              </label>
              <input
                id="abroad_campuses"
                type="number"
                className="form-control"
                value={abroadCampuses}
                onChange={(e) => setAbroadCampuses(e.target.value)}
                placeholder="ex: 3"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="partner_universities">
                Universités partenaires
              </label>
              <input
                id="partner_universities"
                type="number"
                className="form-control"
                value={partnerUniversities}
                onChange={(e) => setPartnerUniversities(e.target.value)}
                placeholder="ex: 150"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="permanent_professors">
                Professeurs permanents
              </label>
              <input
                id="permanent_professors"
                type="number"
                className="form-control"
                value={permanentProfessors}
                onChange={(e) => setPermanentProfessors(e.target.value)}
                placeholder="ex: 120"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="international_professors_pct">
                % Professeurs internationaux
              </label>
              <input
                id="international_professors_pct"
                type="number"
                step="0.1"
                min="0"
                max="100"
                className="form-control"
                value={intlProfessorsPct}
                onChange={(e) => setIntlProfessorsPct(e.target.value)}
                placeholder="ex: 45.5"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="external_speakers_pct">
                % Intervenants professionnels externes
              </label>
              <input
                id="external_speakers_pct"
                type="number"
                step="0.1"
                min="0"
                max="100"
                className="form-control"
                value={externalSpeakersPct}
                onChange={(e) => setExternalSpeakersPct(e.target.value)}
                placeholder="ex: 60"
              />
            </div>
          </div>

          <div
            className="inline-form-actions"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            {record && record.id ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleDeleteYear}
                disabled={saving}
              >
                🗑️ Supprimer cette année
              </button>
            ) : (
              <div />
            )}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer les statistiques"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
