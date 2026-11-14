import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { LoginForm } from "./form";

export default async function LoginPage() {
  if (await getUser()) redirect("/app");
  return (
    <main className="mx-auto max-w-md px-4 py-20">
      <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-200">
        ← Accueil
      </Link>
      <h1 className="mt-4 text-2xl font-bold">Connexion</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Ta clé API Claude te sert d&apos;identifiant. Elle est vérifiée auprès d&apos;Anthropic, puis stockée chiffrée
        sur le serveur. Elle n&apos;est jamais renvoyée à ton navigateur.
      </p>
      <LoginForm />
      <p className="mt-6 rounded-md border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-200">
        Si tu révoques cette clé, tu perds l&apos;accès à ton compte. Pour changer de clé sans rien perdre, utilise «
        Changer de clé » dans la page Compte avant de révoquer l&apos;ancienne.
      </p>
    </main>
  );
}
