import Link from "next/link";

export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "";

/** Mise en page commune des pages légales (confidentialité, conditions). */
export function Legal({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="landing min-h-screen px-5 py-12">
      <article className="mx-auto max-w-3xl space-y-5 text-sm leading-relaxed text-zinc-300 [&_h2]:pt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_a]:text-violet-300 [&_a]:underline">
        <Link href="/" className="!text-lg font-bold !text-white !no-underline">
          Hook<span className="gradient-text">lip</span>
        </Link>
        <h1 className="text-3xl font-bold text-white">{title}</h1>
        <p className="text-xs text-zinc-500">Dernière mise à jour : {updated}</p>
        {children}
        {CONTACT_EMAIL && (
          <>
            <h2>Contact</h2>
            <p>
              Pour toute question ou demande : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </>
        )}
      </article>
    </main>
  );
}

/** Liens légaux, en pied des pages publiques et de l'onglet Réseaux. */
export function LegalLinks() {
  return (
    <>
      <Link href="/confidentialite" className="hover:text-zinc-300">
        Confidentialité
      </Link>
      <Link href="/conditions" className="hover:text-zinc-300">
        Conditions d&apos;utilisation
      </Link>
    </>
  );
}
