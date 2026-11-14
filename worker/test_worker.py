"""Lancer avec : docker compose run --rm worker python -m unittest -v"""

import unittest
from pathlib import Path

from crypto import decrypt
from worker import Fatal, check_duration, proxy_cmd

MASTER_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
# Même vecteur que web/lib/crypto.test.ts.
VECTOR = "BwcHBwcHBwcHBwcHfAGLPQF7+peqXrqt5DTZ78Qv+WvvKYi9oh5JnvRAwU8SvhM="


class CryptoTest(unittest.TestCase):
    def test_dechiffre_le_vecteur_ecrit_par_le_web(self):
        self.assertEqual(decrypt(VECTOR, MASTER_KEY), "sk-ant-clé-de-test")

    def test_refuse_un_chiffre_modifie(self):
        with self.assertRaises(Exception):
            decrypt("C" + VECTOR[1:], MASTER_KEY)


class FfmpegTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
