"use client";

import { useId, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { USAGE_TEXT_TONES, usageTone } from "./cron-tones";

export interface TavilyKeyItem {
  id: string;
  used: number;
  total: number;
}

export interface QuotaTavilyPanelProps {
  keys: TavilyKeyItem[];
}

/**
 * Les quotas des clés Tavily, repliés derrière leur total. Dans la charte
 * depuis l'étape 9, lot 5 (le style seulement, règle 10) : l'en-tête est un
 * bouton natif qui commande le corps (D88 : il était une `div` hors du
 * clavier), caché par `hidden`, sans animation ; l'usage de chaque clé en
 * barre native (D86), au ton de son usage (D87).
 */
export default function QuotaTavilyPanel({ keys }: QuotaTavilyPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const bodyId = useId();

  // 1. Calculs globaux
  const activeKeysCount = keys.length;
  const exhaustedKeysCount = keys.filter((k) => k.used >= k.total).length;
  const totalUsed = keys.reduce((acc, k) => acc + k.used, 0);
  const totalPossible = keys.reduce((acc, k) => acc + k.total, 0);
  const totalRestant = Math.max(0, totalPossible - totalUsed);

  // 2. Tri des clés : clés épuisées en premier, puis par usage décroissant
  const sortedKeys = [...keys].sort((a, b) => {
    const aExhausted = a.used >= a.total;
    const bExhausted = b.used >= b.total;
    if (aExhausted && !bExhausted) return -1;
    if (!aExhausted && bExhausted) return 1;

    const aUsage = a.total > 0 ? a.used / a.total : 0;
    const bUsage = b.total > 0 ? b.used / b.total : 0;
    return bUsage - aUsage;
  });

  return (
    <div className="overflow-hidden rounded-control border border-line bg-surface">
      {/* En-tête */}
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-surface-2 px-4 py-3 text-left transition-colors hover:bg-line/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">
            Quotas Tavily — {activeKeysCount} clé{activeKeysCount > 1 ? "s" : ""} active{activeKeysCount > 1 ? "s" : ""}
          </span>
          {exhaustedKeysCount > 0 && (
            <Badge tone="danger">
              {exhaustedKeysCount} épuisée{exhaustedKeysCount > 1 ? "s" : ""}
            </Badge>
          )}
        </span>
        <span className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-ink-2">
            <strong className="font-semibold text-ink">{totalRestant}</strong> / {totalPossible} restants
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cx("size-4 text-ink-2", isOpen && "rotate-180")}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </span>
      </button>

      {/* Corps déroulable : `hidden` seul, sans utilitaire d'affichage qui le déferait. */}
      <div id={bodyId} hidden={!isOpen} className="max-h-[21.875rem] overflow-y-auto border-t border-line">
        <ul className="flex flex-col px-4 py-2">
          {sortedKeys.map((key) => {
            const remaining = Math.max(0, key.total - key.used);
            const tone = usageTone(key.used, key.total);

            return (
              <li key={key.id} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
                <span className="min-w-20 font-mono text-xs text-ink">{key.id}</span>
                <span className="flex flex-1 items-center">
                  <ProgressBar value={key.used} max={key.total} tone={tone} aria-label={key.id} />
                </span>
                <span className={cx("min-w-30 text-right font-mono text-xs tabular-nums", USAGE_TEXT_TONES[tone])}>
                  {remaining} / {key.total} restants
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
