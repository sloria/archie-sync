import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import { fileStrings, stringify } from "../src/core.ts";
import { renderChange } from "../src/diff.ts";
import { planPull, planPush } from "../src/plan.ts";
import {
  applyRequests,
  check,
  docOf,
  parsedFile,
  stringifiesCleanly,
  strings,
  stripAnsi,
  treeOf,
  value,
} from "./generate.ts";

const representable = strings.filter(stringifiesCleanly);

const fileAndDoc = (
  map: Map<string, string>,
  docStrings: Map<string, string> = map,
) => ({
  document: docOf(docStrings),
  files: [parsedFile("en", `${JSON.stringify(treeOf(map), null, 2)}\n`)],
});

describe("fuzz: planPush", () => {
  test("requests rebuild the tab exactly, whatever it held", () => {
    check(
      fc.property(representable, representable, (git, doc) => {
        const text = stringify(treeOf(doc));
        const input = fileAndDoc(git, doc);
        const [file] = input.files;
        const plan = planPush(input);
        assert.deepEqual(plan.errors, []);
        if (plan.requests.length === 0) {
          assert.deepEqual(plan.changes[0].changes, []);
          return;
        }
        assert.equal(applyRequests(text, plan.requests), stringify(file.tree));
      }),
    );
  });
});

describe("fuzz: planPull", () => {
  test("an identical doc produces the file back byte for byte", () => {
    check(
      fc.property(representable, (map) => {
        const text = `${JSON.stringify(treeOf(map), null, 2)}\n`;
        const plan = planPull({
          document: docOf(map),
          files: [parsedFile("en", text)],
        });
        assert.deepEqual(plan.errors, []);
        assert.equal(plan.writes[0].text, text);
        assert.deepEqual(plan.changes[0].changes, []);
      }),
    );
  });

  test("writes keep every key, in the file's own order and nesting", () => {
    check(
      fc.property(representable, value, (map, replacement) => {
        const [first] = [...map.keys()];
        const edited = new Map(map).set(first, replacement);
        fc.pre(stringifiesCleanly(edited));

        const text = `${JSON.stringify(treeOf(map), null, 2)}\n`;
        const file = parsedFile("en", text);
        const plan = planPull({
          document: docOf(edited),
          files: [file],
        });
        assert.deepEqual(plan.errors, []);

        const written = parsedFile("en", plan.writes[0].text);
        assert.deepEqual(
          [...fileStrings(written).keys()],
          [...fileStrings(file).keys()],
        );
        assert.deepEqual(
          new Map([...fileStrings(written)].sort()),
          new Map([...edited].sort()),
        );
      }),
    );
  });

  test("a key dropped from the tab blocks every write", () => {
    check(
      fc.property(representable, (map) => {
        fc.pre(map.size > 1);
        const short = new Map([...map].slice(1));
        const plan = planPull(fileAndDoc(map, short));
        assert.equal(plan.errors.length > 0, true);
        assert.deepEqual(plan.writes, []);
        assert.deepEqual(plan.changes, []);
      }),
    );
  });
});

describe("fuzz: renderChange", () => {
  const shown = fc.string({ maxLength: 40 });

  test("both lines carry their value verbatim once the color is stripped", () => {
    check(
      fc.property(shown, shown, fc.boolean(), (before, after, color) => {
        const rendered = renderChange({ key: "k", before, after }, { color });
        const [minus, plus] = rendered
          .split("\n")
          .slice(1)
          .map((line) => stripAnsi(line).slice(4));
        assert.equal(minus, before);
        assert.equal(plus, after);
      }),
    );
  });

  test("emits escapes only when asked", () => {
    check(
      fc.property(shown, shown, (before, after) => {
        const plain = renderChange({ key: "k", before, after });
        assert.equal(plain, stripAnsi(plain));
      }),
    );
  });
});
