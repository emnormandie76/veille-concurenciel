"use client";

import { useEffect, useState } from "react";
import YearSelector from "../components/YearSelector";
import ProgramSelector from "../components/ProgramSelector";

interface ProgramOption {
  id: string;
  name: string;
}

interface PricingRecord {
  id: string;
  programId: string;
  academic_year: number;
  currency: string;
  year_1_fee: number | null;
  year_2_fee: number | null;
  year_3_fee: number | null;
  year_4_fee: number | null;
  year_5_fee: number | null;
  total_fee: number | null;
  intl_year_1_fee: number | null;
  intl_total_fee: number | null;
  intl_currency: string | null;
  additional_fees_notes: string | null;
  source_url: string | null;
  program: {
    id: string;
    name: string;
  };
}

export default function PricingTab({ schoolId }: { schoolId: string }) {
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [pricingRecords, setPricingRecords] = useState<PricingRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state when a specific program is selected
  const [currentPricingId, setCurrentPricingId] = useState<string | null>(null);
  const [currency, setCurrency] = useState("EUR");
  const [year1Fee, setYear1Fee] = useState("");
  const [year2Fee, setYear2Fee] = useState("");
  const [year3Fee, setYear3Fee] = useState("");
  const [year4Fee, setYear4Fee] = useState("");
  const [year5Fee, setYear5Fee] = useState("");
  const [totalFee, setTotalFee] = useState("");
  const [intlYear1Fee, setIntlYear1Fee] = useState("");
  const [intlTotalFee, setIntlTotalFee] = useState("");
  const [intlCurrency, setIntlCurrency] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  useEffect(() => {
    fetchProgramsAndPricing();
  }, [schoolId]);

  const fetchProgramsAndPricing = async (year?: number) => {
    setLoading(true);
    setError(null);
    try {
      const resProg = await fetch(`/api/admin/schools/${schoolId}/programs`);
      if (!resProg.ok) throw new Error("Erreur lors de la récupération des programmes");
      const progsJson = await resProg.json();
      setPrograms(progsJson);

      const yearQuery = year ? `?year=${year}` : "";
      const resPricing = await fetch(`/api/admin/schools/${schoolId}/pricing${yearQuery}`);
      if (!resPricing.ok) throw new Error("Erreur lors de la récupération des tarifs");
      const pricingJson = await resPricing.json();

      setAvailableYears(pricingJson.availableYears || []);
      const activeYear = year || (pricingJson.availableYears && pricingJson.availableYears.length > 0 ? pricingJson.availableYears[0] : new Date().getFullYear());
      setSelectedYear(activeYear);
      setPricingRecords(pricingJson.records || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPricingForYear = async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/pricing?year=${year}`);
      if (!res.ok) throw new Error("Erreur de chargement des tarifs");
      const json = await res.json();
      setPricingRecords(json.records || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProgramId && selectedYear) {
      const existing = pricingRecords.find((r) => r.programId === selectedProgramId && r.academic_year === selectedYear);
      applyPricingToForm(existing || null);
    }
  }, [selectedProgramId, selectedYear, pricingRecords]);

  const applyPricingToForm = (p: PricingRecord | null) => {
    if (p) {
      setCurrentPricingId(p.id);
      setCurrency(p.currency || "EUR");
      setYear1Fee(p.year_1_fee !== null ? String(p.year_1_fee) : "");
      setYear2Fee(p.year_2_fee !== null ? String(p.year_2_fee) : "");
      setYear3Fee(p.year_3_fee !== null ? String(p.year_3_fee) : "");
      setYear4Fee(p.year_4_fee !== null ? String(p.year_4_fee) : "");
      setYear5Fee(p.year_5_fee !== null ? String(p.year_5_fee) : "");
      setTotalFee(p.total_fee !== null ? String(p.total_fee) : "");
      setIntlYear1Fee(p.intl_year_1_fee !== null ? String(p.intl_year_1_fee) : "");
      setIntlTotalFee(p.intl_total_fee !== null ? String(p.intl_total_fee) : "");
      setIntlCurrency(p.intl_currency || "");
      setNotes(p.additional_fees_notes || "");
      setSourceUrl(p.source_url || "");
    } else {
      setCurrentPricingId(null);
      setCurrency("EUR");
      setYear1Fee("");
      setYear2Fee("");
      setYear3Fee("");
      setYear4Fee("");
      setYear5Fee("");
      setTotalFee("");
      setIntlYear1Fee("");
      setIntlTotalFee("");
      setIntlCurrency("");
      setNotes("");
      setSourceUrl("");
    }
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    fetchPricingForYear(year);
  };

  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProgramId || !selectedYear) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    const body = {
      academic_year: selectedYear,
      currency,
      year_1_fee: year1Fee,
      year_2_fee: year2Fee,
      year_3_fee: year3Fee,
      year_4_fee: year4Fee,
      year_5_fee: year5Fee,
      total_fee: totalFee,
      intl_year_1_fee: intlYear1Fee,
      intl_total_fee: intlTotalFee,
      intl_currency: intlCurrency,
      additional_fees_notes: notes,
      source_url: sourceUrl,
    };

    try {
      const res = await fetch(`/api/admin/programs/${selectedProgramId}/pricing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur de sauvegarde");

      setSuccess(`Tarifs enregistrés pour l'année ${selectedYear}.`);
      fetchPricingForYear(selectedYear);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePricing = async () => {
    if (!currentPricingId) return;
    if (!confirm("Supprimer ce tarif ?")) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pricing/${currentPricingId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erreur de suppression");

      setSuccess("Tarif supprimé.");
      applyPricingToForm(null);
      if (selectedYear) fetchPricingForYear(selectedYear);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedProgObj = programs.find((p) => p.id === selectedProgramId);

  return (
    <div>
      {error && <div className="alert alert-danger" style={{ marginBottom: "20px" }}>{error}</div>}
      {success && <div className="alert alert-success" style={{ marginBottom: "20px" }}>{success}</div>}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <YearSelector
          availableYears={availableYears}
          selectedYear={selectedYear}
          onYearChange={handleYearChange}
          loading={loading || saving}
        />
        <ProgramSelector
          programs={programs}
          selectedProgramId={selectedProgramId}
          onProgramChange={setSelectedProgramId}
          showAllOption={true}
          loading={loading || saving}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Chargement des tarifs...
        </div>
      ) : programs.length === 0 ? (
        <div className="inline-form" style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ color: "var(--text-secondary)" }}>
            Aucun programme enregistré. Veuillez d'abord créer des programmes dans l'onglet Campus & Programmes.
          </p>
        </div>
      ) : selectedProgramId === null ? (
        /* VUE D'ENSEMBLE TOUS LES PROGRAMMES */
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Programme</th>
                <th>Total Frais</th>
                <th>Année 1</th>
                <th>Année 2</th>
                <th>Année 3</th>
                <th>Année 4</th>
                <th>Année 5</th>
                <th>Intl Total</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((prog) => {
                const pRecord = pricingRecords.find((r) => r.programId === prog.id);
                return (
                  <tr key={prog.id}>
                    <td style={{ fontWeight: 600 }}>{prog.name}</td>
                    <td style={{ color: "var(--accent)", fontWeight: 600 }}>
                      {pRecord?.total_fee ? pRecord.total_fee.toLocaleString() + " " + (pRecord.currency || "€") : "—"}
                    </td>
                    <td>{pRecord?.year_1_fee ? pRecord.year_1_fee.toLocaleString() + " €" : "—"}</td>
                    <td>{pRecord?.year_2_fee ? pRecord.year_2_fee.toLocaleString() + " €" : "—"}</td>
                    <td>{pRecord?.year_3_fee ? pRecord.year_3_fee.toLocaleString() + " €" : "—"}</td>
                    <td>{pRecord?.year_4_fee ? pRecord.year_4_fee.toLocaleString() + " €" : "—"}</td>
                    <td>{pRecord?.year_5_fee ? pRecord.year_5_fee.toLocaleString() + " €" : "—"}</td>
                    <td>{pRecord?.intl_total_fee ? pRecord.intl_total_fee.toLocaleString() + " " + (pRecord.intl_currency || "€") : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSelectedProgramId(prog.id)}
                        style={{ padding: "4px 10px" }}
                      >
                        {pRecord ? "Éditer" : "➕ Renseigner"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* VUE DÉTAILLÉE PAR PROGRAMME */
        <form onSubmit={handleSavePricing} className="inline-form">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h3 className="tab-section-title" style={{ margin: 0 }}>
              Grille tarifaire — {selectedProgObj?.name} (Année {selectedYear})
            </h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedProgramId(null)}
            >
              ← Voir tous les programmes
            </button>
          </div>

          <div className="inline-form-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", marginBottom: "20px" }}>
            <div className="form-group">
              <label className="form-label">Frais Année 1 (€)</label>
              <input
                type="number"
                className="form-control"
                value={year1Fee}
                onChange={(e) => setYear1Fee(e.target.value)}
                placeholder="ex: 11500"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Frais Année 2 (€)</label>
              <input
                type="number"
                className="form-control"
                value={year2Fee}
                onChange={(e) => setYear2Fee(e.target.value)}
                placeholder="ex: 11500"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Frais Année 3 (€)</label>
              <input
                type="number"
                className="form-control"
                value={year3Fee}
                onChange={(e) => setYear3Fee(e.target.value)}
                placeholder="ex: 12000"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Frais Année 4 (€)</label>
              <input
                type="number"
                className="form-control"
                value={year4Fee}
                onChange={(e) => setYear4Fee(e.target.value)}
                placeholder="ex: 12500"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Frais Année 5 (€)</label>
              <input
                type="number"
                className="form-control"
                value={year5Fee}
                onChange={(e) => setYear5Fee(e.target.value)}
                placeholder="ex: 12500"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Frais Totaux (€) *</label>
              <input
                type="number"
                className="form-control"
                value={totalFee}
                onChange={(e) => setTotalFee(e.target.value)}
                placeholder="ex: 60000"
              />
            </div>
          </div>

          {/* Tarifs internationaux & Méta */}
          <div className="inline-form-grid" style={{ marginBottom: "20px" }}>
            <div className="form-group">
              <label className="form-label">Frais Année 1 (International)</label>
              <input
                type="number"
                className="form-control"
                value={intlYear1Fee}
                onChange={(e) => setIntlYear1Fee(e.target.value)}
                placeholder="ex: 14000"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Frais Totaux (International)</label>
              <input
                type="number"
                className="form-control"
                value={intlTotalFee}
                onChange={(e) => setIntlTotalFee(e.target.value)}
                placeholder="ex: 70000"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Devise internationale</label>
              <input
                type="text"
                className="form-control"
                value={intlCurrency}
                onChange={(e) => setIntlCurrency(e.target.value)}
                placeholder="ex: USD, EUR, GBP"
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: "16px" }}>
            <label className="form-label">Notes sur les frais additionnels</label>
            <textarea
              className="form-control"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ex: Frais de dossier 100€ non inclus, sécurité sociale..."
            />
          </div>

          <div className="form-group" style={{ marginBottom: "24px" }}>
            <label className="form-label">URL de la source des tarifs</label>
            <input
              type="text"
              className="form-control"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://ecole.fr/frais-de-scolarite"
            />
          </div>

          <div className="inline-form-actions" style={{ display: "flex", justifyContent: "space-between" }}>
            {currentPricingId ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleDeletePricing}
                disabled={saving}
              >
                🗑️ Supprimer ce tarif
              </button>
            ) : (
              <div />
            )}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer la grille tarifaire"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
