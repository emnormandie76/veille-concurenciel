"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { nextTabIndex, panelId, tabId } from "./tabs-keys";

/**
 * components/ui/Tabs.tsx — les onglets (charte, étape 4)
 *
 * Contrôlés par l'appelant (`value`, `onValueChange`). Chaque onglet commande
 * son panneau (`TabPanel`, mêmes `idPrefix` et `value`) ; le clavier suit le
 * modèle ARIA (tabs-keys.ts) : l'onglet choisi suit la flèche, et le focus
 * avec lui.
 */

export interface TabItem {
  value: string;
  label: ReactNode;
  /** Un nombre affiché à côté du libellé (programmes, accréditations…). */
  count?: number;
}

interface TabsProps {
  /** Le nom de la liste d'onglets, pour les lecteurs d'écran. */
  label: string;
  idPrefix: string;
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function Tabs({ label, idPrefix, items, value, onValueChange, className }: TabsProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(index, event.key, items.length);
    if (next === null) return;
    event.preventDefault();
    onValueChange(items[next].value);
    buttons.current[next]?.focus();
  };

  // Le filet du bas est une ombre intérieure, sous le soulignement de l'onglet
  // choisi : un `border-b` couvert par des onglets en `-mb-px` débordait d'un
  // pixel, et `overflow-x-auto` (qui passe l'autre axe en `auto`) montrait
  // alors une barre de défilement verticale (relevé à l'étape 6).
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx("flex gap-x-6 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)]", className)}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.value)}
            aria-controls={panelId(idPrefix, item.value)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              "inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-medium",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
              selected ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cx(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-medium",
                  selected ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface TabPanelProps {
  idPrefix: string;
  value: string;
  selected: boolean;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ idPrefix, value, selected, children, className }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={panelId(idPrefix, value)}
      aria-labelledby={tabId(idPrefix, value)}
      hidden={!selected}
      tabIndex={0}
      className={cx("pt-5", className)}
    >
      {children}
    </div>
  );
}
