"use client";

/**
 * app/admin/schools/[id]/manage/legacy/ProgramSelector.tsx — copie à l'ancien style, pour l'intervalle entre les lots 2 et 3
 *
 * Plan gestion-contenu, étape 9, décisions D60 et D61 : le composant passe à la
 * charte à son chemin, au lot 2 ; cette copie, inchangée, sert les quatre
 * onglets encore à l'ancien style (Campus & Programmes, Tarifs, Classements,
 * Capacités), posés hors du sous-arbre .charte. Le lot 3 la supprime.
 */

interface ProgramOption {
  id: string;
  name: string;
}

interface ProgramSelectorProps {
  programs: ProgramOption[];
  selectedProgramId: string | null;
  onProgramChange: (programId: string | null) => void;
  showAllOption?: boolean;
  loading?: boolean;
}

export default function ProgramSelector({
  programs,
  selectedProgramId,
  onProgramChange,
  showAllOption = true,
  loading = false,
}: ProgramSelectorProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <label htmlFor="program-select" style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
        Programme :
      </label>
      <select
        id="program-select"
        className="form-control"
        style={{ maxWidth: "300px" }}
        value={selectedProgramId ?? ""}
        onChange={(e) => onProgramChange(e.target.value === "" ? null : e.target.value)}
        disabled={loading || programs.length === 0}
      >
        {showAllOption && <option value="">Tous les programmes</option>}
        {programs.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
