"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Tracés d'icônes en trait, sur une grille 24x24.
const LINKS = [
  { href: "/app", label: "Bibliothèque", short: "Biblio", icon: "M4 5h16v14H4zM10 9.5v5l4.5-2.5z" },
  { href: "/app/fast", label: "Fast clip", short: "Fast", icon: "M13 2 4 14h7l-1 8 9-12h-7z" },
  { href: "/app/recommandes", label: "Recommandés", short: "Reco", icon: "M12 3c.5 3.5 5 5.5 5 10.5a5 5 0 01-10 0c0-2.5 1.5-4 2.5-5 .5 1.5 1.5 2.5 2.5 2.5 0-3-.5-5.5 0-8z" },
  { href: "/app/tableau", label: "Tableau de bord", short: "Tableau", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { href: "/app/calendrier", label: "Calendrier", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { href: "/app/reseaux", label: "Réseaux", icon: "M8.5 10.5l7-4M8.5 13.5l7 4M6 15a3 3 0 100-6 3 3 0 000 6zM18 8a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6z" },
  { href: "/app/compte", label: "Compte", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.5-6 8-6s8 2 8 6" },
];

/** Barre d'onglets en bas sur mobile, liste verticale dans la colonne de gauche à partir de md. */
export function Nav({ failed }: { failed: number }) {
  const path = usePathname();
  // La bibliothèque couvre aussi l'éditeur et la publication (/app/sources, /app/clips).
  const active = (href: string) => (href === "/app" ? !LINKS.some((l) => l.href !== "/app" && path.startsWith(l.href)) : path.startsWith(href));
  return (
    <nav aria-label="Navigation principale" className="flex md:flex-1 md:flex-col md:gap-1 md:px-3">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? "page" : undefined}
          className={`relative flex flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[11px] transition md:flex-none md:flex-row md:gap-3 md:rounded-xl md:px-3 md:py-2.5 md:text-sm ${
            active(l.href) ? "text-violet-300 md:bg-gradient-to-r md:from-violet-600/25 md:to-blue-600/5 md:font-medium md:text-white md:shadow-[inset_2px_0_0_#8b5cf6]" : "text-zinc-400 hover:text-white md:hover:bg-white/5"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={l.icon} />
          </svg>
          <span className="md:hidden">{l.short ?? l.label}</span>
          <span className="hidden md:inline">{l.label}</span>
          {l.href === "/app/calendrier" && failed > 0 && (
            <span className="absolute right-1/4 top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold leading-4 text-white md:static md:ml-auto md:text-xs md:leading-5" title="Publications en échec">
              {failed}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
