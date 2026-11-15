"""Lancer avec : docker compose run --rm --no-deps worker python -m unittest -v"""

import unittest
from pathlib import Path

from crypto import decrypt
from detect import (bucket_mean, build_candidates, clean_moments, combine, cost_usd, estimate_cost, format_slice,
                    mean_score, normalize, pick_moments, slices, spread, why)
from render import (build_ass, build_srt, crop_size, crop_x_expr, group_lines, keep_intervals, loud_peaks, remap_time,
                    remap_words, render_cmd, select_expr, smooth, speech_segments, voice_cmd)
from worker import Fatal, check_duration, proxy_cmd

MASTER_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
# Même vecteur que web/lib/crypto.test.ts.
VECTOR = "BwcHBwcHBwcHBwcHfAGLPQF7+peqXrqt5DTZ78Qv+WvvKYi9oh5JnvRAwU8SvhM="

WORDS = [
    {"w": "Salut", "start": 0.0, "end": 0.4},
    {"w": "tout", "start": 0.45, "end": 0.7},
    {"w": "le", "start": 0.7, "end": 0.8},
    {"w": "monde", "start": 0.8, "end": 1.3},
    {"w": "{bienvenue}", "start": 3.0, "end": 3.6},  # après un silence
]


class CryptoTest(unittest.TestCase):
    def test_dechiffre_le_vecteur_ecrit_par_le_web(self):
        self.assertEqual(decrypt(VECTOR, MASTER_KEY), "sk-ant-clé-de-test")

    def test_refuse_un_chiffre_modifie(self):
        with self.assertRaises(Exception):
            decrypt("C" + VECTOR[1:], MASTER_KEY)


class IngestTest(unittest.TestCase):
    def test_commande_apercu(self):
        cmd = proxy_cmd(Path("/data/u/source.mp4"), Path("/data/u/proxy.mp4"))
        self.assertEqual(cmd[:4], ["ffmpeg", "-y", "-i", str(Path("/data/u/source.mp4"))])
        self.assertEqual(cmd[-1], str(Path("/data/u/proxy.mp4")))
        self.assertEqual(cmd[cmd.index("-vf") + 1], "scale=-2:480")  # largeur paire, exigée par H.264
        self.assertEqual(cmd[cmd.index("-progress") + 1], "pipe:1")

    def test_duree_maximale(self):
        check_duration(3600)
        with self.assertRaises(Fatal):
            check_duration(9 * 3600)


class CropTest(unittest.TestCase):
    def test_taille_du_cadre(self):
        self.assertEqual(crop_size(1920, 1080), (606, 1076))  # horizontal : toute la hauteur
        self.assertEqual(crop_size(1080, 1920), (1080, 1920))  # déjà vertical : rien à couper
        self.assertEqual(crop_size(1000, 1000), (562, 998))
        for w, h in [crop_size(1920, 1080), crop_size(1280, 720), crop_size(853, 480)]:
            self.assertEqual((w % 2, h % 2), (0, 0))

    def test_cadre_fixe(self):
        self.assertEqual(crop_x_expr([(0.0, 0.5)], 1920, 606), "657")
        self.assertEqual(crop_x_expr([(0, 0.5), (1, 0.5), (2, 0.5)], 1920, 606), "657")

    def test_cadre_reste_dans_l_image(self):
        self.assertEqual(crop_x_expr([(0.0, 0.0)], 1920, 606), "0")
        self.assertEqual(crop_x_expr([(0.0, 1.0)], 1920, 606), str(1920 - 606))

    def test_cadre_mobile(self):
        expr = crop_x_expr([(0, 0.25), (1, 0.25), (2, 0.75), (3, 0.75)], 1920, 606)
        self.assertEqual(expr, "lt(t,0)*177+gte(t,0)*lt(t,1)*177+gte(t,1)*lt(t,2)*(177+(960)*(t-1)/1)+gte(t,2)*lt(t,3)*1137+gte(t,3)*1137")
        # Vérifie l'expression en l'évaluant comme le ferait FFmpeg.
        fns = {"lt": lambda a, b: a < b, "gte": lambda a, b: a >= b}
        value = lambda t: eval(expr, {**fns, "t": t})
        self.assertEqual([value(t) for t in (-1, 0, 0.5, 1, 1.5, 2, 2.5, 3, 99)], [177, 177, 177, 177, 657, 1137, 1137, 1137, 1137])

    def test_lissage(self):
        # Petits écarts ignorés, visage perdu = on garde la dernière position, vrai déplacement suivi.
        points = [(0, 0.30), (1, 0.33), (2, None), (3, 0.28), (4, 0.70), (5, 0.72)]
        self.assertEqual([x for _, x in smooth(points)], [0.30, 0.30, 0.30, 0.30, 0.70, 0.70])
        self.assertEqual(smooth([(0, None), (1, None)]), [(0, 0.5), (1, 0.5)])  # aucun visage : centré


class SubtitlesTest(unittest.TestCase):
    def test_lignes(self):
        lines = [[w["w"] for w in line] for line in group_lines(WORDS)]
        self.assertEqual(lines, [["Salut", "tout", "le"], ["monde"], ["{bienvenue}"]])

    def test_ass_karaoke(self):
        ass = build_ass(WORDS)
        events = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
        self.assertEqual(len(events), len(WORDS))  # un événement par mot
        self.assertEqual(events[0], r"Dialogue: 1,0:00:00.00,0:00:00.45,Default,,0,0,0,,{\c&H00FFFF&}SALUT{\c&HFFFFFF&} TOUT LE")
        self.assertEqual(events[1], r"Dialogue: 1,0:00:00.45,0:00:00.70,Default,,0,0,0,,SALUT {\c&H00FFFF&}TOUT{\c&HFFFFFF&} LE")
        self.assertIn("(BIENVENUE)", events[-1])  # accolades neutralisées
        self.assertIn("PlayResX: 1080", ass)

    def test_srt(self):
        self.assertEqual(
            build_srt(WORDS),
            "1\n00:00:00,000 --> 00:00:01,300\nSalut tout le monde\n\n2\n00:00:03,000 --> 00:00:03,600\n{bienvenue}\n",
        )

    def test_sans_mots(self):
        self.assertEqual(build_srt([]), "")
        self.assertNotIn("Dialogue:", build_ass([]))


def cmd_for(edit=None, points=((0.0, 0.5),), **options):
    return render_cmd(Path("/data/s.mp4"), Path("/data/c.mp4"), 12.5, 30, (1920, 1080), "30", edit or {}, list(points), **options)


def graph_of(cmd):
    return cmd[cmd.index("-filter_complex") + 1].split(";")


class RenderTest(unittest.TestCase):
    def test_commande_de_rendu(self):
        cmd = cmd_for(ass="subs.ass")
        self.assertLess(cmd.index("-ss"), cmd.index("-i"))  # découpe avant décodage : le clip repart de zéro
        self.assertEqual(cmd[cmd.index("-ss") + 1], "12.500")
        self.assertEqual(cmd[cmd.index("-t") + 1], "30.000")
        self.assertEqual(graph_of(cmd), ["[0:v]crop=606:1076:'657':2,scale=1080:1920,setsar=1[lay]", "[lay]ass=subs.ass[v]", "[0:a]anull[mix]", "[mix]anull[a]"])
        self.assertEqual(cmd[cmd.index("-c:v") + 1], "libx264")
        self.assertEqual(cmd[cmd.index("-c:a") + 1], "aac")
        self.assertEqual(cmd[-1], str(Path("/data/c.mp4")))

    def test_source_muette(self):
        cmd = cmd_for(source_audio=False)
        self.assertIn("-an", cmd)
        self.assertEqual(graph_of(cmd), ["[0:v]crop=606:1076:'657':2,scale=1080:1920,setsar=1[lay]", "[lay]null[v]"])

    def test_voix_de_synthese_remplace_le_son(self):
        self.assertIn("[1:a]anull[mix]", graph_of(cmd_for(voice="voice.wav")))

    def test_musique_baissee_sous_la_voix(self):
        cmd = cmd_for({"musicVolume": 50, "musicFade": True}, music="/m/x.mp3")
        graph = graph_of(cmd)
        self.assertIn("[0:a]anull,asplit[b1][b2]", graph)  # son d'origine gardé
        self.assertIn("[1:a]volume=0.5,afade=t=in:d=1,afade=t=out:st=28.000:d=2[m]", graph)
        self.assertTrue(any(g.startswith("[m][b2]sidechaincompress") for g in graph))
        self.assertEqual(cmd[cmd.index("/m/x.mp3") - 3:cmd.index("/m/x.mp3")], ["-stream_loop", "-1", "-i"])
        # Avec la voix de synthèse : elle devient la base, la musique passe en troisième entrée.
        graph = graph_of(cmd_for(voice="voice.wav", music="/m/x.mp3"))
        self.assertIn("[1:a]anull,asplit[b1][b2]", graph)
        self.assertIn("[2:a]volume=0.3[m]", graph)
        # Source muette : la musique seule.
        self.assertIn("[1:a]volume=0.3[mix]", graph_of(cmd_for(music="/m/x.mp3", source_audio=False)))

    def test_normalisation_du_volume(self):
        self.assertEqual(graph_of(cmd_for({"loudnorm": True}))[-1], "[mix]loudnorm=I=-14:TP=-1.5:LRA=11[a]")

    def test_cadrage_manuel(self):
        graph = graph_of(cmd_for({"crop": "manual"}, points=[(0, 0.25), (2, 0.75)]))
        self.assertIn("gte(t,0)*lt(t,2)*(177+(960)*(t-0)/2)", graph[0])

    def test_split_facecam_en_haut(self):
        edit = {"crop": "split", "ratio": 0.4, "facecam": {"x": 0.75, "y": 0.0, "w": 0.25, "h": 0.25}}
        graph = graph_of(cmd_for(edit, points=[(0, 0.1)]))  # les points sont ignorés : le jeu est centré
        self.assertEqual(graph[:4], [
            "[0:v]split[m0][c0]",
            "[m0]crop=1012:1078:'454':1,scale=1080:1152,setsar=1[main]",
            "[c0]crop=480:270:1440:0,scale=1080:768:force_original_aspect_ratio=increase,crop=1080:768,setsar=1[cam]",
            "[cam][main]vstack[lay]",
        ])

    def test_video_secondaire_empilee(self):
        cmd = cmd_for({"stackPosition": "bottom", "ratio": 0.5}, stack="/data/jeu.mp4", music="/m/x.mp3")
        graph = graph_of(cmd)
        self.assertEqual(graph[0], "[0:v]crop=1214:1078:'353':1,scale=1080:960,setsar=1[main]")
        self.assertEqual(graph[1], "[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,fps=30[sec]")
        self.assertEqual(graph[2], "[main][sec]vstack=shortest=1[lay]")
        self.assertTrue(graph[0].endswith("scale=1080:960,setsar=1[main]"))
        self.assertIn("[2:a]volume=0.3[m]", graph)  # la musique vient après la vidéo secondaire
        self.assertEqual(graph_of(cmd_for({"stackPosition": "top"}, stack="/x.mp4"))[2], "[sec][main]vstack=shortest=1[lay]")

    def test_silences_zoom_et_barre(self):
        keep = [(0.0, 4.0), (10.0, 16.0)]
        cmd = cmd_for({"progressBar": True}, ass="subs.ass", keep=keep, zooms=[2.0])
        graph = graph_of(cmd)
        self.assertEqual(
            graph[1],
            "[lay]zoompan=z='1+0.15*(between(it,2,2.6))':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=30,"
            "select='between(t,0,4)+between(t,10,16)',setpts=N/(30)/TB,ass=subs.ass[pre]",
        )
        self.assertEqual(graph[2], "color=c=0xFFD400:s=1080x16:r=30:d=10.000[bar]")  # durée après coupe
        self.assertEqual(graph[3], "[pre][bar]overlay=x='-W+W*t/10.000':y=H-16[v]")
        self.assertIn("[0:a]aselect='between(t,0,4)+between(t,10,16)',asetpts=N/SR/TB[mix]", graph)
        self.assertEqual(cmd[len(cmd) - 1 - cmd[::-1].index("-t") + 1], "10.000")  # la sortie dure le temps gardé


class SilenceTest(unittest.TestCase):
    def test_parties_gardees(self):
        self.assertEqual(keep_intervals(WORDS, 5), [(0.0, 1.45), (2.85, 3.75)])
        self.assertEqual(keep_intervals([], 5), [(0.0, 5)])
        # Une courte pause ne coupe pas ; les marges ne sortent pas du clip.
        words = [{"w": "a", "start": 0.05, "end": 1}, {"w": "b", "start": 1.9, "end": 4.95}]
        self.assertEqual(keep_intervals(words, 5), [(0.0, 5)])

    def test_recalage_des_mots(self):
        keep = [(0.0, 1.45), (2.85, 3.75)]
        self.assertEqual([round(remap_time(t, keep), 3) for t in (0.5, 1.45, 2.0, 2.85, 3.0, 9)], [0.5, 1.45, 1.45, 1.45, 1.6, 2.35])
        moved = remap_words(WORDS, keep)
        self.assertEqual((moved[-1]["start"], moved[-1]["end"]), (1.6, 2.2))
        self.assertEqual(moved[0], WORDS[0])  # avant la première coupe : inchangé
        self.assertEqual(select_expr(keep), "between(t,0,1.45)+between(t,2.85,3.75)")

    def test_pics_sonores(self):
        levels = [0.1] * 40
        levels[8], levels[9], levels[30] = 0.9, 0.8, 0.5  # 2 s (et son voisin), 7,5 s
        self.assertEqual(loud_peaks(levels, 0.25, 3), [2.0, 7.5])  # le voisin trop proche est ignoré
        self.assertEqual(loud_peaks(levels, 0.25, 1), [2.0])
        self.assertEqual(loud_peaks([0.1] * 40, 0.25, 3), [])  # volume plat : aucun pic
        self.assertEqual(loud_peaks([], 0.25, 3), [])


class OverlayTextTest(unittest.TestCase):
    def test_style_des_sous_titres(self):
        ass = build_ass(WORDS, {"preset": "big", "font": "Lato", "size": 100, "color": "#FF8800", "outline": 3, "position": "top"})
        self.assertIn("Style: Default,Lato,140,", ass)  # gros texte : taille x1,4
        self.assertIn(",1,3,2,8,60,60,380,1", ass)  # contour 3, aligné en haut
        events = [line for line in ass.splitlines() if line.startswith("Dialogue: 1")]
        self.assertEqual(events[0], r"Dialogue: 1,0:00:00.00,0:00:00.45,Default,,0,0,0,,{\c&H0088FF&}SALUT")  # un mot, couleur en BGR

    def test_accroche_et_filigrane(self):
        ass = build_ass([], None, "Regarde {ça}", " @chaine ", 20)
        self.assertIn(r"Dialogue: 2,0:00:00.00,0:00:03.00,Hook,,0,0,0,,{\q0\fad(150,300)}Regarde (ça)", ass)
        self.assertIn("Dialogue: 0,0:00:00.00,0:00:20.00,Mark,,0,0,0,,@chaine", ass)
        self.assertNotIn("Hook,,", build_ass(WORDS, None, "  ", "", 20))


class VoiceTest(unittest.TestCase):
    def test_phrases_coupees_aux_silences(self):
        self.assertEqual(speech_segments(WORDS), [(0.0, "Salut tout le monde"), (3.0, "{bienvenue}")])
        self.assertEqual(speech_segments([]), [])

    def test_assemblage_de_la_voix(self):
        cmd = voice_cmd([("tts0.wav", 0.0, 0.5), ("tts1.wav", 3.0, 1.5), ("tts2.wav", 5.0, 9)], 12, "voice.wav")
        self.assertEqual(
            cmd[cmd.index("-filter_complex") + 1],
            "[0:a]atempo=1.000,adelay=0:all=1[s0];"  # tient dans sa place : vitesse normale
            "[1:a]atempo=1.500,adelay=3000:all=1[s1];"  # trop longue : accélérée
            "[2:a]atempo=2.000,adelay=5000:all=1[s2];"  # accélération plafonnée
            "[s0][s1][s2]amix=inputs=3:normalize=0,apad[a]",
        )
        self.assertEqual(cmd[cmd.index("-t") + 1], "12.000")


class DetectTest(unittest.TestCase):
    def test_cases_de_dix_secondes(self):
        self.assertEqual(bucket_mean([1.0] * 10 + [3.0] * 5), [1.0, 3.0])  # dernière case incomplète : moyenne de ce qui existe
        # Un intervalle touche toutes les cases qu'il recouvre ; la plus forte valeur gagne.
        self.assertEqual(spread([(5, 25, 0.5), (20, 30, 0.9), (95, 200, 1)], 4), [0.5, 0.5, 0.9, 0.0])
        self.assertEqual(spread([(10, 10, 1)], 3), [0.0, 1, 0.0])  # intervalle de durée nulle

    def test_normalisation(self):
        self.assertEqual(normalize([2, 2, 2, 4, 6]), [0, 0, 0, 0.5, 1])  # 0 = niveau habituel, 1 = maximum
        self.assertEqual(normalize([3, 3, 3]), [0, 0, 0])  # signal plat
        self.assertEqual(normalize([]), [])

    def test_score_combine(self):
        # Un seul signal : il porte tout le score.
        self.assertEqual(combine({"audio": [0, 0.5, 1]}), [0, 50, 100])
        # Deux signaux : moyenne pondérée (heatmap 0,35, audio 0,2), poids ramenés à 1.
        self.assertEqual(combine({"audio": [1, 0], "heatmap": [0, 1]}), [36, 64])
        # Signal vide ou inconnu ignoré ; signaux de longueurs différentes complétés par 0.
        self.assertEqual(combine({"audio": [1, 1], "heatmap": [], "inconnu": [1, 1]}), [100, 100])
        self.assertEqual(combine({"audio": [1], "heatmap": [1, 1]}), [100, 64])
        self.assertEqual(combine({}), [])

    def test_choix_des_pics(self):
        scores = [0] * 60
        scores[10], scores[11], scores[40] = 90, 80, 50  # 100 s, son voisin, 400 s
        self.assertEqual(pick_moments(scores, 5), [(80.0, 120.0, 90), (380.0, 420.0, 50)])  # voisin trop proche ignoré, zéros ignorés
        self.assertEqual(pick_moments(scores, 1), [(80.0, 120.0, 90)])
        self.assertEqual(pick_moments([70, 0], 3), [(0.0, 20.0, 70)])  # bornes dans la vidéo
        # L'écart se mesure entre les pics, pas entre les débuts de clips ramenés à zéro.
        self.assertEqual([m[2] for m in pick_moments([70, 0, 0, 0, 0, 0, 60], 3)], [70, 60])
        self.assertEqual(mean_score(scores, 100, 120), 85)

    def test_raison_d_un_pic(self):
        signals = {"audio": [0.9, 0.1], "heatmap": [0.5, 0.0], "clips": [0.1, 0.1]}
        self.assertEqual(why(signals, 0, 10), "Pic sonore, très rejoué sur youtube".capitalize())
        self.assertEqual(why(signals, 10, 20), "Moment au-dessus de la moyenne")

    def test_tranches_du_transcript(self):
        transcript = [(0, "a"), (1499, "b"), (1500, "c"), (4000, "d")]
        self.assertEqual(slices(transcript), [[(0, "a"), (1499, "b")], [(1500, "c")], [(4000, "d")]])  # 25 min, tranches vides sautées
        self.assertEqual(format_slice([(12.4, "Salut"), (75, "ça va")]), "[12] Salut\n[75] ça va")

    def test_moments_de_claude_valides(self):
        raw = [
            {"start": 100, "end": 160, "score": 150, "title": " Le clash ", "reason": "Ça monte vite."},
            {"start": 90, "end": 95, "score": 50, "title": "trop court", "reason": ""},
            {"start": 200, "end": 900, "score": 40, "title": "", "reason": "x"},  # trop long, sans titre
            {"start": "n'importe quoi", "end": 5, "score": 1},
            {"start": 0, "end": 3000, "score": 10, "title": "hors tranche", "reason": ""},
        ]
        self.assertEqual(clean_moments(raw, 50, 1000), [
            {"start": 100.0, "end": 160.0, "score": 100, "title": "Le clash", "reason": "Ça monte vite."},
            {"start": 200.0, "end": 380.0, "score": 40, "title": "Moment à 0:03:20", "reason": "x"},
            {"start": 50.0, "end": 230.0, "score": 10, "title": "hors tranche", "reason": ""},
        ])

    def test_candidats(self):
        scores = [0] * 120  # 20 minutes
        scores[10], scores[60] = 80, 60
        signals = {"audio": [0.0] * 120}
        signals["audio"][10] = signals["audio"][60] = 1.0
        moments = [{"start": 590.0, "end": 630.0, "score": 90, "title": "Blague", "reason": "Chute nette."}]
        out = build_candidates(scores, signals, moments, 1200)
        # Le pic à 600 s recoupe le moment de Claude : il n'est pas proposé deux fois.
        self.assertEqual([(c["origin"], c["start"], c["title"]) for c in out], [("signals", 80.0, "Moment fort à 0:01:20"), ("claude", 590.0, "Blague")])
        self.assertEqual(out[0]["reason"], "Pic sonore")
        self.assertEqual(out[1]["score"], round((90 + 60 / 4) / 2))  # moyenne entre l'avis de Claude et les signaux
        self.assertEqual(build_candidates([], {}, [], 0), [])
        # Un moment de Claude qui couvre les meilleures cases ne prend pas la place des autres pics.
        wide = build_candidates([70, 53, 53, 53, 13, 33, 0], {"audio": [0, 0, 0, 0, 0, 1, 0]},
                                [{"start": 5.0, "end": 44.0, "score": 80, "title": "x", "reason": "y"}], 70)
        self.assertEqual([(c["origin"], c["start"]) for c in wide], [("claude", 5.0), ("signals", 30.0)])

    def test_cout_claude(self):
        self.assertAlmostEqual(cost_usd("claude-opus-5-5", 1_000_000, 100_000), 6.0)
        self.assertAlmostEqual(cost_usd("claude-haiku-5-5", 1_000_000, 0), 0.1)
        self.assertAlmostEqual(cost_usd("modele-inconnu", 1_000_000, 0), 4.0)  # prix du modèle par défaut
        # 1 h : 3 tranches de 25 min, 15 600 + 1 500 tokens en entrée, 9 000 en sortie.
        self.assertAlmostEqual(estimate_cost(3600, "claude-opus-5-5"), (17100 * 4 + 9000 * 20) / 1e6)
        self.assertGreater(estimate_cost(1, "claude-opus-5-5"), 0)


if __name__ == "__main__":
    unittest.main()
