"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { buttonClasses } from "./Button";
import { cx } from "./cx";

/**
 * components/ui/Dialog.tsx — le dialogue (charte, étape 4)
 *
 * Un `<dialog>` natif ouvert par `showModal()` (D8) : le navigateur garde le
 * focus dans le dialogue, rend le reste de la page inerte et rend le focus à
 * l'élément d'origine à la fermeture. Remplace aussi `confirm()`.
 *
 * Monté = ouvert : l'appelant l'affiche sous condition (`{dialog && …}`) et
 * décide seul de le fermer. Échap et le bouton « Fermer » appellent
 * `onClose`, qui peut refuser (une opération en cours, par exemple) : le
 * dialogue se rouvre alors au rendu suivant. Le champ à remplir d'abord
 * porte `data-autofocus`. Un événement `close` du navigateur arrivé quand le
 * dialogue est de nouveau ouvert (effets rejoués par React en développement)
 * est ignoré.
 *
 * Étape 9, lot 4 (D76) : `placement="side"` en fait un panneau collé au bord
 * droit, sur toute la hauteur (le détail d'un ticket de l'inbox) ;
 * `closeOnBackdrop` le ferme aussi, par `onClose`, sur un clic à côté, sur le
 * fond voilé. Sans ces deux options, le dialogue de l'étape 4.
 */

type Rect = { left: number; right: number; top: number; bottom: number };

/** Vrai si le point est hors du cadre du dialogue : sur le fond voilé. */
export function isBackdropPoint(rect: Rect, x: number, y: number): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

const PLACEMENTS = {
  center: "m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] rounded-card border",
  side: "my-0 mr-0 ml-auto h-dvh max-h-dvh w-[min(37.5rem,95vw)] max-w-[95vw] border-l",
} as const;

interface DialogProps {
  title: ReactNode;
  /** Identifiant du titre, relié par `aria-labelledby`. */
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** `side` : un panneau collé au bord droit, sur toute la hauteur. */
  placement?: keyof typeof PLACEMENTS;
  /** Un clic à côté, sur le fond voilé, ferme aussi le dialogue (par `onClose`). */
  closeOnBackdrop?: boolean;
}

export function Dialog({
  title,
  titleId,
  onClose,
  children,
  className,
  placement = "center",
  closeOnBackdrop = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // À chaque rendu : rouvrir un dialogue que le navigateur aurait fermé.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  });

  // Au démontage, avant que le nœud ne quitte la page : fermer, pour que le
  // navigateur rende le focus.
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // L'événement `close` arrive après coup (une tâche) : il ne compte que si
      // le dialogue est encore fermé. En développement, React rejoue les effets
      // (StrictMode) : le `close()` du démontage simulé fermait sinon le
      // dialogue aussitôt rouvert (relevé à l'étape 6, sous `next dev`).
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      // Le fond voilé n'est pas un élément : un clic dessus vise le <dialog>
      // lui-même, hors de son cadre. Un clic au clavier sur un bouton vise le
      // bouton, jamais le <dialog>.
      onClick={(event) => {
        if (
          closeOnBackdrop &&
          event.target === event.currentTarget &&
          isBackdropPoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)
        ) {
          onClose();
        }
      }}
      className={cx(
        PLACEMENTS[placement],
        "overflow-y-auto border-line bg-surface p-0 text-ink shadow-xl",
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-lg leading-snug font-semibold text-ink">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className={buttonClasses({ variant: "ghost", size: "icon" })}>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Le pied d'un dialogue : ses boutons, alignés à droite. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 pt-2">{children}</div>;
}
