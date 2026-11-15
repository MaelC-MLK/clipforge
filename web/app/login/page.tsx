import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { AuthForm } from "./form";

export default async function LoginPage() {
  if (await getUser()) redirect("/app");
  return (
    <main className="landing flex min-h-screen items-center justify-center px-4 py-16">
      <div className="glass w-full max-w-md p-8">
        <Link href="/" className="text-lg font-bold">
          Clip<span className="gradient-text">Forge</span>
        </Link>
        <h1 className="mt-6 text-2xl font-bold">Connexion</h1>
        <p className="mt-1 text-sm text-zinc-400">Content de te revoir.</p>
        <AuthForm mode="login" />
        <p className="mt-6 text-sm text-zinc-400">
          Pas encore de compte ?{" "}
          <Link href="/inscription" className="font-medium text-violet-300 hover:text-violet-200">
            Créer un compte
          </Link>
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          Mot de passe oublié : la réinitialisation par email n&apos;est pas encore disponible. Contacte l&apos;administrateur du site.
        </p>
      </div>
    </main>
  );
}
