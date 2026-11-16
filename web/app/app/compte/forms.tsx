"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { MIN_PASSWORD } from "@/lib/upload";
import { changePassword, removeKey, saveAccount, saveKey, type FormState } from "../../actions";

function Message({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="text-sm text-red-400">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-sm text-emerald-400">{state.ok}</p>;
  return null;
}

export function KeyForm({ hasKey }: { hasKey: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveKey, {});
  return (
    <form action={action} className="mt-4 max-w-md space-y-3">
      <div>
        <label className="label" htmlFor="key">
          {hasKey ? "Remplacer par une nouvelle clé" : "Ta clé API Claude"}
        </label>
        <input id="key" name="key" type="password" required autoComplete="off" placeholder="sk-ant-…" className="input" />
      </div>
      <Message state={state} />
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={pending}>
          {pending ? "Vérification auprès d'Anthropic…" : hasKey ? "Remplacer la clé" : "Enregistrer la clé"}
        </button>
        {hasKey && (
          <button
            type="button"
            className="btn-ghost"
            onClick={async () => {
              if (!confirm("Retirer la clé de Hooklip ? L'analyse par Claude et les textes de publication seront désactivés.")) return;
              await removeKey();
              router.refresh();
            }}
          >
            Retirer la clé
          </button>
        )}
      </div>
    </form>
  );
}

export function AccountForm({ budget, purgeDays }: { budget: number; purgeDays: number | null }) {
  const [state, action, pending] = useActionState(saveAccount, {});
  return (
    <form action={action} className="mt-4 max-w-md space-y-3">
      <div>
        <label className="label" htmlFor="budget">
          Budget Claude mensuel ($)
        </label>
        <input id="budget" name="budget" type="number" min="0" max="10000" step="any" required defaultValue={budget} className="input" />
        <p className="mt-1 text-xs text-zinc-500">Au-delà, Hooklip refuse de lancer de nouveaux appels à Claude jusqu&apos;au mois suivant.</p>
      </div>
      <div>
        <label className="label" htmlFor="purge">
          Supprimer les fichiers des sources après (jours)
        </label>
        <input id="purge" name="purge" type="number" min="1" max="3650" step="1" defaultValue={purgeDays ?? ""} placeholder="Jamais" className="input" />
        <p className="mt-1 text-xs text-zinc-500">
          Libère le stockage : la vidéo d&apos;origine est supprimée, les clips déjà rendus restent téléchargeables et publiables. Un clip d&apos;une
          source supprimée ne peut plus être refait. Vide : rien n&apos;est supprimé automatiquement.
        </p>
      </div>
      <Message state={state} />
      <button className="btn" disabled={pending}>
        Enregistrer
      </button>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {});
  return (
    <form action={action} className="mt-4 max-w-md space-y-3">
      <div>
        <label className="label" htmlFor="current">
          Mot de passe actuel
        </label>
        <input id="current" name="current" type="password" required autoComplete="current-password" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="next">
          Nouveau mot de passe ({MIN_PASSWORD} caractères au moins)
        </label>
        <input id="next" name="next" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className="input" />
      </div>
      <Message state={state} />
      <button className="btn" disabled={pending}>
        Changer le mot de passe
      </button>
    </form>
  );
}
