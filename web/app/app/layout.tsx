import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logout } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const failed = await db.publication.count({ where: { userId: user.id, status: "failed" } });
  return (
    <>
      <header className="border-b border-zinc-800">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
          <Link href="/app" className="text-base font-bold">
            Clip<span className="text-violet-500">Forge</span>
          </Link>
          <Link href="/app" className="text-zinc-300 hover:text-white">
            Bibliothèque
          </Link>
          <Link href="/app/tableau" className="text-zinc-300 hover:text-white">
            Tableau de bord
          </Link>
          <Link href="/app/calendrier" className="text-zinc-300 hover:text-white">
            Calendrier
            {failed > 0 && (
              <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-xs text-white" title="Publications en échec">
                {failed}
              </span>
            )}
          </Link>
          <Link href="/app/reseaux" className="text-zinc-300 hover:text-white">
            Réseaux
          </Link>
          <Link href="/app/compte" className="text-zinc-300 hover:text-white">
            Utilisation et compte
          </Link>
          <form action={logout} className="ml-auto">
            <button className="btn-ghost">Se déconnecter</button>
          </form>
        </nav>
      </header>
      {!user.keyEncrypted && (
        <p className="border-b border-violet-900/60 bg-violet-950/40 px-4 py-2 text-center text-sm text-violet-200">
          Il te manque une clé API Claude pour l&apos;analyse des meilleurs moments et les textes de publication.{" "}
          <Link href="/app/compte#cle" className="font-medium underline">
            L&apos;ajouter
          </Link>
        </p>
      )}
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}
