import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, signupsOpen } from "@/lib/auth";
import { AuthForm } from "../login/form";

export default async function SignupPage() {
  if (await getUser()) redirect("/app");
  return (
    <main className="landing flex min-h-screen items-center justify-center px-4 py-16">
      <div className="glass w-full max-w-md p-8">
        <Link href="/" className="text-lg font-bold">
          Hook<span className="gradient-text">lip</span>
        </Link>
        <h1 className="mt-6 text-2xl font-bold">Créer un compte</h1>
        {signupsOpen() ? (
          <>
            <p className="mt-1 text-sm text-zinc-400">
              Gratuit. Tu peux importer, monter et exporter tout de suite ; la clé Claude s&apos;ajoute ensuite, quand tu veux l&apos;analyse
              automatique.
            </p>
            <AuthForm mode="signup" />
          </>
        ) : (
          <p className="mt-3 text-sm text-zinc-300">Hooklip est encore en préparation : les inscriptions ouvriront bientôt.</p>
        )}
        <p className="mt-6 text-sm text-zinc-400">
          Déjà inscrit ?{" "}
          <Link href="/login" className="font-medium text-violet-300 hover:text-violet-200">
            Se connecter
          </Link>
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          Ton mot de passe est haché, jamais stocké en clair. N&apos;importe que du contenu dont tu détiens les droits.
        </p>
      </div>
    </main>
  );
}
