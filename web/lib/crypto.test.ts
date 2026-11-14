// Lancer avec : npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { decrypt, encrypt, hashKey } from "./crypto.ts";

process.env.MASTER_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
process.env.SERVER_SALT = "sel";

const KEY = "sk-ant-clé-de-test";
// Même vecteur que worker/test_worker.py : prouve que TypeScript et Python lisent le même format.
const VECTOR = "BwcHBwcHBwcHBwcHfAGLPQF7+peqXrqt5DTZ78Qv+WvvKYi9oh5JnvRAwU8SvhM=";

test("chiffrement : aller-retour", () => {
  assert.equal(decrypt(encrypt(KEY)), KEY);
});

test("chiffrement : IV aléatoire, deux chiffrés différents", () => {
  assert.notEqual(encrypt(KEY), encrypt(KEY));
});

test("chiffrement : vecteur partagé avec le worker Python", () => {
  assert.equal(encrypt(KEY, Buffer.alloc(12, 7)), VECTOR);
  assert.equal(decrypt(VECTOR), KEY);
});

test("chiffrement : un chiffré modifié est refusé", () => {
  const raw = Buffer.from(VECTOR, "base64");
  raw[20] ^= 1;
  assert.throws(() => decrypt(raw.toString("base64")));
});

test("chiffrement : clé maître invalide refusée", () => {
  process.env.MASTER_KEY = "abcd";
  assert.throws(() => encrypt(KEY), /MASTER_KEY/);
  process.env.MASTER_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
});

test("hash : stable, dépend du sel, ne contient pas la clé", () => {
  const hash = hashKey(KEY);
  assert.equal(hash, "bb103f594f44bb2eb64399ad59199083e4cc55a124f7185861f199cc7d2a2446");
  assert.equal(hashKey(KEY), hash);
  process.env.SERVER_SALT = "autre";
  assert.notEqual(hashKey(KEY), hash);
  process.env.SERVER_SALT = "sel";
});
