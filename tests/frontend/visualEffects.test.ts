import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");
const pixelWave = readFileSync(new URL("../../src/components/layout/PixelWave.tsx", import.meta.url), "utf8");

test("interactive styles do not use repaint-heavy shadow or filter effects", () => {
  assert.doesNotMatch(styles, /box-shadow\s*:/);
  assert.doesNotMatch(styles, /filter\s*:/);
  assert.doesNotMatch(styles, /drop-shadow\s*\(/);
  assert.doesNotMatch(pixelWave, /filter\s*:/);
  assert.doesNotMatch(pixelWave, /drop-shadow\s*\(/);
});

test("decorative pixel wave does not react to pointer hover", () => {
  assert.doesNotMatch(styles, /\.pixel-wave:hover/);
  assert.doesNotMatch(pixelWave, /onMouseEnter|onMouseLeave/);
});
