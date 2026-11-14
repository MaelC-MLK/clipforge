import Link from "next/link";

const features = [
  ["Import", "Colle une URL YouTube, Twitch ou Kick, ou envoie un fichier depuis ton ordinateur."],
  ["Meilleurs moments", "Chat, audio, heatmap et lecture du transcript par Claude pour repérer ce qui mérite un clip."],
  ["Montage vertical", "Recadrage 9:16 avec suivi du visage, sous-titres mot par mot, musique et gameplay empilé."],
  ["Publication", "Planifie tes clips sur TikTok, Reels et Shorts depuis un seul calendrier."],
];

export default function Landing() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-20">
      <h1 className="text-5xl font-bold tracking-tight">
        Clip<span className="text-violet-500">Forge</span>
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-zinc-300">
        Toute la chaîne du clip court au même endroit : de la VOD de six heures au clip vertical sous-titré, prêt à
        publier.
      </p>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">
        Un seul prérequis : ta clé API Claude. La transcription, le recadrage et le rendu tournent sur le serveur, sans
        autre service payant.
      </p>
      <Link href="/login" className="btn mt-8">
        Se connecter
      </Link>

      <div className="mt-16 grid gap-4 sm:grid-cols-2">
        {features.map(([title, text]) => (
          <div key={title} className="card">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{text}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
