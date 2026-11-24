"""Fonctions pures du rendu : recadrage, silences, sous-titres ASS/SRT, commandes FFmpeg. Testées dans test_worker.py."""

from pathlib import Path

OUT_W, OUT_H = 1080, 1920


def even(n: float) -> int:
    """H.264 exige des dimensions paires."""
    return int(n) // 2 * 2


def crop_size(w: int, h: int, out_h: int = OUT_H) -> tuple[int, int]:
    """Plus grande zone au format 1080 x out_h (9:16 par défaut) qui tient dans une image w x h."""
    cw = min(even(w), even(h * OUT_W / out_h))
    ch = min(even(h), even(cw * out_h / OUT_W))
    return cw, ch


def smooth(points: list[tuple[float, float | None]], dead: float = 0.08, cuts: list[float] = ()) -> list[tuple[float, float]]:
    """Stabilise le suivi du visage.

    points : (temps, centre horizontal du visage entre 0 et 1, ou None si aucun visage).
    Le cadre ne bouge que si le visage s'écarte de plus de `dead` : pas de tremblement.
    cuts : changements de plan. Le cadre y saute d'un coup au lieu de glisser d'un plan à l'autre.
    Aucun visage détecté du tout : cadre centré.
    """
    held = next((x for _, x in points if x is not None), 0.5)
    pending = sorted(cuts)
    out = []
    for t, x in points:
        cut = None
        while pending and pending[0] <= t:
            cut = pending.pop(0)
        if cut is not None and x is not None and x != held:
            out += [(max(cut - 0.01, 0), held), (cut, x)]  # deux points collés : un saut net
            held = x
        elif x is not None and abs(x - held) > dead:
            held = x
        out.append((t, held))
    return out


def crop_x_expr(points: list[tuple[float, float]], w: int, cw: int) -> str:
    """Expression FFmpeg de la position x du cadre (pixels) en fonction du temps `t`.

    Interpolation linéaire entre les points ; constante avant le premier et après le dernier.
    """
    px = [(t, round(min(max(cx * w - cw / 2, 0), w - cw))) for t, cx in points]
    # Ne garder que les points où la position change (et celui juste avant, pour la pente).
    keep = [p for i, p in enumerate(px) if i == 0 or i == len(px) - 1 or px[i - 1][1] != p[1] or px[i + 1][1] != p[1]]
    if len({x for _, x in keep}) <= 1:
        return str(keep[0][1]) if keep else str((w - cw) // 2)

    terms = [f"lt(t,{keep[0][0]:g})*{keep[0][1]}"]
    for (t0, x0), (t1, x1) in zip(keep, keep[1:]):
        inside = f"gte(t,{t0:g})*lt(t,{t1:g})"
        terms.append(f"{inside}*{x0}" if x0 == x1 else f"{inside}*({x0}+({x1 - x0})*(t-{t0:g})/{t1 - t0:g})")
    terms.append(f"gte(t,{keep[-1][0]:g})*{keep[-1][1]}")
    return "+".join(terms)


def keep_intervals(words: list[dict], duration: float, max_gap: float = 0.8, pad: float = 0.15) -> list[tuple[float, float]]:
    """Coupe des silences : les parties à garder, c'est-à-dire la parole avec une petite marge.

    Deux mots séparés par moins de `max_gap` restent dans le même morceau.
    """
    if not words:
        return [(0.0, duration)]
    out: list[tuple[float, float]] = []
    for word in words:
        a, b = max(0.0, word["start"] - pad), min(duration, word["end"] + pad)
        if out and a - out[-1][1] <= max_gap:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return [(round(a, 3), round(b, 3)) for a, b in out]


def remap_time(t: float, keep: list[tuple[float, float]]) -> float:
    """Instant `t` de l'extrait d'origine -> instant dans l'extrait une fois les silences coupés."""
    done = 0.0
    for a, b in keep:
        if t < a:
            return done
        if t <= b:
            return done + t - a
        done += b - a
    return done


def remap_words(words: list[dict], keep: list[tuple[float, float]]) -> list[dict]:
    return [{**w, "start": round(remap_time(w["start"], keep), 3), "end": round(remap_time(w["end"], keep), 3)} for w in words]


def select_expr(keep: list[tuple[float, float]]) -> str:
    return "+".join(f"between(t,{a:g},{b:g})" for a, b in keep)


def loud_peaks(levels: list[float], step: float, count: int, min_gap: float = 4.0) -> list[float]:
    """Instants des `count` moments les plus forts (cris, rires), espacés d'au moins `min_gap` secondes.

    levels : volume par tranche de `step` secondes. Un pic doit dépasser nettement le niveau médian.
    """
    if not levels:
        return []
    floor = sorted(levels)[len(levels) // 2] * 1.5
    picked: list[float] = []
    for i in sorted(range(len(levels)), key=lambda i: -levels[i]):
        if len(picked) >= count or levels[i] <= floor:
            break
        if all(abs(i * step - p) >= min_gap for p in picked):
            picked.append(i * step)
    return sorted(picked)


def group_lines(words: list[dict], max_chars: int = 16, max_gap: float = 0.6) -> list[list[dict]]:
    """Regroupe les mots en lignes courtes, coupées aussi aux silences."""
    lines, current = [], []
    for word in words:
        text = word["w"].strip()
        if not text:
            continue
        length = sum(len(x["w"]) + 1 for x in current) + len(text)
        if current and (length > max_chars or word["start"] - current[-1]["end"] > max_gap):
            lines.append(current)
            current = []
        current.append({**word, "w": text})
    if current:
        lines.append(current)
    return lines


DEFAULT_STYLE = {"preset": "karaoke", "font": "Montserrat", "size": 92, "color": "#FFFF00", "outline": 7, "position": "bottom"}
POSITIONS = {"bottom": (2, 520), "middle": (5, 0), "top": (8, 380)}  # (alignement ASS, marge verticale)

STYLE_FORMAT = (
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
    "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
)


def _ass_time(t: float) -> str:
    cs = max(0, round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def _ass_escape(text: str) -> str:
    # Les accolades ouvriraient un bloc de commandes ASS.
    return text.replace("{", "(").replace("}", ")").replace("\n", " ")


def _ass_text(text: str) -> str:
    return _ass_escape(text.upper())


def build_ass(words: list[dict], style: dict | None = None, hook: str = "", watermark: str = "", duration: float = 0,
              hook_full: bool = False) -> str:
    """Tout le texte incrusté : sous-titres, accroche (3 premières secondes, ou tout le clip avec hook_full), filigrane.

    Style « karaoke » : la ligne reste affichée, le mot prononcé prend la couleur choisie.
    Style « big » : un seul mot à la fois, en gros.
    """
    st = {**DEFAULT_STYLE, **(style or {})}
    big = st["preset"] == "big"
    align, margin = POSITIONS[st["position"]]
    font = st["font"]
    rgb = st["color"].lstrip("#")
    highlight = "{\\c&H" + (rgb[4:6] + rgb[2:4] + rgb[0:2]).upper() + "&}"  # l'ASS écrit les couleurs en BGR
    normal = "{\\c&HFFFFFF&}"

    header = "\n".join([
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {OUT_W}", f"PlayResY: {OUT_H}", "WrapStyle: 2", "",
        "[V4+ Styles]", STYLE_FORMAT,
        f"Style: Default,{font},{round(st['size'] * (1.4 if big else 1))},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,"
        f"-1,0,0,0,100,100,0,0,1,{st['outline']},2,{align},60,60,{margin},1",
        # Accroche : texte noir dans un cartouche blanc, en haut.
        f"Style: Hook,{font},84,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,18,0,8,80,80,200,1",
        # Filigrane : petit, à moitié transparent, en haut à droite.
        f"Style: Mark,{font},40,&H80FFFFFF,&H80FFFFFF,&H80000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,9,40,40,60,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", "",
    ])

    events = []
    if watermark.strip():
        events.append(f"Dialogue: 0,{_ass_time(0)},{_ass_time(duration)},Mark,,0,0,0,,{_ass_escape(watermark.strip())}")
    if hook.strip():
        # \q0 : retour à la ligne automatique, seulement pour l'accroche.
        end = duration if hook_full and duration else min(3, duration) if duration else 3
        events.append(f"Dialogue: 2,{_ass_time(0)},{_ass_time(end)},Hook,,0,0,0,,{{\\q0\\fad(150,300)}}{_ass_escape(hook.strip())}")
    for line in group_lines(words):
        for i, word in enumerate(line):
            end = line[i + 1]["start"] if i + 1 < len(line) else word["end"]
            if big:
                text = highlight + _ass_text(word["w"])
            else:
                text = " ".join(f"{highlight}{_ass_text(w['w'])}{normal}" if j == i else _ass_text(w["w"]) for j, w in enumerate(line))
            events.append(f"Dialogue: 1,{_ass_time(word['start'])},{_ass_time(end)},Default,,0,0,0,,{text}")
    return header + "\n".join(events) + "\n"


def _srt_time(t: float) -> str:
    ms = max(0, round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def build_srt(words: list[dict]) -> str:
    blocks = []
    for n, line in enumerate(group_lines(words, max_chars=38), 1):
        text = " ".join(w["w"] for w in line)
        blocks.append(f"{n}\n{_srt_time(line[0]['start'])} --> {_srt_time(line[-1]['end'])}\n{text}\n")
    return "\n".join(blocks)


def speech_segments(words: list[dict], max_gap: float = 0.6, max_words: int = 14) -> list[tuple[float, str]]:
    """Phrases à faire dire par la voix de synthèse : (instant de début, texte), coupées aux silences."""
    segments, current = [], []
    for word in words:
        if current and (word["start"] - current[-1]["end"] > max_gap or len(current) >= max_words):
            segments.append(current)
            current = []
        current.append(word)
    if current:
        segments.append(current)
    return [(s[0]["start"], " ".join(w["w"] for w in s)) for s in segments]


def voice_cmd(parts: list[tuple[str, float, float]], duration: float, dst: str) -> list[str]:
    """Assemble la piste voix. parts : (fichier wav, instant de début, durée du wav / place disponible)."""
    cmd, chains = ["ffmpeg", "-y", "-loglevel", "error"], []
    for i, (wav, start, ratio) in enumerate(parts):
        cmd += ["-i", wav]
        # Phrase plus longue que sa place : accélérée (x2 au plus), jamais ralentie.
        chains.append(f"[{i}:a]atempo={min(max(ratio, 1), 2):.3f},adelay={round(start * 1000)}:all=1[s{i}]")
    mix = "".join(f"[s{i}]" for i in range(len(parts))) + f"amix=inputs={len(parts)}:normalize=0,apad[a]"
    return cmd + ["-filter_complex", ";".join(chains + [mix]), "-map", "[a]", "-t", f"{duration:.3f}", "-ar", "48000", dst]


def render_cmd(
    src: Path, dst: Path, start: float, duration: float, size: tuple[int, int], fps: str, edit: dict,
    points: list[tuple[float, float]], *, ass: str | None = None, keep: list[tuple[float, float]] | None = None,
    zooms: list[float] = (), voice: str | None = None, music: str | None = None, stack: str | None = None,
    stack_start: float = 0, source_audio: bool = True, audio: str | None = None,
) -> list[str]:
    """Rendu final 1080x1920 H.264/AAC.

    points : centre horizontal du cadre principal au fil du temps (suivi du visage, images clés ou centre).
    ass, voice : noms de fichiers relatifs au dossier d'exécution. voice remplace le son d'origine.
    keep : parties gardées quand on coupe les silences. zooms : instants des zooms.
    stack : vidéo secondaire empilée avec la principale, lue à partir de stack_start. music : fond sonore, baissé quand ça parle.
    audio : son qui remplace celui de la source, calé sur le début du clip (voix isolée).
    """
    w, h = size
    out = sum(b - a for a, b in keep) if keep else duration
    split = edit.get("crop") == "split"
    top_h = even(OUT_H * edit.get("ratio", 0.4))
    if split:
        main_h = OUT_H - top_h  # facecam en haut, jeu en bas
    elif stack:
        main_h = top_h if edit.get("stackPosition") == "bottom" else OUT_H - top_h
    else:
        main_h = OUT_H
    cw, ch = crop_size(w, h, main_h)
    x = crop_x_expr([(0.0, 0.5)] if split else points, w, cw)
    main = f"crop={cw}:{ch}:'{x}':{(h - ch) // 2},scale={OUT_W}:{main_h},setsar=1"

    def fill(height: int) -> str:
        """Remplit 1080 x height sans déformer."""
        return f"scale={OUT_W}:{height}:force_original_aspect_ratio=increase,crop={OUT_W}:{height},setsar=1"

    inputs: list[str] = []
    n = 1  # numéro de la prochaine entrée FFmpeg (0 = la source)
    hidden = []
    zone = edit.get("hide") or {}
    if zone.get("on"):
        hw, hh = max(2, even(zone["w"] * w)), max(2, even(zone["h"] * h))
        hx, hy = min(int(zone["x"] * w), w - hw), min(int(zone["y"] * h), h - hh)
        hidden = ["[0:v]split[h0][h1]", f"[h1]crop={hw}:{hh}:{hx}:{hy},gblur=sigma=30:steps=2[hb]", f"[h0][hb]overlay={hx}:{hy}[src]"]
    if split:
        f = edit.get("facecam") or {"x": 0, "y": 0, "w": 0.3, "h": 0.3}
        fw, fh = max(2, even(f["w"] * w)), max(2, even(f["h"] * h))
        fx, fy = min(int(f["x"] * w), w - fw), min(int(f["y"] * h), h - fh)
        graph = ["[0:v]split[m0][c0]", f"[m0]{main}[main]", f"[c0]crop={fw}:{fh}:{fx}:{fy},{fill(top_h)}[cam]", "[cam][main]vstack[lay]"]
    elif stack:
        inputs += ["-stream_loop", "-1", *(["-ss", f"{stack_start:.2f}"] if stack_start > 0 else []), "-i", stack]  # plus courte que le clip : elle boucle
        order = "[main][sec]" if edit.get("stackPosition") == "bottom" else "[sec][main]"
        graph = [f"[0:v]{main}[main]", f"[{n}:v]{fill(OUT_H - main_h)},fps={fps}[sec]", f"{order}vstack=shortest=1[lay]"]
        n += 1
    else:
        graph = [f"[0:v]{main}[lay]"]
    if hidden:
        graph = hidden + [g.replace("[0:v]", "[src]", 1) for g in graph]

    chain = []
    if zooms:
        z = "+".join(f"between(it,{t:g},{t + 0.6:g})" for t in zooms)
        chain.append(f"zoompan=z='1+0.15*({z})':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={OUT_W}x{OUT_H}:fps={fps}")
    if keep:
        chain.append(f"select='{select_expr(keep)}',setpts=N/({fps})/TB")
    if ass:
        chain.append(f"ass={ass}")  # après la coupe : les sous-titres sont déjà recalés
    if edit.get("progressBar"):
        graph += [
            f"[lay]{','.join(chain) or 'null'}[pre]",
            f"color=c=0xFFD400:s={OUT_W}x16:r={fps}:d={out:.3f}[bar]",
            f"[pre][bar]overlay=x='-W+W*t/{out:.3f}':y=H-16[v]",
        ]
    else:
        graph.append(f"[lay]{','.join(chain) or 'null'}[v]")

    base = None
    if voice:
        inputs += ["-i", voice]
        base = f"[{n}:a]anull"
        n += 1
    elif audio or source_audio:
        track = "[0:a]"
        if audio:
            inputs += ["-i", audio]
            track = f"[{n}:a]"
            n += 1
        base = track + (f"aselect='{select_expr(keep)}',asetpts=N/SR/TB" if keep else "anull")
        if edit.get("denoise"):
            base += ",highpass=f=80,afftdn=nf=-25"  # bruit de fond (souffle, ventilateur) atténué
    sound = []
    if music:
        inputs += ["-stream_loop", "-1", "-i", music]  # musique plus courte que le clip : elle boucle
        m = f"[{n}:a]volume={edit.get('musicVolume', 30) / 100:g}"
        if edit.get("musicFade"):
            m += f",afade=t=in:d=1,afade=t=out:st={max(out - 2, 0):.3f}:d=2"
        sound = [f"{m}[mix]"] if base is None else [
            f"{base},asplit[b1][b2]", f"{m}[m]",
            "[m][b2]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=500[d]",
            "[b1][d]amix=inputs=2:duration=first:normalize=0[mix]",
        ]
    elif base:
        sound = [f"{base}[mix]"]
    if sound:
        sound.append("[mix]" + ("loudnorm=I=-14:TP=-1.5:LRA=11" if edit.get("loudnorm") else "anull") + "[a]")

    return [
        "ffmpeg", "-y",
        "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(src),  # -ss avant -i : le clip repart de t=0
        *inputs,
        "-filter_complex", ";".join(graph + sound),
        "-map", "[v]", *(["-map", "[a]", "-c:a", "aac", "-b:a", "160k", "-ar", "48000"] if sound else ["-an"]),
        "-t", f"{out:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats", "-loglevel", "error",
        str(dst),
    ]


def thumb_cmd(video: str, dst: str, at: float) -> list[str]:
    """Miniature : une image du clip rendu."""
    return ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{at:.3f}", "-i", video, "-frames:v", "1", "-q:v", "3", dst]
