import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectRateLimiter } from "./connectRateLimiter.js";

test("permite até o máximo, bloqueia a partir daí", () => {
  const limiter = new ConnectRateLimiter(3, 60_000);
  const now = 1_000_000;
  assert.equal(limiter.allow("1.2.3.4", now), true);
  assert.equal(limiter.allow("1.2.3.4", now), true);
  assert.equal(limiter.allow("1.2.3.4", now), true);
  assert.equal(limiter.allow("1.2.3.4", now), false, "4ª tentativa na mesma janela deve ser bloqueada");
});

test("chaves (IPs) diferentes têm contadores independentes", () => {
  const limiter = new ConnectRateLimiter(1, 60_000);
  const now = 1_000_000;
  assert.equal(limiter.allow("1.2.3.4", now), true);
  assert.equal(limiter.allow("1.2.3.4", now), false);
  assert.equal(limiter.allow("5.6.7.8", now), true, "IP diferente não deveria ser afetado pelo primeiro");
});

test("janela desliza: tentativa antiga sai da contagem depois de windowMs", () => {
  const limiter = new ConnectRateLimiter(2, 1000);
  assert.equal(limiter.allow("1.2.3.4", 0), true);
  assert.equal(limiter.allow("1.2.3.4", 100), true);
  assert.equal(limiter.allow("1.2.3.4", 200), false, "ainda dentro da janela de 1000ms");
  assert.equal(limiter.allow("1.2.3.4", 1001), true, "a tentativa em t=0 já saiu da janela (1001-0 >= 1000)");
});
