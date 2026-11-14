import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { quotaBytes, usedBytes } from "@/lib/storage";
import { AccountForm, KeyForm } from "./forms";

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
      <div className="mt-1 h-2 rounded bg-zinc-800" role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded ${percent >= 90 ? "bg-red-500" : "bg-violet-500"}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default async function AccountPage() {
  const user = await requireUser();
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
      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Utilisation</h2>
        <Meter label="Coût Claude ce mois-ci" value={month._sum.costUsd ?? 0} max={user.monthlyBudgetUsd} unit="$" />
        <p className="text-xs text-zinc-500">
          {month._count} appel(s) · {(month._sum.inputTokens ?? 0).toLocaleString("fr-FR")} tokens en entrée ·{" "}
          {(month._sum.outputTokens ?? 0).toLocaleString("fr-FR")} en sortie. Estimation calculée par ClipForge à partir
          des tokens consommés. Quand le budget est atteint, les analyses sont bloquées.
        </p>
        <Meter label="Stockage" value={used / 1024 ** 3} max={quotaBytes(user) / 1024 ** 3} unit="Go" />
        <p className="text-xs text-zinc-500">
          Le solde de crédits et les limites de ton compte Anthropic se consultent sur{" "}
          <a className="underline" href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer">
            la console Anthropic
          </a>
          .
        </p>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">Budget et récupération</h2>
        <AccountForm email={user.recoveryEmail ?? ""} budget={user.monthlyBudgetUsd} />
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">Changer de clé</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Tes sources et tes clips restent liés à ton compte. Fais ce changement avant de révoquer l&apos;ancienne clé :
          une fois révoquée, elle ne permet plus de se connecter.
        </p>
        <KeyForm />
      </section>
    </div>
  );
}
