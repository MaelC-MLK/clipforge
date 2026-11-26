"use client";

import { type ReactNode, useEffect, useState } from "react";

/** Bouton en deux clics, sans fenêtre : le premier clic demande « Confirmer ? » pendant 3 secondes. */
export function ConfirmButton({ children, confirm = "Confirmer ?", onConfirm, className = "btn-ghost" }: { children: ReactNode; confirm?: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className} ${armed ? "!border-red-500/60 !text-red-300" : ""}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirm : children}
    </button>
  );
}
