import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

function masterKey(): Buffer {
  const key = Buffer.from(env("MASTER_KEY"), "hex");
  if (key.length !== 32) throw new Error("MASTER_KEY doit faire 64 caractères hexadécimaux");
  return key;
}

/** AES-256-GCM. Format : base64(iv 12 octets | chiffré | tag 16 octets), lisible par worker/crypto.py. */
export function encrypt(plain: string, iv: Buffer = randomBytes(12)): string {
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, data, cipher.getAuthTag()]).toString("base64");
}

export function decrypt(blob: string): string {
  const raw = Buffer.from(blob, "base64");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
}
