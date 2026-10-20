"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Input, type ControlProps } from "@/components/ui/Field";
import YearSelector from "../components/YearSelector";
import LastEdit from "../../LastEdit";

/**
 * L'onglet « Statistiques » (les chiffres clés) de la gestion d'une école,
 * année par année. Dans la charte depuis l'étape 9 (lot 2) ; la suppression
 * d'une année se confirme dans le dialogue de la charte (D63).
 */

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
  // Le lien source des chiffres de l'année (étape 5, D12).
  source_url?: string | null;
  // « Modifié par … le … » (étape 5, D29).
  last_edit?: string | null;
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
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      setSourceUrl(rec.source_url || "");
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
      setSourceUrl("");
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
        // Les chiffres copiés gardent la source d'où ils viennent.
        source_url: sourceRec.source_url,
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
      // Vide : pas de lien. Le serveur refuse ce qui n'est pas une adresse web (D27).
      source_url: sourceUrl.trim(),
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

  // D63 : le dialogue de la charte remplace `confirm()`. La suppression part
  // une fois le dialogue fermé, comme après la fenêtre du navigateur.
  const handleDeleteYear = async () => {
    if (!record || !record.id) return;
    setConfirmDelete(false);

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

  /** Un champ chiffré : un nombre entier, ou un pourcentage à toutes décimales (D30). */
  const numberInput = (control: ControlProps, value: string, onChange: (value: string) => void, placeholder: string) => (
    <Input
      {...control}
      type="number"
      className="font-mono tabular-nums"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <YearSelector
        availableYears={availableYears}
        selectedYear={selectedYear}
        onYearChange={handleYearChange}
        onCopyYear={handleCopyYear}
        loading={loading || saving}
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des statistiques...</p>
      ) : selectedYear ? (
        <Card aria-labelledby="stats-title" className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <CardHeader title={`Statistiques globales — Année ${selectedYear}`} titleId="stats-title" />
            <LastEdit text={record?.last_edit} />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field id="total_students" label="Nombre total d'étudiants">
                {(control) => numberInput(control, totalStudents, setTotalStudents, "ex: 8500")}
              </Field>

              <Field id="total_alumni" label="Nombre total de diplômés (Alumni)">
                {(control) => numberInput(control, totalAlumni, setTotalAlumni, "ex: 45000")}
              </Field>

              <Field id="partner_companies" label="Entreprises partenaires">
                {(control) => numberInput(control, partnerCompanies, setPartnerCompanies, "ex: 500")}
              </Field>

              <Field id="annual_internship_offers" label="Offres de stage annuelles">
                {(control) => numberInput(control, internshipOffers, setInternshipOffers, "ex: 12000")}
              </Field>

              <Field id="abroad_campuses" label="Campus à l'étranger">
                {(control) => numberInput(control, abroadCampuses, setAbroadCampuses, "ex: 3")}
              </Field>

              <Field id="partner_universities" label="Universités partenaires">
                {(control) => numberInput(control, partnerUniversities, setPartnerUniversities, "ex: 150")}
              </Field>

              <Field id="permanent_professors" label="Professeurs permanents">
                {(control) => numberInput(control, permanentProfessors, setPermanentProfessors, "ex: 120")}
              </Field>

              <Field id="international_professors_pct" label="% Professeurs internationaux">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    className="font-mono tabular-nums"
                    value={intlProfessorsPct}
                    onChange={(e) => setIntlProfessorsPct(e.target.value)}
                    placeholder="ex: 45.5"
                  />
                )}
              </Field>

              <Field id="external_speakers_pct" label="% Intervenants professionnels externes">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    step="any"
                    min="0"
                    max="100"
                    className="font-mono tabular-nums"
                    value={externalSpeakersPct}
                    onChange={(e) => setExternalSpeakersPct(e.target.value)}
                    placeholder="ex: 60"
                  />
                )}
              </Field>
            </div>

            <Field id="stats-source-url" label="URL de la source des chiffres clés">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://ecole.fr/chiffres-cles"
                />
              )}
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              {record && record.id ? (
                <Button variant="danger-soft" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  Supprimer cette année
                </Button>
              ) : (
                <div />
              )}
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Enregistrement..." : "Enregistrer les statistiques"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {confirmDelete && (
        <Dialog
          titleId="stats-delete-title"
          onClose={() => setConfirmDelete(false)}
          title={`Supprimer les statistiques pour l'année ${selectedYear} ?`}
        >
          <DialogFooter>
            <Button onClick={() => setConfirmDelete(false)} data-autofocus>
              Annuler
            </Button>
            <Button variant="danger" onClick={handleDeleteYear}>
              Supprimer cette année
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}
