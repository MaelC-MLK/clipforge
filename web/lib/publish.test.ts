import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { caption, isProvider } from "./publish.ts";

test("légende : texte puis hashtags normalisés", () => {
  assert.equal(caption({ title: "", description: " Regarde ça ", hashtags: ["#gaming", "clip du jour", "##fun"] }), "Regarde ça\n\n#gaming #clipdujour #fun");
  assert.equal(caption({ title: "", description: "Seul", hashtags: [] }), "Seul");
});

test("réseaux connus", () => {
  assert.ok(isProvider("tiktok"));
  assert.ok(!isProvider("constructor")); // pas de fuite par le prototype
});

test("jeton du lien public : même valeur que worker/test_worker.py", () => {
  // Le calcul de publicToken (lib/oauth.ts), refait ici pour figer la valeur partagée avec le worker.
  assert.equal(createHmac("sha256", "sel").update("publication:abc").digest("hex"), "afac5cf79658b3eed0b8718e713ce385d6618691b1ac950b6fbf07ae62395484");
});
