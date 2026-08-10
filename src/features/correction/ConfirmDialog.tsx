"use client";

import { useEffect, useRef } from "react";

type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Minimal accessible confirmation dialog. Focus moves to Cancel on open,
 * Escape cancels, Tab cycles between the two actions and the backdrop click
 * also cancels. Used only for destructive confirmation-worthy actions
 * (delete note, reset whole lesson).
 */
export function ConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Tab") {
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="correction-dialog-backdrop" onClick={onCancel}>
      <div
        className="correction-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="correction-dialog-title"
        aria-describedby="correction-dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="correction-dialog-title">{title}</h3>
        <p id="correction-dialog-message">{message}</p>
        <div className="correction-dialog-actions">
          <button ref={cancelRef} type="button" className="correction-btn" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className="correction-btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
