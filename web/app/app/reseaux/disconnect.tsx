"use client";

import { useRouter } from "next/navigation";
import { deleteAccount } from "../../actions";

export function Disconnect({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <button
      className="btn-ghost"
      onClick={async () => {
        if (!confirm(`Déconnecter ${name} ? Ses publications planifiées et son historique seront supprimés.`)) return;
        await deleteAccount(id);
        router.refresh();
      }}
    >
      Déconnecter
    </button>
  );
}
