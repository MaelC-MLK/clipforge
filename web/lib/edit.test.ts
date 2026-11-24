import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_EDIT, keyframeX, sanitizeEdit, sanitizeWords, splitParts } from "./edit.ts";

test("une entrée vide ou absurde donne des réglages sûrs", () => {
  for (const input of [null, undefined, "x", 42, [], {}]) {
    const e = sanitizeEdit(input);
    assert.equal(e.crop, "face");
    assert.deepEqual(e.subStyle, DEFAULT_EDIT.subStyle);
    assert.equal(e.music, "");
  }
});

test("les valeurs hors bornes sont ramenées dans les bornes", () => {
  const e = sanitizeEdit({
    crop: "pirate",
    ratio: 9,
    musicVolume: -5,
    facecam: { x: 0.9, y: -1, w: 0.5, h: 3 },
    subStyle: { font: "Comic Sans", size: 9999, color: "red; drop table", outline: -3, position: "left", preset: "x" },
    keyframes: [{ t: 5, x: 2 }, { t: 1, x: -1 }, "n'importe quoi"],
    hook: "ligne 1\nligne 2",
    watermark: "x".repeat(500),
  });
  assert.equal(e.crop, "face");
  assert.equal(e.ratio, 0.8);
  assert.equal(e.musicVolume, 0);
  assert.deepEqual(e.facecam, { x: 0.5, y: 0, w: 0.5, h: 1 }); // la zone reste dans l'image
  assert.deepEqual(e.subStyle, { ...DEFAULT_EDIT.subStyle, size: 160, outline: 0 });
  assert.deepEqual(e.keyframes, [{ t: 0, x: 0.5 }, { t: 1, x: 0 }, { t: 5, x: 1 }]); // triées par temps
  assert.equal(e.hook, "ligne 1 ligne 2");
  assert.equal(e.watermark.length, 40);
});

test("les réglages valides sont conservés", () => {
  const input = { ...DEFAULT_EDIT, crop: "split", music: "son.mp3", subStyle: { ...DEFAULT_EDIT.subStyle, color: "#00ff88", font: "Lato" } };
  assert.deepEqual(sanitizeEdit(input), input);
});

test("mots corrigés : bornés au clip, vides retirés, fin jamais avant le début", () => {
  assert.equal(sanitizeWords("x", 10), null);
  assert.deepEqual(
    sanitizeWords([{ w: " b ", start: 4, end: 2 }, { w: "", start: 1, end: 2 }, { w: "a", start: -3, end: 99 }], 10),
    [{ w: "a", start: 0, end: 10 }, { w: "b", start: 4, end: 4 }],
  );
});

test("position du cadre entre deux images clés", () => {
  const k = [{ t: 2, x: 0.2 }, { t: 4, x: 0.8 }];
  assert.equal(keyframeX([], 3), 0.5);
  assert.equal(keyframeX(k, 0), 0.2);
  assert.equal(keyframeX(k, 3), 0.5);
  assert.equal(keyframeX(k, 9), 0.8);
});

test("découpage automatique en parties", () => {
  assert.deepEqual(splitParts(150, 61, 180), [
    { start: 0, end: 61 },
    { start: 61, end: 122 },
    { start: 122, end: 150 },
  ]);
  // Une fin trop courte (5 s) rejoint la partie d'avant.
  assert.deepEqual(splitParts(127, 61, 180), [
    { start: 0, end: 61 },
    { start: 61, end: 127 },
  ]);
  // Sauf si la partie fusionnée dépasserait la durée maximale d'un clip.
  assert.equal(splitParts(185, 180, 180).length, 2);
  assert.deepEqual(splitParts(30, 61, 180), [{ start: 0, end: 30 }]);
  assert.deepEqual(splitParts(0, 61, 180), []);
});
