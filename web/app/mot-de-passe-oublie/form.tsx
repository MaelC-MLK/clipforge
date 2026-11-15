"use client";

import { useActionState } from "react";
import { MIN_PASSWORD } from "@/lib/upload";
import { requestReset, resetPassword } from "../actions";

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestReset, {});
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input" />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-sm text-emerald-400">
          {state.ok}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Un instant…" : "Recevoir le lien"}
      </button>
    </form>
  );
}

export function NewPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, {});
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="password">
          Nouveau mot de passe ({MIN_PASSWORD} caractères au moins)
        </label>
        <input id="password" name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Confirme le mot de passe
        </label>
        <input id="confirm" name="confirm" type="password" required autoComplete="new-password" className="input" />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Un instant…" : "Changer mon mot de passe"}
      </button>
    </form>
  );
}
