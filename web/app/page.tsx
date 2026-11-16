import Link from "next/link";
import { getUser } from "@/lib/auth";
import { KeyGuide } from "./key-guide";

const features = [
  ["Import", "Colle un lien YouTube, Twitch ou Kick, ou envoie un fichier. Jusqu'à huit heures de vidéo."],
  ["Meilleurs moments", "Une heatmap de toute la vidéo : pics sonores, passages les plus rejoués, et Claude qui lit le transcript pour toi."],
  ["Cadrage vertical", "Suivi du visage, images clés, split facecam et jeu, ou une vidéo de gameplay empilée dessous."],
  ["Sous-titres", "Transcrits mot par mot sur le serveur, en karaoké ou en gros texte. Police, couleur, position, correction à la main."],
  ["Son", "Musique baissée automatiquement sous la voix, voix de synthèse, silences coupés, volume normalisé."],
  ["Publication", "TikTok, Reels et Shorts planifiés depuis un calendrier, avec des textes écrits pour chaque réseau."],
];

const steps = [
  ["Importe", "Un lien ou un fichier. Hooklip télécharge et prépare la vidéo."],
  ["Repère", "Lance l'analyse. Les meilleurs moments arrivent classés, avec leur raison."],
  ["Monte", "Charge un moment dans l'éditeur, règle le cadrage et les sous-titres, lance le rendu."],
  ["Publie", "Choisis tes comptes, une date, et laisse le calendrier travailler."],
];

const free = ["Import et bibliothèque", "Montage, sous-titres, voix de synthèse, musique", "Rendu 1080x1920 et export SRT", "Détection des pics sonores", "Calendrier de publication"];
const withKey = [
  ["Analyse d'une vidéo par Claude", "environ 0,35 $ par heure de vidéo"],
  ["Titres, descriptions et hashtags", "environ 1 centime par clip"],
];

export default async function Landing() {
  const user = await getUser();
  const primary = user ? { href: "/app", label: "Ouvrir Hooklip" } : { href: "/inscription", label: "Créer un compte gratuit" };

  return (
    <div className="landing min-h-screen overflow-x-clip">
      <header className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-5">
        <Link href="/" className="text-xl font-bold">
          Hook<span className="gradient-text">lip</span>
        </Link>
        <nav className="ml-auto hidden items-center gap-6 text-sm text-zinc-300 sm:flex">
          <a href="#fonctions" className="hover:text-white">
            Fonctions
          </a>
          <a href="#etapes" className="hover:text-white">
            Comment ça marche
          </a>
          <a href="#cle" className="hover:text-white">
            Clé Claude
          </a>
        </nav>
        {!user && (
          <Link href="/login" className="ml-auto text-sm font-medium text-zinc-200 hover:text-white sm:ml-0">
            Se connecter
          </Link>
        )}
        <Link href={primary.href} className="btn-primary !px-4 !py-2">
          {user ? "Ouvrir" : "Créer un compte"}
        </Link>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-12 lg:grid-cols-[1.15fr_1fr] lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-200">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              Studio de clipping tout-en-un
            </p>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl">
              De la VOD de six heures au <span className="gradient-text">clip qui tourne.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-zinc-300">
              Hooklip trouve les meilleurs moments de tes lives, les recadre à la verticale, les sous-titre et les publie sur TikTok, Reels et
              Shorts. Tout au même endroit.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={primary.href} className="btn-primary">
                {primary.label}
              </Link>
              <a href="#etapes" className="btn-outline">
                Voir comment ça marche
              </a>
            </div>
            <p className="mt-5 text-sm text-zinc-500">Sans abonnement. Le montage et le rendu sont gratuits ; seule l&apos;analyse par Claude utilise ta propre clé.</p>
          </div>

          {/* Maquette dessinée en CSS : un clip vertical et ce que Hooklip fait autour. */}
          <div className="relative mx-auto w-full max-w-sm" aria-hidden="true">
            <div className="phone relative mx-auto w-56 overflow-hidden rounded-[2rem] sm:w-64">
              <div className="absolute inset-x-0 top-5 flex justify-center">
                <span className="rounded-md bg-white px-2.5 py-1 text-[11px] font-bold text-black">Il ne s&apos;y attendait pas</span>
              </div>
              <span className="absolute right-3 top-14 text-[10px] font-semibold text-white/50">@tachaine</span>
              <div className="absolute left-1/2 top-[30%] h-24 w-24 -translate-x-1/2 rounded-full bg-gradient-to-br from-violet-300/90 to-blue-400/80 blur-[1px]" />
              <div className="absolute left-1/2 top-[47%] h-32 w-40 -translate-x-1/2 rounded-t-[3rem] bg-gradient-to-b from-violet-400/50 to-transparent" />
              <p className="absolute inset-x-0 bottom-[30%] text-center text-xl font-black tracking-tight text-white [text-shadow:0_2px_0_#000,0_0_12px_rgb(0_0_0/0.6)]">
                ATTENDS, <span className="text-yellow-300">QUOI</span> ?!
              </p>
              <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/10">
                <div className="progress h-full bg-yellow-300" />
              </div>
            </div>

            <div className="glass float absolute -left-2 top-12 w-44 p-3 sm:-left-16">
              <p className="text-[11px] font-medium text-zinc-400">Meilleurs moments</p>
              <div className="mt-2 flex h-6 items-end gap-[3px]">
                {[20, 35, 25, 60, 95, 70, 30, 22, 48, 85, 55, 28, 18, 40].map((h, i) => (
                  <span key={i} className="flex-1 rounded-sm bg-gradient-to-t from-violet-600 to-blue-400" style={{ height: `${h}%`, opacity: 0.35 + h / 150 }} />
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-200">
                Score <span className="font-semibold text-violet-300">87 / 100</span>
              </p>
            </div>

            <div className="glass float absolute -right-2 bottom-6 w-48 p-3 [animation-delay:-3s] sm:-right-16">
              <p className="text-[11px] font-medium text-zinc-400">Planifié</p>
              <p className="mt-1 text-sm font-semibold">Ce soir, 18:30</p>
              <div className="mt-2 flex gap-1.5 text-[10px] font-medium">
                <span className="rounded bg-white/10 px-1.5 py-0.5">TikTok</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5">Reels</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5">Shorts</span>
              </div>
            </div>
          </div>
        </section>

        <section id="fonctions" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-16">
          <h2 className="text-3xl font-bold tracking-tight">Tout le parcours, sans changer d&apos;outil</h2>
          <p className="mt-2 max-w-2xl text-zinc-400">Six étapes qui demandent d&apos;habitude quatre logiciels et un tableur.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(([title, text], i) => (
              <div key={title} className="glass p-6 transition hover:border-violet-400/40 hover:bg-white/[0.06]">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 text-sm font-bold">{i + 1}</span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="etapes" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-16">
          <h2 className="text-3xl font-bold tracking-tight">Comment ça marche</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(([title, text], i) => (
              <li key={title} className="relative border-l border-violet-500/40 pl-5">
                <span className="gradient-text text-sm font-bold">Étape {i + 1}</span>
                <h3 className="mt-1 text-lg font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-zinc-400">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="cle" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-16">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="glass p-7">
              <h2 className="text-2xl font-bold tracking-tight">Ce qui est gratuit, ce qui utilise ta clé</h2>
              <p className="mt-2 text-sm text-zinc-400">
                Hooklip ne vend rien. La transcription, le montage et le rendu tournent sur le serveur. Seules deux fonctions appellent Claude,
                avec ta propre clé API : c&apos;est Anthropic qui te facture, au centime près, et tu fixes un budget mensuel.
              </p>
              <h3 className="mt-6 text-sm font-semibold text-emerald-300">Gratuit, sans clé</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
                {free.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-emerald-400">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
              <h3 className="mt-6 text-sm font-semibold text-violet-300">Avec ta clé Claude</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
                {withKey.map(([item, price]) => (
                  <li key={item} className="flex flex-wrap justify-between gap-x-4">
                    <span>{item}</span>
                    <span className="text-zinc-500">{price}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-zinc-500">Ordres de grandeur avec le modèle par défaut. Le coût estimé s&apos;affiche avant chaque analyse.</p>
            </div>

            <div className="glass p-7">
              <h2 className="text-2xl font-bold tracking-tight">Obtenir ta clé API Claude</h2>
              <p className="mb-5 mt-2 text-sm text-zinc-400">Cinq minutes, une seule fois. Tu peux aussi le faire plus tard, depuis ton compte.</p>
              <KeyGuide />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-24 pt-8">
          <div className="glass relative overflow-hidden p-10 text-center">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-violet-600/20 via-transparent to-blue-600/20" />
            <h2 className="relative text-3xl font-bold tracking-tight">Ton prochain clip est déjà dans ta dernière VOD.</h2>
            <p className="relative mx-auto mt-2 max-w-xl text-zinc-400">Crée un compte, colle un lien, et regarde ce qui ressort.</p>
            <Link href={primary.href} className="btn-primary relative mt-6">
              {primary.label}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-zinc-500">
          <p>N&apos;importe que du contenu dont tu détiens les droits ou pour lequel tu as l&apos;autorisation. Respecte les règles de chaque plateforme.</p>
          <a href="https://github.com/MaelC-MLK/clipforge" target="_blank" rel="noreferrer" className="hover:text-zinc-300">
            Code source
          </a>
        </div>
      </footer>
    </div>
  );
}
