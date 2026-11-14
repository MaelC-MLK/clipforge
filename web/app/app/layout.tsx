import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
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
