"""Chiffre et déchiffre les secrets comme web/lib/crypto.ts : base64(iv 12 octets | chiffré | tag 16 octets)."""

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def decrypt(blob: str, master_key_hex: str | None = None) -> str:
    key = bytes.fromhex(master_key_hex or os.environ["MASTER_KEY"])
    raw = base64.b64decode(blob)
    return AESGCM(key).decrypt(raw[:12], raw[12:], None).decode()


def encrypt(plain: str, master_key_hex: str | None = None, iv: bytes | None = None) -> str:
    key = bytes.fromhex(master_key_hex or os.environ["MASTER_KEY"])
    iv = iv or os.urandom(12)
    return base64.b64encode(iv + AESGCM(key).encrypt(iv, plain.encode(), None)).decode()
