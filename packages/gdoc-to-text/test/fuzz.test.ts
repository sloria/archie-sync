import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import gdocToText, { type GoogleDocument } from "../src/index.ts";
import { docWithModel, type Format, GHOST, render } from "./generate.ts";

const GHOST_RE = new RegExp(GHOST);

const config = {
  numRuns: Number(process.env.FUZZ_CASES ?? 200),
  ...(process.env.FUZZ_SEED ? { seed: Number(process.env.FUZZ_SEED) } : {}),
};

const check = (property: fc.IRawProperty<unknown>) =>
  fc.assert(property, config);

describe("fuzz", () => {
  for (const format of ["markdown", "html", "plain"] as Format[]) {
    test(`renders a document's model as ${format}`, () => {
      check(
        fc.property(docWithModel, ({ model, document }) => {
          assert.equal(
            gdocToText(document as GoogleDocument, { format }),
            render(model, format),
          );
        }),
      );
    });
  }

  test("never emits dropped or pending-insertion content", () => {
    check(
      fc.property(docWithModel, ({ document }) => {
        assert.doesNotMatch(gdocToText(document as GoogleDocument), GHOST_RE);
      }),
    );
  });
});

const unknownShape = fc.record(
  {
    textRun: fc.anything(),
    richLink: fc.anything(),
    person: fc.anything(),
    paragraph: fc.anything(),
    bullet: fc.anything(),
    elements: fc.anything(),
    content: fc.anything(),
  },
  { requiredKeys: [] },
);

describe("fuzz: malformed documents", () => {
  test("survives unmodelled element and paragraph shapes", () => {
    check(
      fc.property(
        fc.record(
          { body: fc.record({ content: fc.array(unknownShape) }) },
          { requiredKeys: [] },
        ),
        (document) => {
          assert.equal(typeof gdocToText(document as GoogleDocument), "string");
        },
      ),
    );
  });
});
