import Link from "next/link";
import { ResetRequestForm } from "./form";

export default function ForgotPage() {
  return (
    <main className="landing flex min-h-screen items-center justify-center px-4 py-16">
      <div className="glass w-full max-w-md p-8">
        <Link href="/" className="text-lg font-bold">
          Hook<span className="gradient-text">lip</span>
        </Link>
        <h1 className="mt-6 text-2xl font-bold">Mot de passe oublié</h1>
        <p className="mt-1 text-sm text-zinc-400">Indique l&apos;email de ton compte. Tu recevras un lien pour choisir un nouveau mot de passe.</p>
        <ResetRequestForm />
        <p className="mt-6 text-sm text-zinc-400">
          <Link href="/login" className="font-medium text-violet-300 hover:text-violet-200">
            ← Retour à la connexion
          </Link>
        </p>
      </div>
    </main>
  );
}
