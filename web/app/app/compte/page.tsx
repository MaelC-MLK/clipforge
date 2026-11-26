import { stat } from "node:fs/promises";
import { isOwner, requireUser } from "@/lib/auth";
import { usesSubscription } from "@/lib/claude";
import { db } from "@/lib/db";
import { abs, quotaBytes, usedBytes, YOUTUBE_COOKIES } from "@/lib/storage";
import { KeyGuide } from "../../key-guide";
import { AccountForm, KeyForm, PasswordForm, YoutubeCookiesForm } from "./forms";

function Meter({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-zinc-400">
          {value.toFixed(2)} / {max.toFixed(2)} {unit}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${percent >= 90 ? "bg-red-500" : "bg-gradient-to-r from-violet-500 to-blue-500"}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ bienvenue?: string }> }) {
  const user = await requireUser();
  const { bienvenue } = await searchParams;
  const subscription = usesSubscription(user);
  const owner = isOwner(user);
  const cookies = owner ? await stat(abs(YOUTUBE_COOKIES)).catch(() => null) : null;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [used, month] = await Promise.all([
    usedBytes(user.id),
    db.usage.aggregate({
      where: { userId: user.id, createdAt: { gte: monthStart } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="page-title">Utilisation et compte</h1>
      {bienvenue && (
        <p role="status" className="rounded-lg border border-violet-800/60 bg-violet-950/40 p-4 text-sm text-violet-100">
          Bienvenue ! Ton compte est créé. Tu peux déjà importer une vidéo depuis Fast clip ou Découper. Pour l&apos;analyse automatique et les textes de
          publication, ajoute ta clé API Claude ci-dessous.
        </p>
      )}
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Utilisation</h2>
        {subscription ? (
          <p className="text-sm">Claude passe par ton abonnement : pas de coût à l&apos;appel, les analyses consomment ton quota d&apos;abonnement.</p>
        ) : (
          <Meter label="Coût Claude ce mois-ci" value={month._sum.costUsd ?? 0} max={user.monthlyBudgetUsd} unit="$" />
        )}
        <p className="text-xs text-zinc-500">
          {month._count} appel(s) · {(month._sum.inputTokens ?? 0).toLocaleString("fr-FR")} tokens en entrée ·{" "}
          {(month._sum.outputTokens ?? 0).toLocaleString("fr-FR")} en sortie. Estimation calculée par Hooklip à partir
          des tokens consommés. Quand le budget est atteint, les analyses sont bloquées.
        </p>
        <Meter label="Stockage" value={used / 1024 ** 3} max={quotaBytes(user) / 1024 ** 3} unit="Go" />
        <p className="text-xs text-zinc-500">
          Le solde de crédits et les limites de ton compte Anthropic se consultent sur{" "}
          <a className="underline" href="https://platform.claude.com/settings/billing" target="_blank" rel="noreferrer">
            la console Anthropic
          </a>
          .
        </p>
      </section>

      <section id="cle" className="card scroll-mt-6">
        <h2 className="text-lg font-semibold">Clé API Claude</h2>
        {subscription && (
          <p className="mt-1 text-sm text-emerald-400">
            Claude est inclus sur ce compte : Hooklip s&apos;en charge, aucune clé API n&apos;est nécessaire.
          </p>
        )}
        {subscription ? null : user.keyEncrypted ? (
          <p className="mt-1 text-sm text-emerald-400">Une clé est enregistrée. Elle est chiffrée et n&apos;est jamais renvoyée à ton navigateur.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-zinc-400">
              Sans clé, tu peux importer, monter et exporter. Avec ta clé, Hooklip fait lire tes vidéos à Claude pour repérer les meilleurs
              moments et écrire les textes de publication. C&apos;est ta clé qui est facturée par Anthropic, au tarif d&apos;Anthropic : compte
              environ 0,35 $ par heure de vidéo analysée et 1 centime par clip pour les textes.
            </p>
            <div className="mt-4 rounded-xl border border-white/10 p-4">
              <h3 className="mb-3 text-sm font-medium">Comment obtenir une clé</h3>
              <KeyGuide />
            </div>
          </>
        )}
        <KeyForm hasKey={Boolean(user.keyEncrypted)} />
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">Budget et stockage</h2>
        <AccountForm budget={user.monthlyBudgetUsd} purgeDays={user.purgeDays} />
      </section>

      {owner && (
        <section id="youtube" className="card scroll-mt-6">
          <h2 className="text-lg font-semibold">Imports YouTube (serveur)</h2>
          <p className="mt-1 text-sm text-zinc-400">
            YouTube bloque souvent les téléchargements depuis un serveur, et toujours les vidéos à restriction d&apos;âge, sans compte connecté.
            Dépose ici les cookies d&apos;un compte YouTube : ils servent à tous les imports. Utilise un compte secondaire, pas ton compte
            principal.
          </p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
            <li>Dans une fenêtre de navigation privée, connecte-toi à YouTube avec le compte secondaire.</li>
            <li>
              Exporte les cookies de youtube.com au format Netscape avec une extension comme « Get cookies.txt LOCALLY », puis ferme la fenêtre
              privée sans te déconnecter.
            </li>
            <li>Envoie le fichier ci-dessous. Il reste sur le serveur et n&apos;est jamais renvoyé au navigateur.</li>
          </ol>
          <p className={`mt-3 text-sm ${cookies ? "text-emerald-400" : "text-amber-300"}`}>
            {cookies
              ? `Cookies enregistrés le ${cookies.mtime.toLocaleDateString("fr-FR", { timeZone: "UTC" })}. S'ils expirent, les imports YouTube échouent avec un message qui le dit.`
              : "Aucun cookie enregistré : les imports YouTube risquent d'échouer."}
          </p>
          <YoutubeCookiesForm saved={Boolean(cookies)} />
        </section>
      )}

      <section className="card">
        <h2 className="text-lg font-semibold">Compte</h2>
        <p className="mt-1 text-sm text-zinc-400">Connecté avec {user.email}.</p>
        <PasswordForm />
      </section>
    </div>
  );
}
