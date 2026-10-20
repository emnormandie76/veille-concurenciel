/**
 * app/admin/schools/[id]/manage/legacy/TabFrame.tsx — l'îlot sombre des onglets du lot 3
 *
 * Plan gestion-contenu, étape 9, décision D60 : le cadre de la gestion d'une
 * école passe à la charte au lot 2, quatre onglets restent à l'ancien style
 * jusqu'au lot 3 (Campus & Programmes, Tarifs, Classements, Capacités). Leur
 * panneau se pose à côté du gabarit, hors du sous-arbre `.charte` (sa base,
 * rangée au-dessus de l'ancien CSS, leur ôterait fonds, bordures et titres),
 * dans ce cadre qui leur rend ce qu'ils avaient : le fond sombre du
 * back-office et la largeur de l'ancienne page (marges de 32 et 24 px).
 *
 * À l'ancien style, hors des @source de app/globals.css. Le lot 3 le supprime.
 */

import type { ReactNode } from "react";

export default function TabFrame({ children }: { children: ReactNode }) {
  return (
    <div style={{ backgroundColor: "var(--bg-primary)", borderRadius: "var(--radius-lg)", padding: "32px 24px" }}>
      {children}
    </div>
  );
}
