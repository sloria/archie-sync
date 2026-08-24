import fc from "fast-check";
import type { Options } from "../src/index.ts";

// The model types are declared here rather than imported from index.ts so the
// properties keep describing the README's behaviour, not the converter's.
export interface Run {
  content: string;
  url: string | null;
  bold: boolean;
  italic: boolean;
}

export interface Paragraph {
  bullet: boolean;
  nestingLevel: number;
  runs: Run[];
}

export type Format = NonNullable<Options["format"]>;

/** A Docs API element; deliberately looser than what the converter models. */
type DocsElement = Record<string, unknown>;

export const GHOST = "GHOST";

const CONTENT = [
  "a",
  "hi there",
  " leading",
  "trailing ",
  "  ",
  "\t",
  "x\ty",
  "A & B <x>",
  "[bracket]",
  "](evil)",
  'quote"',
  "line\nbreak",
  "café",
  "ada@example.com",
];

const URLS = [
  "https://example.com",
  "https://example.com/?a=1&b=2",
  'https://example.com/"quote',
  "mailto:ada@example.com",
];

const content = fc.oneof(
  { arbitrary: fc.constantFrom(...CONTENT), weight: 4 },
  { arbitrary: fc.string({ maxLength: 6 }), weight: 1 },
);

const url = fc.option(fc.constantFrom(...URLS), { nil: null, freq: 3 });

const flag = fc.constantFrom(false, false, true);

const sameStyle = (a: Run, b: Run) =>
  a.url === b.url && a.bold === b.bold && a.italic === b.italic;

/**
 * Merges adjacent same-style runs and terminates the paragraph with a newline,
 * leaving one run per (text, style) a reader would perceive. Where Docs splits
 * a run is not meaning.
 */
function canonicalize(runs: Run[]): Run[] {
  const canonical: Run[] = [];
  for (const run of runs) {
    if (!run.content) continue;
    const prev = canonical.at(-1);
    if (prev && sameStyle(prev, run)) prev.content += run.content;
    else canonical.push({ ...run });
  }
  // Every Docs paragraph ends with a newline, including an empty one.
  if (canonical.length === 0)
    return [{ content: "\n", url: null, bold: false, italic: false }];
  canonical.at(-1)!.content += "\n";
  return canonical;
}

const runModel = fc.oneof(
  {
    arbitrary: fc.record({ content, url, bold: flag, italic: flag }),
    weight: 6,
  },
  {
    arbitrary: fc.constantFrom(...URLS).map((href) => ({
      content: href,
      url: href,
      bold: false,
      italic: false,
    })),
    weight: 1,
  },
);

const decoration = fc.record({
  bullet: fc.boolean(),
  nestingLevel: fc.nat({ max: 3 }),
});

const paragraphModel = fc.oneof(
  {
    arbitrary: fc
      .tuple(decoration, fc.array(runModel, { minLength: 1, maxLength: 4 }))
      .map(([style, runs]) => ({ ...style, runs: canonicalize(runs) })),
    weight: 8,
  },
  // A paragraph of nothing but an image or a pending insertion renders as
  // nothing at all — its newline and its bullet included.
  { arbitrary: decoration.map((style) => ({ ...style, runs: [] })), weight: 1 },
);

const model = fc.array(paragraphModel, { maxLength: 4 });

const noiseElement: fc.Arbitrary<DocsElement> = fc.constantFrom(
  { textRun: { content: GHOST, suggestedInsertionIds: ["sug.i"] } },
  { textRun: {} },
  { textRun: { content: "" } },
  {
    richLink: {
      richLinkProperties: { title: GHOST, uri: "https://ghost.example" },
      suggestedInsertionIds: ["sug.i"],
    },
  },
  {
    person: {
      personProperties: { name: GHOST, email: "ghost@example.com" },
      suggestedInsertionIds: ["sug.i"],
    },
  },
  { richLink: { richLinkProperties: { title: GHOST } } },
  { person: { personProperties: {} } },
  { inlineObjectElement: { inlineObjectId: "kix.img" } },
  { footnoteReference: { footnoteId: "kix.fn", footnoteNumber: "1" } },
);

const paragraphOf = (text: string) => ({
  paragraph: { elements: [{ textRun: { content: text } }] },
});

const structuralNoise: fc.Arbitrary<DocsElement> = fc.constantFrom(
  { sectionBreak: {} },
  {
    table: { tableRows: [{ tableCells: [{ content: [paragraphOf(GHOST)] }] }] },
  },
  { tableOfContents: { content: [paragraphOf(GHOST)] } },
);

function withNoise<T>(
  items: T[],
  noise: fc.Arbitrary<T>,
  maxPerGap: number,
): fc.Arbitrary<T[]> {
  return fc
    .array(fc.array(noise, { maxLength: maxPerGap }), {
      minLength: items.length + 1,
      maxLength: items.length + 1,
    })
    .map((sprinkled) => {
      const out = [...sprinkled[0]];
      for (const [i, item] of items.entries())
        out.push(item, ...sprinkled[i + 1]);
      return out;
    });
}

function splitPoints(text: string) {
  if (text.length < 2) return fc.constant([]);
  return fc.uniqueArray(fc.integer({ min: 1, max: text.length - 1 }), {
    maxLength: 3,
  });
}

/**
 * Encodes one semantic run as Docs elements — split text runs, a smart chip,
 * a pending deletion. Every encoding it chooses must render identically.
 */
function encodeRun({
  content: text,
  url: href,
  bold,
  italic,
}: Run): fc.Arbitrary<DocsElement[]> {
  const asTextRuns = fc
    .tuple(splitPoints(text), fc.boolean())
    .map(([points, deleted]) => {
      const bounds = [0, ...[...points].sort((a, b) => a - b), text.length];
      const textStyle: {
        link?: { url: string };
        bold?: boolean;
        italic?: boolean;
      } = {};
      if (href) textStyle.link = { url: href };
      if (bold) textStyle.bold = true;
      if (italic) textStyle.italic = true;
      const style = href || bold || italic ? { textStyle } : {};
      const suggestion = deleted ? { suggestedDeletionIds: ["sug.d"] } : {};
      return bounds.slice(1).map((end, i) => ({
        textRun: {
          content: text.slice(bounds[i], end),
          ...style,
          ...suggestion,
        },
      }));
    });
  // Chips are atomic, carry no character styling, and cannot span a line
  // break.
  if (!text || text.includes("\n") || bold || italic) return asTextRuns;
  const chips: DocsElement[] = [];
  if (href) {
    chips.push({
      richLink: { richLinkProperties: { title: text, uri: href } },
    });
    // A titleless rich link shows its URI, so it encodes a run of just that.
    if (text === href)
      chips.push(
        { richLink: { richLinkProperties: { uri: href } } },
        { richLink: { richLinkProperties: { title: "", uri: href } } },
      );
  } else {
    chips.push({ person: { personProperties: { name: text } } });
    if (/^[^\s@]+@[^\s@]+$/.test(text))
      chips.push({ person: { personProperties: { email: text } } });
  }
  return fc.oneof(
    { arbitrary: asTextRuns, weight: 4 },
    { arbitrary: fc.constantFrom(...chips).map((chip) => [chip]), weight: 1 },
  );
}

function serializeParagraph({
  bullet,
  nestingLevel,
  runs,
}: Paragraph): fc.Arbitrary<DocsElement> {
  return (
    fc
      .tuple(...runs.map(encodeRun))
      // Every element gap, the ones inside a split link included: that is where
      // Docs puts a bookmark or an empty run mid-link.
      .chain((encoded) => withNoise(encoded.flat(), noiseElement, 2))
      .map((elements) => {
        const paragraph: DocsElement = { elements };
        if (bullet) paragraph.bullet = { listId: "kix.a", nestingLevel };
        return { paragraph };
      })
  );
}

function serialize(paragraphs: Paragraph[]) {
  return fc
    .tuple(...paragraphs.map(serializeParagraph))
    .chain((serialized) => withNoise(serialized, structuralNoise, 1))
    .map((content) => ({ body: { content } }));
}

/** A model paired with one of the many Docs responses that encode it. */
export const docWithModel = model.chain((paragraphs) =>
  fc.record({
    model: fc.constant(paragraphs),
    document: serialize(paragraphs),
  }),
);

/**
 * Renders a model to text the way the README says the converter should,
 * implemented independently of index.ts: sharing code with the converter would
 * leave the properties testing only the plumbing.
 */
export function render(paragraphs: Paragraph[], format: Format = "markdown") {
  let text = "";
  for (const paragraph of paragraphs) {
    if (paragraph.runs.length === 0) continue;
    if (paragraph.bullet) text += "* ";
    if (format === "plain") {
      for (const run of paragraph.runs) text += run.content;
      continue;
    }
    for (const group of linkGroups(paragraph.runs))
      text += renderGroup(group, format);
  }
  return text;
}

interface LinkGroup {
  url: string | null;
  runs: Run[];
}

function linkGroups(runs: Run[]): LinkGroup[] {
  const groups: LinkGroup[] = [];
  for (const run of runs) {
    const group = groups.at(-1);
    if (group && group.url === run.url) group.runs.push(run);
    else groups.push({ url: run.url, runs: [run] });
  }
  return groups;
}

function renderGroup({ url, runs }: LinkGroup, format: StyledFormat) {
  const styled = runs.map((run) => decorate(run, format)).join("");
  if (!url) return styled;
  const trailing = styled.match(/\s*$/)![0];
  const linked = styled.slice(0, styled.length - trailing.length);
  if (!linked) return styled;
  if (format === "html") return `<a href="${url}">${linked}</a>${trailing}`;
  return `[${linked}](${url})${trailing}`;
}

// "plain" never reaches here: render returns before styling for that format.
type StyledFormat = Exclude<Format, "plain">;

const MARKS: Record<StyledFormat, Record<"bold" | "italic", string[]>> = {
  markdown: { bold: ["**", "**"], italic: ["_", "_"] },
  html: { bold: ["<strong>", "</strong>"], italic: ["<em>", "</em>"] },
};

function decorate({ content, bold, italic }: Run, format: StyledFormat) {
  if (!bold && !italic) return content;
  const lead = content.match(/^\s*/)![0];
  const trail = content.match(/\s*$/)![0];
  const text = content.slice(lead.length, content.length - trail.length);
  if (!text) return content;
  let out = text;
  const marks = MARKS[format];
  if (italic) out = marks.italic[0] + out + marks.italic[1];
  if (bold) out = marks.bold[0] + out + marks.bold[1];
  return lead + out + trail;
}
