import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { usesSubscription } from "@/lib/claude";
import { db } from "@/lib/db";
import { logout } from "../actions";
import { MobileNav, SideNav } from "./nav";

const Logo = ({ className = "" }: { className?: string }) => (
  <Link href="/app" className={`text-xl font-bold ${className}`}>
    Hook<span className="gradient-text">lip</span>
  </Link>
);

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const failed = await db.publication.count({ where: { userId: user.id, status: "failed" } });
  return (
    <div className="app-shell min-h-screen md:pl-60">
      {/* Mobile : logo en haut, onglets en bas. À partir de md : une seule colonne fixe à gauche. */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#07060e]/85 px-4 py-3 backdrop-blur md:hidden">
        <Logo />
        <form action={logout}>
          <button className="btn-ghost">Se déconnecter</button>
        </form>
      </header>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#07060e]/95 backdrop-blur md:hidden">
        <MobileNav failed={failed} />
      </div>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-white/10 bg-black/25 md:flex">
        <Logo className="px-6 py-6" />
        <SideNav failed={failed} />
        <div className="space-y-3 border-t border-white/10 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-blue-600 text-sm font-semibold uppercase">
              {user.email[0]}
            </span>
            <span className="min-w-0 truncate text-xs text-zinc-400" title={user.email}>
              {user.email}
            </span>
          </div>
          <form action={logout}>
            <button className="btn-ghost w-full">Se déconnecter</button>
          </form>
        </div>
      </aside>
      {!user.keyEncrypted && !usesSubscription(user) && (
        <p className="border-b border-violet-400/20 bg-violet-500/10 px-4 py-2 text-center text-sm text-violet-200">
          Il te manque une clé API Claude pour l&apos;analyse des meilleurs moments et les textes de publication.{" "}
          <Link href="/app/compte#cle" className="font-medium underline">
            L&apos;ajouter
          </Link>
        </p>
      )}
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-8 md:px-8 md:pb-10">{children}</main>
    </div>
  );
}
