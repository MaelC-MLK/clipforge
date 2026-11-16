"""Fonctions pures de la détection des meilleurs moments : signaux, score, candidats, coût Claude. Testées dans test_worker.py."""

import json

BUCKET = 10  # secondes par case de la heatmap

# Poids de chaque signal dans le score. Seuls les signaux disponibles comptent, leurs poids sont ramenés à 1.
WEIGHTS = {"claude": 0.4, "heatmap": 0.35, "clips": 0.3, "audio": 0.2}
LABELS = {"heatmap": "très rejoué sur YouTube", "clips": "déjà clippé par des viewers", "audio": "pic sonore", "claude": "repéré par Claude"}

# Dollars par million de tokens (entrée, sortie). Mêmes valeurs que web/lib/cost.ts.
PRICES = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.1, 0.5)}
SLICE_MINUTES = 25


def bucket_mean(per_second: list[float], size: int = BUCKET) -> list[float]:
    """Moyenne par case de `size` secondes."""
    return [sum(per_second[i:i + size]) / len(per_second[i:i + size]) for i in range(0, len(per_second), size)]


def spread(items: list[tuple[float, float, float]], buckets: int, size: int = BUCKET) -> list[float]:
    """Répartit des intervalles (début, fin, valeur) sur les cases : chaque case prend la plus forte valeur qui la touche."""
    out = [0.0] * buckets
    for start, end, value in items:
        for i in range(max(0, int(start // size)), min(buckets, int(max(end - 0.001, start) // size) + 1)):
            out[i] = max(out[i], value)
    return out


def normalize(values: list[float]) -> list[float]:
    """Ramène un signal entre 0 et 1 : 0 = niveau habituel (médiane), 1 = maximum. Signal plat : tout à 0."""
    if not values:
        return []
    base, top = sorted(values)[len(values) // 2], max(values)
    if top <= base:
        return [0.0] * len(values)
    return [max(0.0, (v - base) / (top - base)) for v in values]


def combine(signals: dict[str, list[float]]) -> list[int]:
    """Score de 0 à 100 par case : moyenne pondérée des signaux disponibles, déjà normalisés."""
    used = {name: values for name, values in signals.items() if values and name in WEIGHTS}
    if not used:
        return []
    total = sum(WEIGHTS[name] for name in used)
    length = max(len(v) for v in used.values())
    return [
        round(100 * sum(WEIGHTS[name] * (values[i] if i < len(values) else 0) for name, values in used.items()) / total)
        for i in range(length)
    ]


def pick_moments(scores: list[int], count: int, before: float = 20, after: float = 10, min_gap: float = 60,
                 size: int = BUCKET) -> list[tuple[float, float, int]]:
    """Les `count` meilleurs pics du score : (début, fin, score). Le clip commence avant le pic, où se trouve le contexte."""
    duration = len(scores) * size
    peaks: list[int] = []
    for i in sorted(range(len(scores)), key=lambda i: -scores[i]):
        if len(peaks) >= count or scores[i] <= 0:
            break
        if all(abs(i - p) * size >= min_gap for p in peaks):
            peaks.append(i)
    return sorted((max(0.0, i * size - before), min(float(duration), i * size + size + after), scores[i]) for i in peaks)


def mean_score(scores: list[int], start: float, end: float, size: int = BUCKET) -> float:
    part = scores[int(start // size):int(max(end - 0.001, start) // size) + 1]
    return sum(part) / len(part) if part else 0.0


def why(signals: dict[str, list[float]], start: float, end: float, size: int = BUCKET) -> str:
    """Raison lisible d'un pic : les signaux qui ressortent sur l'intervalle, du plus fort au plus faible."""
    a, b = int(start // size), int(max(end - 0.001, start) // size) + 1
    strength = {name: max(values[a:b], default=0) for name, values in signals.items() if name in LABELS}
    names = [name for name, value in sorted(strength.items(), key=lambda x: -x[1]) if value >= 0.3]
    return ", ".join(LABELS[name] for name in names).capitalize() or "Moment au-dessus de la moyenne"


def clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}"


def slices(transcript: list[tuple[float, str]], minutes: float = SLICE_MINUTES) -> list[list[tuple[float, str]]]:
    """Découpe le transcript en tranches de `minutes` minutes, envoyées une par une à Claude."""
    out: dict[int, list[tuple[float, str]]] = {}
    for t, text in transcript:
        out.setdefault(int(t // (minutes * 60)), []).append((t, text))
    return [out[k] for k in sorted(out)]


def format_slice(lines: list[tuple[float, str]]) -> str:
    return "\n".join(f"[{int(t)}] {text}" for t, text in lines)


def clean_moments(raw: list[dict], lo: float, hi: float) -> list[dict]:
    """Valide les moments proposés par Claude : dans la tranche [lo, hi], entre 10 et 180 secondes, score borné."""
    out = []
    for m in raw:
        try:
            start, end = max(lo, float(m["start"])), min(hi, float(m["end"]))
            score = max(0, min(100, int(m["score"])))
        except (KeyError, TypeError, ValueError):
            continue
        if end - start < 10:
            continue
        out.append({
            "start": start, "end": min(end, start + 180), "score": score,
            "title": str(m.get("title", "")).strip()[:150] or f"Moment à {clock(start)}",
            "reason": str(m.get("reason", "")).strip()[:300],
        })
    return out


def build_candidates(scores: list[int], signals: dict[str, list[float]], moments: list[dict], duration: float) -> list[dict]:
    """Liste finale : les moments de Claude, puis les pics des autres signaux qui ne les recoupent pas."""
    out = [{**m, "score": round((m["score"] + mean_score(scores, m["start"], m["end"])) / 2), "origin": "claude"} for m in moments]
    count = max(3, min(20, int(duration // 600)))
    # Les cases déjà couvertes par Claude ne comptent pas : elles prendraient la place d'autres pics.
    free = [0 if any(m["start"] < (i + 1) * BUCKET and i * BUCKET < m["end"] for m in moments) else v for i, v in enumerate(scores)]
    for start, end, score in pick_moments(free, count):
        out.append({"start": start, "end": end, "score": score, "title": f"Moment fort à {clock(start)}",
                    "reason": why(signals, start, end), "origin": "signals"})
    return sorted(out, key=lambda c: -c["score"])[:30]


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    price_in, price_out = PRICES.get(model, PRICES["claude-opus-5-5"])
    return (input_tokens * price_in + output_tokens * price_out) / 1e6


def estimate_cost(duration: float, model: str) -> float:
    """Coût approximatif d'une analyse Claude, avant de la lancer. Même formule que web/lib/cost.ts.

    Environ 260 tokens de transcript par minute de vidéo parlée, 500 de consigne et 3 000 de réponse
    (réflexion comprise) par tranche.
    """
    parts = max(1, -(-duration // (SLICE_MINUTES * 60)))
    return cost_usd(model, round(duration / 60 * 260 + parts * 500), round(parts * 3000))


def cli_answer(stdout: str) -> tuple[dict | None, int, int, str | None]:
    """Lit la sortie JSON de `claude -p` : (réponse structurée ou None, tokens entrée, tokens sortie, erreur ou None)."""
    try:
        out = json.loads(stdout)
        usage = out.get("usage") or {}
    except (json.JSONDecodeError, AttributeError):
        return None, 0, 0, "réponse illisible"
    tokens_in = sum(usage.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
    tokens_out = usage.get("output_tokens") or 0
    if out.get("is_error"):
        return None, tokens_in, tokens_out, str(out.get("result") or "erreur sans message")[:300]
    data = out.get("structured_output")
    return (data if isinstance(data, dict) else None), tokens_in, tokens_out, None
