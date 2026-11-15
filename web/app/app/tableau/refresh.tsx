"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { refreshStats } from "../../actions";

export function RefreshStats() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  return (
    <span className="flex items-center gap-3">
      {message && (
        <span role="status" className="text-xs text-zinc-400">
          {message}
        </span>
      )}
      <button
        className="btn-ghost"
        onClick={async () => {
          const result = await refreshStats();
          setMessage(result.error ?? result.ok ?? "");
          // Le relevé prend quelques secondes côté worker : on relit la page un peu après.
          setTimeout(() => router.refresh(), 6000);
        }}
      >
        Actualiser les statistiques
      </button>
    </span>
  );
}
