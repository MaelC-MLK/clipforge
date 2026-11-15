import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { APP_URL, isConfigured, redirectUri } from "@/lib/oauth";
import { PROVIDERS, type Provider } from "@/lib/publish";
import { Disconnect } from "./disconnect";

const NOTES: Record<Provider, string> = {
  youtube: "Les vidéos verticales de 3 minutes au plus sont classées en Shorts par YouTube.",
  tiktok:
    "Tant que l'application TikTok n'est pas validée par TikTok, les vidéos sortent en privé. Pour utiliser un son de la bibliothèque TikTok, la vidéo part en brouillon et tu ajoutes le son dans l'appli.",
  instagram: "Compte professionnel ou créateur obligatoire. Instagram télécharge la vidéo depuis ce site : il doit être joignable en https depuis Internet.",
};

export default async function NetworksPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const { ok, error } = await searchParams;
  const accounts = await db.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Réseaux</h1>
      {ok && (
        <p role="status" className="text-sm text-emerald-400">
          {ok}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {(Object.keys(PROVIDERS) as Provider[]).map((provider) => {
        const mine = accounts.filter((a) => a.provider === provider);
        return (
          <section key={provider} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-medium">{PROVIDERS[provider]}</h2>
              {isConfigured(provider) ? (
                // Lien simple, pas <Link> : la route redirige vers le réseau, il ne faut pas la précharger.
                <a className="btn" href={`/api/oauth/${provider}/start`}>
                  {mine.length ? "Connecter un autre compte" : "Connecter un compte"}
                </a>
              ) : (
                <span className="text-sm text-zinc-500">Non configuré sur ce serveur</span>
              )}
            </div>
            <p className="text-xs text-zinc-500">{NOTES[provider]}</p>
            {!isConfigured(provider) && (
              <p className="text-xs text-zinc-500">
                L&apos;administrateur doit créer une application développeur et renseigner ses identifiants dans <code>.env</code>{" "}
                (voir le README). Adresse de retour à déclarer : <code>{redirectUri(provider)}</code>
              </p>
            )}
            <ul className="space-y-2">
              {mine.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 rounded border border-zinc-800 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{a.name}</span>
                  <Disconnect id={a.id} name={a.name} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="text-xs text-zinc-500">
        Adresse publique du site : <code>{APP_URL}</code>. Les jetons d&apos;accès sont chiffrés en base, comme ta clé Claude. Ne publie que
        du contenu dont tu détiens les droits, dans le respect des règles de chaque réseau.
      </p>
    </div>
  );
}
