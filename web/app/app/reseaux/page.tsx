import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isConfigured } from "@/lib/oauth";
import { PROVIDERS, type Provider } from "@/lib/publish";
import { LegalLinks } from "../../legal";
import { Disconnect } from "./disconnect";

const DOTS: Record<Provider, string> = { youtube: "bg-red-500", tiktok: "bg-cyan-400", instagram: "bg-pink-500" };

const NOTES: Record<Provider, string> = {
  youtube: "Les vidéos verticales de 3 minutes au plus sont classées en Shorts par YouTube.",
  tiktok:
    "Tant que Hooklip n'est pas validé par TikTok, les vidéos sortent en privé. Pour utiliser un son de la bibliothèque TikTok, la vidéo part en brouillon et tu ajoutes le son dans l'appli.",
  instagram: "Compte professionnel ou créateur obligatoire. Les clips sont publiés en Reels.",
};

export default async function NetworksPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { ok, error } = await searchParams;
  const accounts = await db.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Réseaux</h1>
        <p className="mt-1 text-sm text-zinc-400">Connecte les comptes sur lesquels Hooklip publie tes clips.</p>
      </div>
      {ok && (
        <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          {ok}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
      {(Object.keys(PROVIDERS) as Provider[]).map((provider) => {
        const mine = accounts.filter((a) => a.provider === provider);
        return (
          <section key={provider} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <span className={`h-2.5 w-2.5 rounded-full ${DOTS[provider]}`} />
                {PROVIDERS[provider]}
                {mine.length > 0 && (
                  <span className="badge text-emerald-400">
                    {mine.length} connecté{mine.length > 1 ? "s" : ""}
                  </span>
                )}
              </h2>
              {isConfigured(provider) ? (
                // Lien simple, pas <Link> : la route redirige vers le réseau, il ne faut pas la précharger.
                <a className="btn" href={`/api/oauth/${provider}/start`}>
                  {mine.length ? "Connecter un autre compte" : "Connecter un compte"}
                </a>
              ) : (
                <span className="badge text-zinc-400">Bientôt disponible</span>
              )}
            </div>
            <p className="text-xs text-zinc-500">{NOTES[provider]}</p>
            {!isConfigured(provider) && (
              <p className="text-xs text-zinc-500">
                La connexion à {PROVIDERS[provider]} n&apos;est pas encore ouverte. En attendant, télécharge tes clips depuis la bibliothèque et
                publie-les à la main.
              </p>
            )}
            <ul className="space-y-2">
              {mine.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{a.name}</span>
                  <Disconnect id={a.id} name={a.name} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      </div>

      <p className="text-xs text-zinc-500">
        Hooklip ne publie que sur les comptes connectés ici, et seulement quand tu le demandes ou le planifies. Les jetons d&apos;accès sont
        chiffrés ; déconnecter un compte les efface. Ne publie que du contenu dont tu détiens les droits, dans le respect des règles de chaque
        réseau.
      </p>
      <p className="flex gap-4 text-xs text-zinc-500">
        <LegalLinks />
      </p>
    </div>
  );
}
