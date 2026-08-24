import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderChange, renderChanges } from "../src/diff.ts";
import { ANSI, ESC, stripAnsi } from "./generate.ts";

const lineOf = (rendered: string, sign: string) =>
  rendered
    .split("\n")
    .map(stripAnsi)
    .find((line) => line.startsWith(`  ${sign} `))
    ?.slice(4);

describe("renderChange", () => {
  const change = {
    key: "intro.lede",
    before: "Enter the young persons information",
    after: "Enter the young person’s information below",
  };

  test("names the key", () => {
    assert.equal(renderChange(change).split("\n")[0], "intro.lede");
  });

  test("highlights only the words that differ", () => {
    const rendered = renderChange(change, { color: true });
    const minus = rendered.split("\n")[1];
    assert.match(minus, ANSI);
    assert.equal(minus.includes(`${ESC}[41mEnter`), false);
  });

  test("renders a key present on only one side as a single line", () => {
    const dropped = renderChange({ key: "gone", before: "Removed" });
    assert.equal(lineOf(dropped, "-"), "Removed");
    assert.equal(lineOf(dropped, "+"), undefined);
  });
});

describe("renderChanges", () => {
  test("skips tabs with nothing to show", () => {
    const rendered = renderChanges([
      { title: "en", changes: [] },
      { title: "es", changes: [{ key: "a", before: "x", after: "y" }] },
    ]);
    assert.doesNotMatch(rendered, /en:/);
    assert.match(rendered, /^es: 1 changed/);
  });

  test("is empty when nothing changed anywhere", () => {
    assert.equal(renderChanges([{ title: "en", changes: [] }]), "");
  });
});
