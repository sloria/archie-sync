export interface Options {
  format?: "markdown" | "html" | "plain";
}

type Format = NonNullable<Options["format"]>;

interface Suggestible {
  suggestedInsertionIds?: string[];
}

interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  link?: { url?: string };
}

interface TextRun extends Suggestible {
  content?: string;
  textStyle?: TextStyle;
}

interface RichLink extends Suggestible {
  richLinkProperties?: { uri?: string; title?: string };
}

interface Person extends Suggestible {
  personProperties?: { name?: string; email?: string };
}

interface Paragraph {
  elements?: { textRun?: TextRun; richLink?: RichLink; person?: Person }[];
  bullet?: unknown;
}

export interface GoogleDocument {
  body?: { content?: { paragraph?: Paragraph }[] };
}

interface Run {
  content: string;
  url: string | null;
  bold: boolean;
  italic: boolean;
}

const makeRun = (
  content: string,
  url: string | null = null,
  style: TextStyle = {},
): Run => ({
  content,
  url,
  bold: style.bold === true,
  italic: style.italic === true,
});

function extractRuns(paragraph: Paragraph): Run[] {
  const runs: Run[] = [];
  for (const element of paragraph.elements ?? []) {
    const { textRun, richLink, person } = element;
    // Pending insertions aren't part of the document yet, so skip them;
    // pending deletions still are, so keep them.
    const suggestible = textRun ?? richLink ?? person;
    if (suggestible?.suggestedInsertionIds?.length) continue;
    let run: Run | null = null;
    if (textRun) {
      const style = textRun.textStyle ?? {};
      run = makeRun(textRun.content ?? "", style.link?.url ?? null, style);
    } else if (richLink) {
      const props = richLink.richLinkProperties;
      if (props?.uri) run = makeRun(props.title || props.uri, props.uri);
    } else if (person) {
      const props = person.personProperties;
      const name = props?.name || props?.email;
      if (name) run = makeRun(name);
    }
    if (!run?.content) continue;
    const prev = runs.at(-1);
    if (
      prev &&
      prev.url === run.url &&
      prev.bold === run.bold &&
      prev.italic === run.italic
    ) {
      prev.content += run.content;
    } else {
      runs.push(run);
    }
  }
  return runs;
}

function emphasize({ content, bold, italic }: Run, format: Format): string {
  if (!bold && !italic) return content;
  // Removes edge whitespace, e.g. `** text**`
  const [, lead, text, trail] = content.match(/^(\s*)(.*?)(\s*)$/s)!;
  if (!text) return content;
  let out = text;
  if (italic) out = format === "html" ? `<em>${out}</em>` : `_${out}_`;
  if (bold) out = format === "html" ? `<strong>${out}</strong>` : `**${out}**`;
  return lead + out + trail;
}

interface Group {
  url: string | null;
  runs: Run[];
}

// Render a sequence of runs sharing a single URL as one link
function renderGroup({ runs, url }: Group, format: Format): string {
  const inner = runs.map((run) => emphasize(run, format)).join("");
  if (!url) return inner;
  // Keep the trailing newline/whitespace outside the link markup: a
  // whole-line link otherwise produces `[text\n](url)`.
  const [, text, trailing] = inner.match(/^(.*?)(\s*)$/s)!;
  if (!text) return inner;
  if (format === "html") return `<a href="${url}">${text}</a>${trailing}`;
  return `[${text}](${url})${trailing}`;
}

/**
 * Converts a Docs API v1 documents.get response body into text.
 *
 * @param document the response body, or one tab's `documentTab`.
 * @param options.format `"markdown"` (default), `"html"`, or `"plain"`.
 */
export default function gdocToText(
  document: GoogleDocument,
  { format = "markdown" }: Options = {},
): string {
  let text = "";
  for (const element of document.body?.content ?? []) {
    const paragraph = element.paragraph;
    if (!paragraph) continue;
    const runs = extractRuns(paragraph);
    if (runs.length === 0) continue;
    if (paragraph.bullet) text += "* ";
    if (format === "plain") {
      text += runs.map((run) => run.content).join("");
      continue;
    }
    const groups: Group[] = [];
    for (const run of runs) {
      const group = groups.at(-1);
      if (group?.url === run.url) group.runs.push(run);
      else groups.push({ url: run.url, runs: [run] });
    }
    for (const group of groups) text += renderGroup(group, format);
  }
  return text;
}
