import { unlink } from "node:fs/promises";
import type { Client } from "pg";
import { logger } from "./logger.js";
import { resolveIntakeMediaPath } from "./intake-media-storage.js";

/**
 * Retention for intake photos on an invite that was never submitted.
 * Proposal in docs/working/intake-photo-attachments.md (Policy, item 3).
 */
export const ABANDONED_INTAKE_MEDIA_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 200;

export interface PruneAbandonedIntakeMediaResult {
  deleted: number;
  errors: number;
}

export interface PruneAbandonedIntakeMediaOptions {
  retentionDays?: number;
  batchSize?: number;
  /** Test seam. Defaults to fs.unlink. */
  removeFile?: (filePath: string) => Promise<void>;
  /** Test seam. Defaults to the intake storage boundary. */
  resolvePath?: (inviteId: string, filename: string) => string | null;
}

interface Candidate {
  id: string;
  intake_invite_id: string;
  filename: string;
}

/**
 * Delete intake photos that were never linked to a submitted request and whose
 * invite was never used and has been expired for longer than the retention window.
 *
 * Order per row: remove the file first, then the row. If the file is already
 * gone (ENOENT) the row is still removed, so a crash between the two steps is
 * repaired on the next run and no file is left behind. A row whose file cannot
 * be removed is kept and retried on the next run.
 *
 * The worker role has BYPASSRLS, so this sweep covers every account. The WHERE
 * clauses, not the session, limit what it touches. Submitting an invite requires
 * expires_at > now(), so a row that matches here cannot be claimed by a submit
 * while the sweep runs.
 */
export async function pruneAbandonedIntakeMedia(
  client: Pick<Client, "query">,
  options: PruneAbandonedIntakeMediaOptions = {},
): Promise<PruneAbandonedIntakeMediaResult> {
  const retentionDays = options.retentionDays ?? ABANDONED_INTAKE_MEDIA_RETENTION_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const removeFile = options.removeFile ?? ((p: string) => unlink(p));
  const resolvePath = options.resolvePath ?? ((inviteId, filename) => resolveIntakeMediaPath(inviteId, filename));

  let deleted = 0;
  let errors = 0;

  try {
    const { rows } = await client.query<Candidate>(
      `SELECT m.id, m.intake_invite_id, m.filename
       FROM intake_media m
       JOIN intake_invites i ON i.id = m.intake_invite_id
       WHERE m.booking_request_id IS NULL
         AND i.used_at IS NULL
         AND i.expires_at < now() - ($1::text || ' days')::interval
       ORDER BY m.created_at
       LIMIT $2`,
      [String(retentionDays), batchSize],
    );

    for (const row of rows) {
      const filePath = resolvePath(row.intake_invite_id, row.filename);
      if (!filePath) {
        errors += 1;
        logger.error("prune-abandoned-intake-media: unsafe stored path, row skipped", undefined, { mediaId: row.id });
        continue;
      }

      try {
        await removeFile(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          errors += 1;
          logger.error("prune-abandoned-intake-media: file not removed, row kept", err as Error, { mediaId: row.id });
          continue;
        }
      }

      const result = await client.query(
        `DELETE FROM intake_media m
         USING intake_invites i
         WHERE m.id = $1
           AND i.id = m.intake_invite_id
           AND m.booking_request_id IS NULL
           AND i.used_at IS NULL
           AND i.expires_at < now() - ($2::text || ' days')::interval`,
        [row.id, String(retentionDays)],
      );
      deleted += result.rowCount ?? 0;
    }

    if (deleted > 0) {
      logger.info("prune-abandoned-intake-media: deleted abandoned photos", { deleted });
    }
    return { deleted, errors };
  } catch (error) {
    logger.error("prune-abandoned-intake-media: failed", error);
    return { deleted, errors: errors + 1 };
  }
}
