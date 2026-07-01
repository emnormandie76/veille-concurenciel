"use client";

import { useState } from "react";

export interface TavilyKeyItem {
  id: string;
  used: number;
  total: number;
}

export interface QuotaTavilyPanelProps {
  keys: TavilyKeyItem[];
}

export default function QuotaTavilyPanel({ keys }: QuotaTavilyPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

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
    <div className="tavily-accordion-container">
      {/* En-tête */}
      <div
        className={`accordion-header ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        aria-expanded={isOpen}
      >
        <div className="header-left">
          <span className="key-icon">🔑</span>
          <span className="header-title">
            Quotas Tavily — {activeKeysCount} clé{activeKeysCount > 1 ? "s" : ""} active{activeKeysCount > 1 ? "s" : ""}
          </span>
          {exhaustedKeysCount > 0 && (
            <span className="exhausted-badge">
              {exhaustedKeysCount} épuisée{exhaustedKeysCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="header-right">
          <span className="credits-summary">
            <strong>{totalRestant}</strong> / {totalPossible} restants
          </span>
          <span className={`chevron-icon ${isOpen ? "rotated" : ""}`}>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        </div>
      </div>

      {/* Corps déroulable */}
      <div className={`accordion-body ${isOpen ? "open" : ""}`}>
        <div className="accordion-content">
          {sortedKeys.map((key) => {
            const usagePct = key.total > 0 ? (key.used / key.total) * 100 : 0;
            const remaining = Math.max(0, key.total - key.used);
            const isExhausted = key.used >= key.total;

            let usageColor = "var(--success, #10b981)";
            let textColor = "text-green";
            if (isExhausted) {
              usageColor = "var(--danger, #ef4444)";
              textColor = "text-red";
            } else if (usagePct >= 75) {
              usageColor = "var(--warning, #f59e0b)";
              textColor = "text-orange";
            }

            return (
              <div key={key.id} className="key-row">
                <span className="key-id">{key.id}</span>
                <div className="progress-wrapper">
                  <div className="progress-bg">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${Math.min(100, usagePct)}%`,
                        backgroundColor: usageColor,
                      }}
                    ></div>
                  </div>
                </div>
                <span className={`key-credits ${textColor}`}>
                  {remaining} / {key.total} restants
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .tavily-accordion-container {
          border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
          border-radius: var(--radius-md, 8px);
          background-color: rgba(255, 255, 255, 0.01);
          overflow: hidden;
          margin-top: 12px;
        }

        .accordion-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          cursor: pointer;
          user-select: none;
          background-color: rgba(255, 255, 255, 0.02);
          transition: background-color 0.2s ease;
        }

        .accordion-header:hover {
          background-color: rgba(255, 255, 255, 0.05);
        }

        .accordion-header.active {
          border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .key-icon {
          font-size: 1.1rem;
        }

        .header-title {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--text-primary, #ffffff);
        }

        .exhausted-badge {
          background-color: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: var(--danger, #ef4444);
          font-size: 0.75rem;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 9999px;
          margin-left: 4px;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .credits-summary {
          font-size: 0.85rem;
          color: var(--text-secondary, #94a3b8);
        }

        .credits-summary strong {
          color: var(--text-primary, #ffffff);
        }

        .chevron-icon {
          display: flex;
          align-items: center;
          color: var(--text-secondary, #94a3b8);
          transition: transform 0.2s ease;
        }

        .chevron-icon.rotated {
          transform: rotate(180deg);
        }

        .accordion-body {
          max-height: 0;
          overflow: hidden;
          transition: max-height 200ms cubic-bezier(0.4, 0, 0.2, 1);
        }

        .accordion-body.open {
          max-height: 350px;
          overflow-y: auto;
        }

        .accordion-content {
          padding: 8px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .key-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 6px 0;
        }

        .key-row:not(:last-child) {
          border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        }

        .key-id {
          font-family: monospace;
          font-size: 0.8rem;
          color: var(--text-primary, #ffffff);
          min-width: 80px;
        }

        .progress-wrapper {
          flex-grow: 1;
          display: flex;
          align-items: center;
        }

        .progress-bg {
          width: 100%;
          height: 4px;
          background-color: rgba(255, 255, 255, 0.08);
          border-radius: 2px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .key-credits {
          font-size: 0.8rem;
          font-variant-numeric: tabular-nums;
          min-width: 120px;
          text-align: right;
        }

        .text-green {
          color: var(--success, #10b981);
        }

        .text-orange {
          color: var(--warning, #f59e0b);
        }

        .text-red {
          color: var(--danger, #ef4444);
        }
      `}</style>
    </div>
  );
}
