"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/app", "Bibliothèque"],
  ["/app/tableau", "Tableau de bord"],
  ["/app/calendrier", "Calendrier"],
  ["/app/reseaux", "Réseaux"],
  ["/app/compte", "Compte"],
];

export function Nav({ failed }: { failed: number }) {
  const path = usePathname();
  // La bibliothèque couvre aussi l'éditeur et la publication (/app/sources, /app/clips).
  const active = (href: string) => (href === "/app" ? !LINKS.some(([h]) => h !== "/app" && path.startsWith(h)) : path.startsWith(href));
  return (
    <nav aria-label="Navigation principale" className="order-last -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto">
      {LINKS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={active(href) ? "page" : undefined}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${active(href) ? "bg-white/10 font-medium text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}
        >
          {label}
          {href === "/app/calendrier" && failed > 0 && (
            <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs text-white" title="Publications en échec">
              {failed}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
