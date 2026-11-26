"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

// Tracés d'icônes en trait, sur une grille 24x24.
const ICONS = {
  home: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  fast: "M13 2 4 14h7l-1 8 9-12h-7z",
  cut: "M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12",
  reco: "M12 3c.5 3.5 5 5.5 5 10.5a5 5 0 01-10 0c0-2.5 1.5-4 2.5-5 .5 1.5 1.5 2.5 2.5 2.5 0-3-.5-5.5 0-8z",
  videos: "M4 5h16v14H4zM10 9.5v5l4.5-2.5z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  networks: "M8.5 10.5l7-4M8.5 13.5l7 4M6 15a3 3 0 100-6 3 3 0 000 6zM18 8a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6z",
  stats: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  account: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.5-6 8-6s8 2 8 6",
  menu: "M4 6h16M4 12h16M4 18h16",
};

type Item = { href: string; label: string; hint: string; icon: string; also?: string[] };

// Une section = un moment du travail. Chaque onglet fait une seule chose.
const SECTIONS: { title: string; items: Item[] }[] = [
  { title: "", items: [{ href: "/app", label: "Accueil", hint: "Par où commencer", icon: ICONS.home }] },
  {
    title: "Créer",
    items: [
      { href: "/app/fast", label: "Fast clip", hint: "Une vidéo courte, prête en 3 étapes", icon: ICONS.fast },
      { href: "/app/sources", label: "Découper", hint: "Tirer des clips d'une longue vidéo", icon: ICONS.cut },
      { href: "/app/recommandes", label: "Recommandés", hint: "Clips en vogue de tes niches", icon: ICONS.reco },
    ],
  },
  {
    title: "Mes vidéos",
    items: [{ href: "/app/videos", label: "Vidéos prêtes", hint: "Tout ce qui peut être publié", icon: ICONS.videos, also: ["/app/clips"] }],
  },
  {
    title: "Publier",
    items: [
      { href: "/app/calendrier", label: "Calendrier", hint: "Publications programmées", icon: ICONS.calendar },
      { href: "/app/reseaux", label: "Réseaux", hint: "Comptes connectés", icon: ICONS.networks },
    ],
  },
  { title: "Suivi", items: [{ href: "/app/tableau", label: "Statistiques", hint: "Vues et résultats", icon: ICONS.stats }] },
];
const ACCOUNT: Item = { href: "/app/compte", label: "Compte", hint: "Clé, stockage, mot de passe", icon: ICONS.account };
const ALL = [...SECTIONS.flatMap((s) => s.items), ACCOUNT];
// Barre du bas sur mobile : les onglets les plus utilisés, le reste dans « Menu ».
const MOBILE = ["/app", "/app/fast", "/app/sources", "/app/videos"];

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

function useActive() {
  const path = usePathname();
  return (item: Item) =>
    item.href === "/app" ? path === "/app" : [item.href, ...(item.also ?? [])].some((h) => path === h || path.startsWith(`${h}/`));
}

function Badge({ count }: { count: number }) {
  return (
    <span className="ml-auto rounded-full bg-red-600 px-1.5 text-xs font-semibold leading-5 text-white" title="Publications en échec">
      {count}
    </span>
  );
}

/** Colonne de gauche, à partir de md. */
export function SideNav({ failed }: { failed: number }) {
  const active = useActive();
  const link = (item: Item) => (
    <Link
      key={item.href}
      href={item.href}
      title={item.hint}
      aria-current={active(item) ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
        active(item) ? "bg-gradient-to-r from-violet-600/25 to-blue-600/5 font-medium text-white shadow-[inset_2px_0_0_#8b5cf6]" : "text-zinc-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      <Icon d={item.icon} />
      {item.label}
      {item.href === "/app/calendrier" && failed > 0 && <Badge count={failed} />}
    </Link>
  );
  return (
    <nav aria-label="Navigation principale" className="flex-1 space-y-4 overflow-y-auto px-3">
      {SECTIONS.map((s) => (
        <div key={s.title || "home"} className="space-y-0.5">
          {s.title && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{s.title}</p>}
          {s.items.map(link)}
        </div>
      ))}
      <div className="space-y-0.5 border-t border-white/10 pt-3">{link(ACCOUNT)}</div>
    </nav>
  );
}

/** Barre du bas sur mobile, avec un menu pour les autres onglets. */
export function MobileNav({ failed }: { failed: number }) {
  const active = useActive();
  const [open, setOpen] = useState(false);
  const more = ALL.filter((i) => !MOBILE.includes(i.href));
  const moreActive = more.some(active);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/60" onClick={() => setOpen(false)}>
          <nav
            aria-label="Autres onglets"
            className="absolute inset-x-3 bottom-20 space-y-1 rounded-2xl border border-white/10 bg-[#100e1c] p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {more.map((i) => (
              <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${active(i) ? "bg-white/10 text-white" : "text-zinc-300"}`}>
                <Icon d={i.icon} />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{i.label}</span>
                  <span className="block text-xs text-zinc-500">{i.hint}</span>
                </span>
                {i.href === "/app/calendrier" && failed > 0 && <Badge count={failed} />}
              </Link>
            ))}
          </nav>
        </div>
      )}
      <nav aria-label="Navigation principale" className="flex">
        {MOBILE.map((href) => {
          const item = ALL.find((i) => i.href === href)!;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active(item) ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ${active(item) ? "text-violet-300" : "text-zinc-400"}`}
            >
              <Icon d={item.icon} />
              {item.label === "Vidéos prêtes" ? "Vidéos" : item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ${open || moreActive ? "text-violet-300" : "text-zinc-400"}`}
        >
          <Icon d={ICONS.menu} />
          Menu
          {failed > 0 && <span className="absolute right-1/4 top-1.5 h-2 w-2 rounded-full bg-red-500" />}
        </button>
      </nav>
    </>
  );
}
