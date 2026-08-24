import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import {
  fileStrings,
  parseFile,
  parseTab,
  stringify,
  stringifyFile,
  treeErrors,
  validateTab,
} from "../src/core.ts";
import {
  asGdocTab,
  check,
  parsedFile,
  strings,
  treeOf,
  value,
} from "./generate.ts";

describe("fuzz: the doc round-trip", () => {
  test("survives an arbitrarily fragmented tab", () => {
    check(
      fc.property(strings, (map) => {
        let text: string;
        try {
          text = stringify(treeOf(map));
        } catch {
          return; // covered by "either round-trips or throws" below
        }
        assert.deepEqual(parseTab(asGdocTab(text)), treeOf(map));
      }),
    );
  });

  test("structure-looking values survive the escaping", () => {
    check(
      fc.property(strings, value, (map, text) => {
        // ArchieML trims a value's outer whitespace, so a value with edge
        // whitespace is unrepresentable and stringify throws.
        fc.pre(text === text.trim());
        const keyed = treeOf(
          new Map([...map.keys()].map((key) => [key, text])),
        );
        assert.deepEqual(parseTab(asGdocTab(stringify(keyed))), keyed);
      }),
    );
  });

  test("stringify either round-trips or throws, never lies", () => {
    check(
      fc.property(strings, (map) => {
        let text: string;
        try {
          text = stringify(treeOf(map));
        } catch (error) {
          assert.match((error as Error).message, /cannot be represented/);
          return;
        }
        assert.deepEqual(
          parseTab(asGdocTab(text, { fragment: false })),
          treeOf(map),
        );
      }),
    );
  });
});

describe("fuzz: parity", () => {
  test("is empty exactly when the key sets are equal", () => {
    // The tab is derived from the file so that keys-only-in-the-tab is as
    // common as keys-only-in-the-file; two independent maps would almost
    // always differ in the same direction and leave one branch untested.
    const edits = fc.record({
      dropped: fc.nat({ max: 3 }),
      added: fc.array(fc.string({ minLength: 1, maxLength: 6 }), {
        maxLength: 3,
      }),
    });
    check(
      fc.property(strings, edits, (fileStrings, { dropped, added }) => {
        const tabStrings = new Map(fileStrings);
        for (const key of [...tabStrings.keys()].slice(0, dropped))
          tabStrings.delete(key);
        for (const key of added) tabStrings.set(key, "added by hand");

        const equal =
          fileStrings.size === tabStrings.size &&
          [...fileStrings.keys()].every((key) => tabStrings.has(key));
        const errors = validateTab("en", fileStrings, tabStrings);
        assert.equal(errors.length === 0, equal);
      }),
    );
  });

  test("values never affect parity", () => {
    check(
      fc.property(strings, value, (map, replacement) => {
        const edited = new Map([...map].map(([key]) => [key, replacement]));
        assert.deepEqual(validateTab("en", map, edited), []);
      }),
    );
  });
});

describe("fuzz: unsupported shapes", () => {
  const badLeaf = fc.oneof(
    fc.array(fc.string(), { maxLength: 3 }),
    fc.integer(),
    fc.constant(null),
    fc.boolean(),
  );

  test("a non-string leaf anywhere is reported", () => {
    check(
      fc.property(strings, badLeaf, (map, leaf) => {
        const tree = treeOf(map);
        // @ts-expect-error a non-string leaf is exactly what treeErrors must catch
        tree.__bad = leaf;
        assert.equal(treeErrors(tree).length > 0, true);
      }),
    );
  });

  test("a dotted key colliding with nesting is reported", () => {
    check(
      fc.property(strings, (map) => {
        // Only a dotted key can collide: a flat one would simply overwrite.
        const key = [...map.keys()].find((candidate) =>
          candidate.includes("."),
        );
        fc.pre(key !== undefined);
        const tree = treeOf(map);
        assert.deepEqual(treeErrors(tree), []);
        assert.equal(treeErrors({ ...tree, [key]: "collides" }).length, 1);
      }),
    );
  });

  test("parseFile refuses a file it can't represent, with no tree", () => {
    check(
      fc.property(strings, badLeaf, (map, leaf) => {
        const tree = { ...treeOf(map), __bad: leaf };
        const file = parseFile("en", JSON.stringify(tree));
        assert.equal(file.errors.length > 0, true);
        assert.equal("tree" in file, false);
      }),
    );
  });
});

describe("fuzz: writes", () => {
  const indent = fc.constantFrom("  ", "    ", "\t");

  test("rewriting unchanged values reproduces the file byte for byte", () => {
    check(
      fc.property(strings, indent, (map, spacing) => {
        const text = `${JSON.stringify(treeOf(map), null, spacing)}\n`;
        const file = parsedFile("en", text);
        assert.equal(stringifyFile(file, fileStrings(file)), text);
      }),
    );
  });

  test("pulled values land under their own keys, and only there", () => {
    check(
      fc.property(strings, value, (map, replacement) => {
        const file = parsedFile("en", JSON.stringify(treeOf(map), null, 2));
        const [first] = [...map.keys()];
        const pulled = new Map(map).set(first, replacement);
        const rewritten = parsedFile("en", stringifyFile(file, pulled));
        assert.deepEqual(fileStrings(rewritten), pulled);
      }),
    );
  });
});
