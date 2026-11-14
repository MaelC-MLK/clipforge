"use client";

import { useActionState } from "react";
import { login } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="mt-6 space-y-3">
      <label className="label" htmlFor="key">
        Clé API Claude
      </label>
      <input id="key" name="key" type="password" required autoComplete="off" placeholder="sk-ant-…" className="input" />
      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
      <button className="btn w-full" disabled={pending}>
        {pending ? "Vérification…" : "Se connecter"}
      </button>
    </form>
  );
}
