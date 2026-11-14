"""Déchiffre les secrets écrits par web/lib/crypto.ts : base64(iv 12 octets | chiffré | tag 16 octets)."""

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def decrypt(blob: str, master_key_hex: str | None = None) -> str:
    key = bytes.fromhex(master_key_hex or os.environ["MASTER_KEY"])
    raw = base64.b64decode(blob)
    return AESGCM(key).decrypt(raw[:12], raw[12:], None).decode()
