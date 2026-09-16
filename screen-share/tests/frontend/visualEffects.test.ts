import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");
const pixelWave = readFileSync(new URL("../../src/components/layout/PixelWave.tsx", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../../src/components/layout/AppShell.tsx", import.meta.url), "utf8");

test("interactive styles do not use repaint-heavy shadow or filter effects", () => {
  assert.doesNotMatch(styles, /box-shadow\s*:/);
  assert.doesNotMatch(styles, /filter\s*:/);
  assert.doesNotMatch(styles, /drop-shadow\s*\(/);
  assert.doesNotMatch(pixelWave, /filter\s*:/);
  assert.doesNotMatch(pixelWave, /drop-shadow\s*\(/);
});

test("approved visual system does not use gradient backgrounds", () => {
  assert.doesNotMatch(styles, /linear-gradient|radial-gradient|conic-gradient/);
  assert.doesNotMatch(pixelWave, /Gradient/);
});

test("approved visual system does not use circular radius", () => {
  assert.doesNotMatch(styles, /border-radius\s*:\s*(50%|999px)/);
});

test("decorative pixel wave does not react to pointer hover", () => {
  assert.doesNotMatch(styles, /\.pixel-wave:hover/);
  assert.doesNotMatch(pixelWave, /onMouseEnter|onMouseLeave/);
});

test("post-login shell renders the decorative pixel wave", () => {
  assert.match(appShell, /<PixelWave\s*\/>/);
  assert.match(pixelWave, /<pattern id="wave-back"/);
  assert.match(pixelWave, /<pattern id="wave-mid"/);
  assert.match(pixelWave, /<pattern id="wave-front"/);
});

test("light theme uses the approved tokens", () => {
  assert.match(styles, /--wave-back:\s*#E2E2DA/);
  assert.match(styles, /--wave-mid:\s*#CBE0D0/);
  assert.match(styles, /--wave-front:\s*#B9D2BE/);
  assert.match(styles, /--bg:\s*#F5F5F0/);
  assert.match(styles, /--surface:\s*#ECECE6/);
  assert.match(styles, /--surface-alt:\s*#DCEEDF/);
  assert.match(styles, /--border:\s*#D8D8D0/);
  assert.match(styles, /--text-primary:\s*#161812/);
  assert.match(styles, /--text-muted:\s*#6B6F65/);
  assert.match(styles, /--accent:\s*#3E8E52/);
  assert.match(styles, /--gray-block:\s*#C7C9C0/);
});
