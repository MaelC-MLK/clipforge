"use client";

import { useActionState } from "react";
import { changeKey, saveAccount, type FormState } from "../../actions";

function Message({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="text-sm text-red-400">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-sm text-emerald-400">{state.ok}</p>;
  return null;
}

export function AccountForm({ email, budget }: { email: string; budget: number }) {
  const [state, action, pending] = useActionState(saveAccount, {});
  return (
    <form action={action} className="mt-4 max-w-md space-y-3">
      <div>
        <label className="label" htmlFor="budget">
          Budget Claude mensuel ($)
        </label>
        <input id="budget" name="budget" type="number" min="0" step="1" required defaultValue={budget} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="email">
          Email de récupération (optionnel)
        </label>
        <input id="email" name="email" type="email" defaultValue={email} placeholder="toi@exemple.fr" className="input" />
        <p className="mt-1 text-xs text-zinc-500">
          Enregistré pour retrouver ton compte si ta clé est révoquée. L&apos;envoi du lien de récupération n&apos;est
          pas encore actif.
        </p>
      </div>
      <Message state={state} />
      <button className="btn" disabled={pending}>
        Enregistrer
      </button>
    </form>
  );
}

export function KeyForm() {
  const [state, action, pending] = useActionState(changeKey, {});
  return (
    <form action={action} className="mt-4 max-w-md space-y-3">
      <div>
        <label className="label" htmlFor="oldKey">
          Clé actuelle
        </label>
        <input id="oldKey" name="oldKey" type="password" required autoComplete="off" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="newKey">
          Nouvelle clé
        </label>
        <input id="newKey" name="newKey" type="password" required autoComplete="off" className="input" />
      </div>
      <Message state={state} />
      <button className="btn" disabled={pending}>
        {pending ? "Vérification…" : "Changer de clé"}
      </button>
    </form>
  );
}
