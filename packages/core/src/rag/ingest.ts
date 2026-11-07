import { createHash } from "node:crypto";
import { type Db, chunks, documents } from "@app/db";
import { eq, inArray } from "drizzle-orm";
import type { KbDocument } from "../kb/load";
import { type Chunk, type ChunkOptions, DEFAULT_CHUNK_OPTIONS, chunkMarkdown } from "./chunk";
import type { Embedder } from "./embed";

export interface IngestStats {
  documents: number;
  unchanged: number;
  changed: number;
  deleted: number;
  chunksWritten: number;
  embedded: number;
  reusedEmbeddings: number;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Text that gets embedded: the doc title and heading trail give short chunks their context. */
export function buildEmbeddingText(title: string, chunk: Pick<Chunk, "headingPath" | "content">): string {
  return `${title}\n${chunk.headingPath}\n\n${chunk.content}`;
}

/**
 * Hash of everything that affects a document's stored chunks. Changing the chunking options or the
 * embedding model changes the hash, which forces re-ingestion.
 */
export function documentHash(doc: KbDocument, options: ChunkOptions, model: string): string {
  const { title, url, category, updated, body } = doc;
  return sha256(JSON.stringify({ title, url, category, updated, body, options, model }));
}

export interface IngestPlan {
  changed: KbDocument[];
  unchangedIds: string[];
  deletedIds: string[];
}

export function planIngest(
  docs: KbDocument[],
  existingHashes: Map<string, string>,
  hashOf: (doc: KbDocument) => string,
): IngestPlan {
  const changed: KbDocument[] = [];
  const unchangedIds: string[] = [];
  for (const doc of docs) {
    if (existingHashes.get(doc.id) === hashOf(doc)) unchangedIds.push(doc.id);
    else changed.push(doc);
  }
  const currentIds = new Set(docs.map((d) => d.id));
  const deletedIds = [...existingHashes.keys()].filter((id) => !currentIds.has(id));
  return { changed, unchangedIds, deletedIds };
}

export async function ingestKnowledgeBase(
  db: Db,
  docs: KbDocument[],
  embedder: Embedder,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Promise<IngestStats> {
  const hashOf = (doc: KbDocument) => documentHash(doc, options, embedder.model);
  const existing = await db.select({ id: documents.id, hash: documents.contentHash }).from(documents);
  const plan = planIngest(docs, new Map(existing.map((row) => [row.id, row.hash])), hashOf);

  const stats: IngestStats = {
    documents: docs.length,
    unchanged: plan.unchangedIds.length,
    changed: plan.changed.length,
    deleted: plan.deletedIds.length,
    chunksWritten: 0,
    embedded: 0,
    reusedEmbeddings: 0,
  };

  for (const doc of plan.changed) {
    const docChunks = chunkMarkdown(doc.body, options).map((chunk) => {
      const embeddingText = buildEmbeddingText(doc.title, chunk);
      return { ...chunk, embeddingText, hash: sha256(`${embedder.model}\n${embeddingText}`) };
    });

    const hashes = docChunks.map((c) => c.hash);
    const reusable = new Map(
      (
        await db
          .select({ hash: chunks.contentHash, embedding: chunks.embedding })
          .from(chunks)
          .where(inArray(chunks.contentHash, hashes))
      ).map((row) => [row.hash, row.embedding]),
    );
    const missing = docChunks.filter((c) => !reusable.has(c.hash));
    const fresh = await embedder.embedDocuments(missing.map((c) => c.embeddingText));
    missing.forEach((c, i) => reusable.set(c.hash, fresh[i]!));
    stats.embedded += missing.length;
    stats.reusedEmbeddings += docChunks.length - missing.length;

    await db.transaction(async (tx) => {
      const row = {
        id: doc.id,
        title: doc.title,
        url: doc.url,
        category: doc.category,
        updatedOn: doc.updated,
        contentHash: hashOf(doc),
        ingestedAt: new Date(),
      };
      await tx.insert(documents).values(row).onConflictDoUpdate({ target: documents.id, set: row });
      await tx.delete(chunks).where(eq(chunks.documentId, doc.id));
      if (docChunks.length > 0) {
        await tx.insert(chunks).values(
          docChunks.map((c) => ({
            id: `${doc.id}:${c.index}`,
            documentId: doc.id,
            chunkIndex: c.index,
            headingPath: c.headingPath,
            content: c.content,
            tokenCount: c.tokenCount,
            contentHash: c.hash,
            embedding: reusable.get(c.hash)!,
          })),
        );
      }
    });
    stats.chunksWritten += docChunks.length;
  }

  if (plan.deletedIds.length > 0) {
    await db.delete(documents).where(inArray(documents.id, plan.deletedIds));
  }
  return stats;
}
