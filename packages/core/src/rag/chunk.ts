export interface Chunk {
  index: number;
  /** Heading trail of the chunk's first section, e.g. "Refund policy > Annual plans". */
  headingPath: string;
  content: string;
  tokenCount: number;
}

export interface ChunkOptions {
  /** Upper bound per chunk; long sections are split into windows of this size. */
  maxTokens: number;
  /** Sections smaller than this are merged with a neighbour so chunks carry enough context. */
  minTokens: number;
  /** Tokens repeated between consecutive windows of one long section. */
  overlapTokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxTokens: 300, minTokens: 60, overlapTokens: 45 };

/** ~4 characters per token for English text; close enough for sizing chunks. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Piece {
  headingPath: string[];
  text: string;
}

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Splits markdown into sections at h1–h3 headings, ignoring "#" lines inside code fences. */
export function splitSections(markdown: string): Piece[] {
  const sections: Piece[] = [];
  const trail: string[] = [];
  let current: Piece = { headingPath: [], text: "" };
  let inFence = false;

  const flush = () => {
    const body = current.text.trim();
    const isHeadingOnly = body.split("\n").every((line) => HEADING.test(line) || line.trim() === "");
    if (body && !isHeadingOnly) sections.push({ headingPath: current.headingPath, text: body });
  };

  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    const match = inFence ? null : HEADING.exec(line);
    if (match) {
      flush();
      const level = match[1]!.length;
      trail.length = level - 1;
      trail[level - 1] = match[2]!;
      current = { headingPath: trail.filter(Boolean), text: `${line}\n` };
    } else {
      current.text += `${line}\n`;
    }
  }
  flush();
  return sections;
}

function splitIntoUnits(text: string, maxTokens: number): string[] {
  const units: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    if (estimateTokens(paragraph) <= maxTokens) {
      units.push(paragraph);
      continue;
    }
    units.push(
      ...(paragraph.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [paragraph]).map((s) => s.trim()).filter(Boolean),
    );
  }
  return units;
}

/** Packs paragraphs (or sentences) of one oversized section into overlapping windows. */
function splitLongSection(piece: Piece, options: ChunkOptions): Piece[] {
  const units = splitIntoUnits(piece.text, options.maxTokens);
  const windows: Piece[] = [];
  let window: string[] = [];

  const tokensOf = (parts: string[]) => estimateTokens(parts.join("\n\n"));

  for (const unit of units) {
    if (window.length > 0 && tokensOf([...window, unit]) > options.maxTokens) {
      windows.push({ headingPath: piece.headingPath, text: window.join("\n\n") });
      const overlap: string[] = [];
      for (let i = window.length - 1; i >= 0; i--) {
        if (tokensOf([window[i]!, ...overlap]) > options.overlapTokens) break;
        overlap.unshift(window[i]!);
      }
      window = overlap;
    }
    window.push(unit);
  }
  if (window.length > 0) windows.push({ headingPath: piece.headingPath, text: window.join("\n\n") });
  return windows;
}

export function chunkMarkdown(markdown: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
  const pieces = splitSections(markdown).flatMap((section) =>
    estimateTokens(section.text) > options.maxTokens ? splitLongSection(section, options) : [section],
  );

  const merged: Piece[] = [];
  for (const piece of pieces) {
    const previous = merged.at(-1);
    const isSmall = (p: Piece) => estimateTokens(p.text) < options.minTokens;
    const combined = previous ? `${previous.text}\n\n${piece.text}` : "";
    if (previous && (isSmall(previous) || isSmall(piece)) && estimateTokens(combined) <= options.maxTokens) {
      previous.text = combined;
    } else {
      merged.push({ ...piece });
    }
  }

  return merged.map((piece, index) => ({
    index,
    headingPath: piece.headingPath.join(" > "),
    content: piece.text,
    tokenCount: estimateTokens(piece.text),
  }));
}
