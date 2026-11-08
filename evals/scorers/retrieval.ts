/** Collapses a ranked chunk list to a ranked document list (first occurrence wins). */
export function rankedDocuments(chunkDocIds: string[]): string[] {
  return [...new Set(chunkDocIds)];
}

/** 1-based rank of the first expected document, or null if none was retrieved. */
export function firstRelevantRank(rankedDocIds: string[], expected: string[]): number | null {
  const index = rankedDocIds.findIndex((id) => expected.includes(id));
  return index === -1 ? null : index + 1;
}

export interface RetrievalSummary {
  cases: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  /** Mean reciprocal rank: average of 1/rank of the first relevant doc (0 when missing). */
  mrr: number;
}

export function summarizeRanks(ranks: Array<number | null>): RetrievalSummary {
  const n = ranks.length || 1;
  const hitAt = (k: number) => ranks.filter((r) => r !== null && r <= k).length / n;
  return {
    cases: ranks.length,
    hitAt1: hitAt(1),
    hitAt3: hitAt(3),
    hitAt5: hitAt(5),
    mrr: ranks.reduce<number>((sum, r) => sum + (r === null ? 0 : 1 / r), 0) / n,
  };
}
