import Link from "next/link";
import { NewPasswordForm } from "../../mot-de-passe-oublie/form";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="landing flex min-h-screen items-center justify-center px-4 py-16">
      <div className="glass w-full max-w-md p-8">
        <Link href="/" className="text-lg font-bold">
          Clip<span className="gradient-text">Forge</span>
        </Link>
        <h1 className="mt-6 text-2xl font-bold">Nouveau mot de passe</h1>
        <p className="mt-1 text-sm text-zinc-400">Ce lien ne sert qu&apos;une fois et expire une heure après son envoi.</p>
        <NewPasswordForm token={token} />
      </div>
    </main>
  );
}
