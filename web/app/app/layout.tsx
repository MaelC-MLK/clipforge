import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { usesSubscription } from "@/lib/claude";
import { db } from "@/lib/db";
import { logout } from "../actions";
import { Nav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const failed = await db.publication.count({ where: { userId: user.id, status: "failed" } });
  return (
    <div className="app-shell min-h-screen">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07060e]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/app" className="text-lg font-bold">
            Hook<span className="gradient-text">lip</span>
          </Link>
          <Nav failed={failed} />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden max-w-48 truncate text-xs text-zinc-500 lg:block">{user.email}</span>
            <form action={logout}>
              <button className="btn-ghost">Se déconnecter</button>
            </form>
          </div>
        </div>
      </header>
      {!user.keyEncrypted && !usesSubscription(user) && (
        <p className="border-b border-violet-400/20 bg-violet-500/10 px-4 py-2 text-center text-sm text-violet-200">
          Il te manque une clé API Claude pour l&apos;analyse des meilleurs moments et les textes de publication.{" "}
          <Link href="/app/compte#cle" className="font-medium underline">
            L&apos;ajouter
          </Link>
        </p>
      )}
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
