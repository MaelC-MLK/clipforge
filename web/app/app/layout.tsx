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
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 text-sm">
          <Link href="/app" className="text-base font-bold">
            Clip<span className="text-violet-500">Forge</span>
          </Link>
          <Link href="/app" className="text-zinc-300 hover:text-white">
            Bibliothèque
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
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </>
  );
}
