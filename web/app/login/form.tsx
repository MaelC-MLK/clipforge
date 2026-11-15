"use client";

import { useActionState } from "react";
import { MIN_PASSWORD } from "@/lib/upload";
import { login, signup } from "../actions";

/** Formulaire de connexion ou d'inscription : mêmes champs, l'inscription demande en plus une confirmation. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [state, action, pending] = useActionState(mode === "login" ? login : signup, {});
  const creating = mode === "signup";
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" placeholder="toi@exemple.fr" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={creating ? MIN_PASSWORD : undefined}
          autoComplete={creating ? "new-password" : "current-password"}
          className="input"
        />
        {creating && <p className="mt-1 text-xs text-zinc-500">{MIN_PASSWORD} caractères au moins. Une phrase longue vaut mieux qu&apos;un mot compliqué.</p>}
      </div>
      {creating && (
        <div>
          <label className="label" htmlFor="confirm">
            Confirme le mot de passe
          </label>
          <input id="confirm" name="confirm" type="password" required autoComplete="new-password" className="input" />
        </div>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Un instant…" : creating ? "Créer mon compte" : "Se connecter"}
      </button>
    </form>
  );
}
