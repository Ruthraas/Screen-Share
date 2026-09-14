import { test } from "node:test";
import assert from "node:assert/strict";
import { Metrics } from "./metrics.js";

test("increment soma, começando de zero implícito", () => {
  const metrics = new Metrics();
  metrics.increment("requests_total");
  metrics.increment("requests_total");
  metrics.increment("requests_total", 3);
  assert.equal(metrics.snapshot().counters.requests_total, 5);
});

test("gauge substitui o valor; incrementGauge/decrementGauge (by negativo) acumulam", () => {
  const metrics = new Metrics();
  metrics.setGauge("ws_connections_active", 10);
  assert.equal(metrics.snapshot().gauges.ws_connections_active, 10);

  metrics.incrementGauge("ws_connections_active");
  metrics.incrementGauge("ws_connections_active", -2);
  assert.equal(metrics.snapshot().gauges.ws_connections_active, 9);
});

test("nomes diferentes (inclusive com labels na própria string) não se misturam", () => {
  const metrics = new Metrics();
  metrics.increment('errors_total{code="rate_limited"}');
  metrics.increment('errors_total{code="internal_error"}', 4);
  const { counters } = metrics.snapshot();
  assert.equal(counters['errors_total{code="rate_limited"}'], 1);
  assert.equal(counters['errors_total{code="internal_error"}'], 4);
});

test("snapshot nunca devolve referência mutável dos mapas internos", () => {
  const metrics = new Metrics();
  metrics.increment("a");
  const first = metrics.snapshot();
  metrics.increment("a");
  assert.equal(first.counters.a, 1, "snapshot anterior não deve mudar depois de um novo increment");
  assert.equal(metrics.snapshot().counters.a, 2);
});
