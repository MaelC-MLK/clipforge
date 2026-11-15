const CONSOLE = "https://platform.claude.com";

const link = (href: string, text: string) => (
  <a className="font-medium text-violet-300 underline decoration-violet-500/50 underline-offset-2 hover:text-violet-200" href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

/** Les étapes pour obtenir une clé API Claude. Affiché sur la page d'accueil et dans Compte. */
export function KeyGuide() {
  const steps = [
    <>Crée un compte sur {link(CONSOLE, "la console Anthropic")} (platform.claude.com). C&apos;est un compte à part de claude.ai.</>,
    <>
      Ajoute des crédits dans {link(`${CONSOLE}/settings/billing`, "Facturation")}. Quelques dollars suffisent pour commencer : tu ne paies que
      ce que tu consommes.
    </>,
    <>
      Ouvre {link(`${CONSOLE}/settings/keys`, "Clés API")}, clique sur « Create Key », donne-lui un nom (ClipForge, par exemple) et copie la clé.
      Elle commence par <code className="rounded bg-white/10 px-1">sk-ant-</code> et n&apos;est affichée qu&apos;une fois.
    </>,
    <>Colle-la dans ClipForge, page Compte. Elle est vérifiée, chiffrée, et ne revient jamais dans ton navigateur.</>,
  ];
  return (
    <div>
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm text-zinc-300">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-200">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-zinc-500">
        Conseil : fixe un plafond de dépense dans {link(`${CONSOLE}/settings/limits`, "Limites")} côté Anthropic, en plus du budget mensuel que tu
        règles dans ClipForge. Pour arrêter tout accès, supprime la clé dans la console.
      </p>
    </div>
  );
}
