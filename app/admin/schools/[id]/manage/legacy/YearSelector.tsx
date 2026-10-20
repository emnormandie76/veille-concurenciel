"use client";

/**
 * app/admin/schools/[id]/manage/legacy/YearSelector.tsx — copie à l'ancien style, pour l'intervalle entre les lots 2 et 3
 *
 * Plan gestion-contenu, étape 9, décisions D60 et D61 : le composant passe à la
 * charte à son chemin, au lot 2 ; cette copie, inchangée, sert les quatre
 * onglets encore à l'ancien style (Campus & Programmes, Tarifs, Classements,
 * Capacités), posés hors du sous-arbre .charte. Le lot 3 la supprime.
 */

import { useState } from "react";

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

  return (
    <div className="year-selector" style={{ flexWrap: "wrap", gap: "12px" }}>
      <label htmlFor="year-select">Année académique :</label>

      {availableYears.length > 0 && !isAddingYear && (
        <select
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
        </select>
      )}

      {isAddingYear ? (
        <form onSubmit={handleAddSubmit} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="number"
            className="form-control"
            style={{ width: "100px", padding: "6px 10px" }}
            value={newYear}
            onChange={(e) => setNewYear(Number(e.target.value))}
            min={2000}
            max={new Date().getFullYear() + 2}
            disabled={loading}
            autoFocus
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
            Ajouter
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setIsAddingYear(false);
              setError(null);
            }}
            disabled={loading}
          >
            Annuler
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setIsAddingYear(true)}
          disabled={loading}
        >
          ➕ Nouvelle année
        </button>
      )}

      {onCopyYear && availableYears.length > 0 && selectedYear && !isAddingYear && (
        <>
          {isCopying ? (
            <form onSubmit={handleCopySubmit} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Copier depuis :</span>
              <select
                value={copySourceYear ?? ""}
                onChange={(e) => setCopySourceYear(Number(e.target.value))}
                disabled={loading}
                className="form-control"
                style={{ width: "120px", padding: "4px 8px" }}
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
              </select>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={loading || !copySourceYear}
              >
                Copier
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setIsCopying(false)}
                disabled={loading}
              >
                Annuler
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const otherYears = availableYears.filter((y) => y !== selectedYear);
                setCopySourceYear(otherYears.length > 0 ? otherYears[0] : null);
                setIsCopying(true);
              }}
              disabled={loading || availableYears.length <= 1}
            >
              📋 Copier depuis une autre année...
            </button>
          )}
        </>
      )}

      {error && (
        <div style={{ color: "#ef4444", fontSize: "0.85rem", width: "100%", marginTop: "4px" }}>
          {error}
        </div>
      )}
    </div>
  );
}
