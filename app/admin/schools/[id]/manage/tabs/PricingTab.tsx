"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import YearSelector from "../components/YearSelector";
import ProgramSelector from "../components/ProgramSelector";
import LastEdit from "../../LastEdit";

/**
 * L'onglet « Tarifs » de la gestion d'une école. Dans la charte depuis
 * l'étape 9 (lot 3) : une vue à la fois, comme avant (D70) : le tableau des
 * programmes de l'année, ou la grille d'un programme dans une carte ; la
 * suppression d'un tarif se confirme dans le dialogue de la charte, plus par
 * `confirm()` (D63).
 */

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
  // « Modifié par … le … » (étape 5, D29).
  last_edit: string | null;
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
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  // D63 : le dialogue de la charte remplace `confirm()`. La suppression part
  // une fois le dialogue fermé, comme après la fenêtre du navigateur.
  const handleDeletePricing = async () => {
    if (!currentPricingId) return;
    setConfirmDelete(false);

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

  /** Un montant du tableau, ou « — » s'il manque. */
  const amount = (text: string | null) => text ?? <span className="text-ink-3">—</span>;

  /** Un champ de la grille : un montant, en chiffres alignés. */
  const feeField = (id: string, label: string, value: string, onChange: (value: string) => void, placeholder: string) => (
    <Field id={id} label={label}>
      {(control) => (
        <Input
          {...control}
          type="number"
          className="font-mono tabular-nums"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </Field>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
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

      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des tarifs...</p>
      ) : programs.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-sm text-ink-2">
            Aucun programme enregistré. Veuillez d&apos;abord créer des programmes dans l&apos;onglet Campus & Programmes.
          </p>
        </Card>
      ) : selectedProgramId === null ? (
        /* VUE D'ENSEMBLE TOUS LES PROGRAMMES */
        <Table caption="Tarifs">
          <THead>
            <Tr>
              <Th>Programme</Th>
              <Th align="right">Total Frais</Th>
              <Th align="right">Année 1</Th>
              <Th align="right">Année 2</Th>
              <Th align="right">Année 3</Th>
              <Th align="right">Année 4</Th>
              <Th align="right">Année 5</Th>
              <Th align="right">Intl Total</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {programs.map((prog) => {
              const pRecord = pricingRecords.find((r) => r.programId === prog.id);
              return (
                <Tr key={prog.id}>
                  <Td className="min-w-56">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-ink">{prog.name}</span>
                      <LastEdit text={pRecord?.last_edit} />
                    </div>
                  </Td>
                  <Td numeric className="font-medium whitespace-nowrap text-ink">
                    {amount(pRecord?.total_fee ? pRecord.total_fee.toLocaleString() + " " + (pRecord.currency || "€") : null)}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {amount(pRecord?.year_1_fee ? pRecord.year_1_fee.toLocaleString() + " €" : null)}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {amount(pRecord?.year_2_fee ? pRecord.year_2_fee.toLocaleString() + " €" : null)}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {amount(pRecord?.year_3_fee ? pRecord.year_3_fee.toLocaleString() + " €" : null)}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {amount(pRecord?.year_4_fee ? pRecord.year_4_fee.toLocaleString() + " €" : null)}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {amount(pRecord?.year_5_fee ? pRecord.year_5_fee.toLocaleString() + " €" : null)}
                  </Td>
                  <Td numeric className="whitespace-nowrap">
                    {amount(
                      pRecord?.intl_total_fee ? pRecord.intl_total_fee.toLocaleString() + " " + (pRecord.intl_currency || "€") : null,
                    )}
                  </Td>
                  <Td align="right">
                    <Button size="sm" onClick={() => setSelectedProgramId(prog.id)}>
                      {pRecord ? "Éditer" : "Renseigner"}
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      ) : (
        /* VUE DÉTAILLÉE PAR PROGRAMME */
        <Card aria-labelledby="pricing-grid-title" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardHeader
              title={`Grille tarifaire — ${selectedProgObj?.name ?? ""} (Année ${selectedYear})`}
              titleId="pricing-grid-title"
            />
            <Button variant="ghost" size="sm" onClick={() => setSelectedProgramId(null)}>
              ← Voir tous les programmes
            </Button>
          </div>

          <form onSubmit={handleSavePricing} className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {feeField("pricing-year-1-fee", "Frais Année 1 (€)", year1Fee, setYear1Fee, "ex: 11500")}
              {feeField("pricing-year-2-fee", "Frais Année 2 (€)", year2Fee, setYear2Fee, "ex: 11500")}
              {feeField("pricing-year-3-fee", "Frais Année 3 (€)", year3Fee, setYear3Fee, "ex: 12000")}
              {feeField("pricing-year-4-fee", "Frais Année 4 (€)", year4Fee, setYear4Fee, "ex: 12500")}
              {feeField("pricing-year-5-fee", "Frais Année 5 (€)", year5Fee, setYear5Fee, "ex: 12500")}
              {feeField("pricing-total-fee", "Frais Totaux (€) *", totalFee, setTotalFee, "ex: 60000")}
            </div>

            {/* Tarifs internationaux & Méta */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {feeField("pricing-intl-year-1-fee", "Frais Année 1 (International)", intlYear1Fee, setIntlYear1Fee, "ex: 14000")}
              {feeField("pricing-intl-total-fee", "Frais Totaux (International)", intlTotalFee, setIntlTotalFee, "ex: 70000")}
              <Field id="pricing-intl-currency" label="Devise internationale">
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    value={intlCurrency}
                    onChange={(e) => setIntlCurrency(e.target.value)}
                    placeholder="ex: USD, EUR, GBP"
                  />
                )}
              </Field>
            </div>

            <Field id="pricing-notes" label="Notes sur les frais additionnels">
              {(control) => (
                <Textarea
                  {...control}
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ex: Frais de dossier 100€ non inclus, sécurité sociale..."
                />
              )}
            </Field>

            <Field id="pricing-source-url" label="URL de la source des tarifs">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://ecole.fr/frais-de-scolarite"
                />
              )}
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              {currentPricingId ? (
                <Button variant="danger-soft" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  Supprimer ce tarif
                </Button>
              ) : (
                <div />
              )}
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Enregistrement..." : "Enregistrer la grille tarifaire"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {confirmDelete && (
        <Dialog titleId="pricing-delete-title" onClose={() => setConfirmDelete(false)} title="Supprimer ce tarif ?">
          <DialogFooter>
            <Button onClick={() => setConfirmDelete(false)} data-autofocus>
              Annuler
            </Button>
            <Button variant="danger" onClick={handleDeletePricing}>
              Supprimer ce tarif
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}
