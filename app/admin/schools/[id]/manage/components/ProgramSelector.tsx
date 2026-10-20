"use client";

import { Label, Select } from "@/components/ui/Field";

/**
 * Le choix du programme d'un onglet de gestion (Admissions ; Tarifs et
 * Classements au lot 3). Dans la charte depuis l'étape 9 (lot 2) : le libellé
 * à gauche de la liste, comme avant ; jusqu'au lot 3, les onglets encore à
 * l'ancien style prennent la copie de `../legacy/` (D61).
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
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <Label htmlFor="program-select">Programme :</Label>
      <div className="w-80 max-w-full">
        <Select
          id="program-select"
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
        </Select>
      </div>
    </div>
  );
}
