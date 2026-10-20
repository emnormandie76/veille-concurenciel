"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select } from "@/components/ui/Field";

/**
 * Le choix de l'année d'un onglet de gestion (Chiffres clés ; Tarifs,
 * Classements et Capacités au lot 3), avec l'ajout d'une année et la copie
 * depuis une autre. Dans la charte depuis l'étape 9 (lot 2) : une barre
 * d'outils ; chaque champ a son libellé visible (D65 : « Nouvelle année »,
 * « Copier depuis : »). Jusqu'au lot 3, les onglets encore à l'ancien style
 * prennent la copie de `../legacy/` (D61).
 */

interface YearSelectorProps {
  availableYears: number[];
  selectedYear: number | null;
  onYearChange: (year: number) => void;
  onCopyYear?: (fromYear: number, toYear: number) => void;
  loading?: boolean;
}

export default function YearSelector({
  availableYears,
  selectedYear,
  onYearChange,
  onCopyYear,
  loading = false,
}: YearSelectorProps) {
  const [isAddingYear, setIsAddingYear] = useState(false);
  const [newYear, setNewYear] = useState(new Date().getFullYear());
  const [isCopying, setIsCopying] = useState(false);
  const [copySourceYear, setCopySourceYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const currentYear = new Date().getFullYear();
    if (!newYear || newYear < 2000 || newYear > currentYear + 2) {
      setError(`L'année doit être comprise entre 2000 et ${currentYear + 2}`);
      return;
    }
    onYearChange(newYear);
    setIsAddingYear(false);
  };

  const handleCopySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (copySourceYear && selectedYear && onCopyYear) {
      onCopyYear(copySourceYear, selectedYear);
      setIsCopying(false);
    }
  };

  // Le texte « Année académique : » reste affiché sans la liste (aucune année,
  // ou l'ajout en cours), comme avant ; il n'est un libellé que de la liste.
  const showSelect = availableYears.length > 0 && !isAddingYear;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
      <div className="flex items-center gap-2.5">
        {showSelect ? (
          <Label htmlFor="year-select" className="whitespace-nowrap">
            Année académique :
          </Label>
        ) : (
          <span className="text-sm font-medium whitespace-nowrap text-ink">Année académique :</span>
        )}
        {showSelect && (
          <div className="w-36">
            <Select
              id="year-select"
              value={selectedYear ?? ""}
              onChange={(e) => onYearChange(Number(e.target.value))}
              disabled={loading}
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  Année {y}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {isAddingYear ? (
        <form onSubmit={handleAddSubmit} className="flex flex-wrap items-center gap-2">
          <Label htmlFor="year-new" className="whitespace-nowrap">
            Nouvelle année
          </Label>
          <div className="w-28">
            <Input
              id="year-new"
              type="number"
              className="font-mono tabular-nums"
              value={newYear}
              onChange={(e) => setNewYear(Number(e.target.value))}
              min={2000}
              max={new Date().getFullYear() + 2}
              disabled={loading}
              autoFocus
            />
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={loading}>
            Ajouter
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setIsAddingYear(false);
              setError(null);
            }}
            disabled={loading}
          >
            Annuler
          </Button>
        </form>
      ) : (
        <Button size="sm" onClick={() => setIsAddingYear(true)} disabled={loading}>
          Nouvelle année
        </Button>
      )}

      {onCopyYear && availableYears.length > 0 && selectedYear && !isAddingYear && (
        <>
          {isCopying ? (
            <form onSubmit={handleCopySubmit} className="flex flex-wrap items-center gap-2">
              <Label htmlFor="year-copy-source" className="whitespace-nowrap">
                Copier depuis :
              </Label>
              <div className="w-28">
                <Select
                  id="year-copy-source"
                  className="font-mono tabular-nums"
                  value={copySourceYear ?? ""}
                  onChange={(e) => setCopySourceYear(Number(e.target.value))}
                  disabled={loading}
                >
                  <option value="" disabled>
                    Choisir
                  </option>
                  {availableYears
                    .filter((y) => y !== selectedYear)
                    .map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                </Select>
              </div>
              <Button type="submit" variant="primary" size="sm" disabled={loading || !copySourceYear}>
                Copier
              </Button>
              <Button size="sm" onClick={() => setIsCopying(false)} disabled={loading}>
                Annuler
              </Button>
            </form>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                const otherYears = availableYears.filter((y) => y !== selectedYear);
                setCopySourceYear(otherYears.length > 0 ? otherYears[0] : null);
                setIsCopying(true);
              }}
              disabled={loading || availableYears.length <= 1}
            >
              Copier depuis une autre année...
            </Button>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="w-full text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
