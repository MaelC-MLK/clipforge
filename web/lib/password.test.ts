import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./password.ts";

test("mot de passe : le bon est accepté, un autre est refusé", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.ok(await verifyPassword("correct horse battery", hash));
  assert.ok(!(await verifyPassword("correct horse batterie", hash)));
  assert.ok(!(await verifyPassword("", hash)));
});

test("mot de passe : sel aléatoire, le hash ne contient pas le mot de passe", async () => {
  const a = await hashPassword("secret-123");
  assert.notEqual(a, await hashPassword("secret-123"));
  assert.ok(!a.includes("secret-123"));
  assert.match(a, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
});

test("mot de passe : hash absent ou abîmé refusé sans erreur", async () => {
  for (const stored of [null, undefined, "", "scrypt:zz:zz", "md5:abc:def", "n'importe quoi"]) assert.ok(!(await verifyPassword("x", stored)));
});
