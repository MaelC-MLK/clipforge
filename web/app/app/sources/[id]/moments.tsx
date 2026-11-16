"use client";

import { useEffect, useRef, useState } from "react";
import type { SourceState } from "@/lib/storage";
import { analyzeSource, deleteCandidate } from "../../../actions";

const BUCKET = 10; // secondes par case, comme worker/detect.py

function clock(seconds: number) {
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** Heatmap du score sur toute la durée. Un clic place la lecture à cet endroit. */
function Heatmap({ scores, duration, onSeek }: { scores: number[]; duration: number; onSeek: (t: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const w = c.width / Math.max(scores.length, 1);
    scores.forEach((score, i) => {
      // Du violet sombre (calme) au jaune (pic).
      ctx.fillStyle = `hsl(${270 - score * 2.2}, 85%, ${18 + score * 0.42}%)`;
      ctx.fillRect(i * w, 0, Math.ceil(w), c.height);
    });
  }, [scores]);

  return (
    <div>
      <canvas
        ref={canvas}
        width={1200}
        height={40}
        className="h-8 w-full cursor-pointer rounded"
        role="img"
        aria-label="Heatmap des meilleurs moments : plus c'est clair, plus le score est élevé"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - box.left) / box.width) * duration);
        }}
      />
      <div className="mt-1 flex justify-between text-xs text-zinc-500">
        <span>0:00:00</span>
        <span>Clique sur la barre pour aller à ce moment</span>
        <span>{clock(Math.max(duration, scores.length * BUCKET))}</span>
      </div>
    </div>
  );
}

export function Moments(props: {
  sourceId: string;
  duration: number;
  state: Pick<SourceState, "analysis" | "candidates">;
  estimateUsd: number;
  budgetLeftUsd: number;
  subscription: boolean;
  onSeek: (t: number) => void;
  onBatch: (candidateIds: string[]) => void;
  onPick: (candidate: SourceState["candidates"][number]) => void;
}) {
  const { analysis, candidates } = props.state;
  const [claude, setClaude] = useState(false);
  const [message, setMessage] = useState<{ error?: string; ok?: string }>({});
  const [pending, setPending] = useState(false);
  const running = analysis.job?.status === "queued" || analysis.job?.status === "running";
  const tooExpensive = claude && !props.subscription && props.estimateUsd > props.budgetLeftUsd;

  return (
    <details className="card" open>
      <summary className="cursor-pointer font-medium">Meilleurs moments</summary>
      <div className="mt-4 space-y-4">
        {running ? (
          <div>
            <p className="text-sm text-violet-300">Analyse en cours : {analysis.job?.progress ?? 0} %</p>
            <div className="mt-1 h-1.5 rounded bg-zinc-800" role="progressbar" aria-valuenow={analysis.job?.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded bg-violet-500 transition-all" style={{ width: `${analysis.job?.progress ?? 0}%` }} />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={claude} onChange={(e) => setClaude(e.target.checked)} className="mt-0.5 h-4 w-4" />
              <span>
                Faire lire le transcript à Claude (titres et raisons pour chaque moment).
                <span className="block text-xs text-zinc-500">
                  {props.subscription
                    ? "Compris dans ton abonnement Claude : l'analyse consomme ton quota, sans facture en plus."
                    : `Coût estimé avec ta clé : environ ${props.estimateUsd.toFixed(2)} $. Budget restant ce mois-ci : ${props.budgetLeftUsd.toFixed(2)} $.`}{" "}
                  La transcription complète tourne sur le serveur : compte à peu près
                  la durée de la vidéo. Sans Claude, l&apos;analyse est gratuite et prend quelques secondes.
                </span>
              </span>
            </label>
            {tooExpensive && (
              <p className="text-sm text-red-400">Cette analyse dépasserait ton budget mensuel. Augmente-le dans Compte.</p>
            )}
            <button
              className="btn"
              disabled={pending || tooExpensive}
              onClick={async () => {
                setPending(true);
                setMessage(await analyzeSource(props.sourceId, claude));
                setPending(false);
              }}
            >
              {analysis.scores.length ? "Relancer l'analyse" : "Analyser cette vidéo"}
            </button>
          </div>
        )}
        {message.error && (
          <p role="alert" className="text-sm text-red-400">
            {message.error}
          </p>
        )}
        {analysis.job?.status === "failed" && (
          <p role="alert" className="text-sm text-red-400">
            L&apos;analyse a échoué : {analysis.job.error}
          </p>
        )}

        {analysis.scores.length > 0 && <Heatmap scores={analysis.scores} duration={props.duration} onSeek={props.onSeek} />}
        {analysis.notes.map((note) => (
          <p key={note} className="text-xs text-zinc-500">
            {note}
          </p>
        ))}

        {analysis.scores.length > 0 && candidates.length === 0 && !running && (
          <p className="text-sm text-zinc-500">Aucun moment ne ressort. Tu peux toujours découper à la main.</p>
        )}
        {candidates.length > 1 && (
          <div>
            <button
              className="btn-ghost"
              onClick={() =>
                confirm(`Lancer le rendu des ${Math.min(candidates.length, 10)} meilleurs moments avec les réglages actuels de l'éditeur ?`) &&
                props.onBatch(candidates.slice(0, 10).map((c) => c.id))
              }
            >
              Créer les {Math.min(candidates.length, 10)} meilleurs clips d&apos;un coup
            </button>
            <p className="mt-1 text-xs text-zinc-500">Chaque clip reprend les bornes et le titre du moment, avec le cadrage, les sous-titres et le son réglés plus bas.</p>
          </div>
        )}
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.id} className="rounded border border-zinc-800 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate font-medium">{c.title}</p>
                <span className="whitespace-nowrap text-sm text-violet-300" title="Score indicatif, de 0 à 100">
                  {c.score} / 100
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                {clock(c.start)} → {clock(c.end)} · {Math.round(c.end - c.start)} s · {c.origin === "claude" ? "proposé par Claude" : "signaux"}
              </p>
              {c.reason && <p className="mt-1 text-sm text-zinc-300">{c.reason}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-ghost" onClick={() => props.onSeek(c.start)}>
                  Voir
                </button>
                <button className="btn-ghost" onClick={() => props.onPick(c)}>
                  Charger dans l&apos;éditeur
                </button>
                <button className="btn-ghost" onClick={() => deleteCandidate(c.id)}>
                  Rejeter
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
