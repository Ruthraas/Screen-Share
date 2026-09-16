import assert from "node:assert/strict";
import test from "node:test";
import { getSharingActive, setSharingActive, subscribeSharingActive } from "../../src/services/sharingState.ts";

test("starts as not sharing", () => {
  assert.equal(getSharingActive(), false);
});

test("setSharingActive updates the getter and notifies subscribers", () => {
  const seen: boolean[] = [];
  const unsubscribe = subscribeSharingActive(value => seen.push(value));
  try {
    setSharingActive(true);
    assert.equal(getSharingActive(), true);
    setSharingActive(false);
    assert.equal(getSharingActive(), false);
    assert.deepEqual(seen, [true, false]);
  } finally {
    unsubscribe();
  }
});

test("setting the same value again does not notify again", () => {
  setSharingActive(false);
  const seen: boolean[] = [];
  const unsubscribe = subscribeSharingActive(value => seen.push(value));
  try {
    setSharingActive(false);
    assert.deepEqual(seen, []);
  } finally {
    unsubscribe();
  }
});

test("unsubscribe stops further notifications", () => {
  setSharingActive(false);
  const seen: boolean[] = [];
  const unsubscribe = subscribeSharingActive(value => seen.push(value));
  unsubscribe();
  setSharingActive(true);
  setSharingActive(false);
  assert.deepEqual(seen, []);
});
