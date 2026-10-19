import type { ApiRepository } from "./repository";
import type { ObjectStoreAdapter } from "@/services/storage/object-store";

export const DEFAULT_RETENTION_POLICY = {
  failedJobMs: 7 * 24 * 60 * 60 * 1000,
  deadLetterMs: 30 * 24 * 60 * 60 * 1000,
} as const;

export interface RetentionPolicy {
  failedJobMs: number;
  deadLetterMs: number;
  batchSize?: number;
}

export interface RetentionResult {
  expiredObjects: number;
  deletedObjects: number;
  abandonedJobs: number;
  deletedJobs: number;
  abandonedDeadLetters: number;
  deletedDeadLetters: number;
}

export async function enforceRetention(
  repository: ApiRepository,
  objectStore: ObjectStoreAdapter | null,
  now = new Date(),
  policy: Partial<RetentionPolicy> = DEFAULT_RETENTION_POLICY,
): Promise<RetentionResult> {
  const failedJobMs = policy.failedJobMs ?? DEFAULT_RETENTION_POLICY.failedJobMs;
  const deadLetterMs = policy.deadLetterMs ?? DEFAULT_RETENTION_POLICY.deadLetterMs;
  const batchSize = policy.batchSize ?? 1000;

  let abandonedJobs = 0;
  let deletedJobs = 0;
  let abandonedDeadLetters = 0;
  let deletedDeadLetters = 0;

  // 1. Paginate through failed jobs using cursor until exhausted
  let jobCursor: string | undefined = undefined;
  const seenJobCursors = new Set<string>();

  while (true) {
    const jobs = await repository.listJobs({
      status: "failed",
      limit: batchSize,
      after: jobCursor,
    });

    if (jobs.length === 0) break;

    for (const job of jobs) {
      if (now.getTime() - new Date(job.updatedAt).getTime() >= failedJobMs) {
        await repository.updateJob({
          ...job,
          status: "abandoned",
          updatedAt: now.toISOString(),
        });
        abandonedJobs++;
      }
    }

    const lastJob = jobs[jobs.length - 1];
    if (!lastJob || seenJobCursors.has(lastJob.jobId)) break;
    seenJobCursors.add(lastJob.jobId);
    jobCursor = lastJob.jobId;

    if (jobs.length < batchSize) break;
  }

  // 2. Paginate through dead letters using cursor until exhausted
  // After deadLetterMs window, delete the record from repository
  let dlCursor: string | undefined = undefined;
  const seenDlCursors = new Set<string>();

  while (true) {
    const deadLetters = await repository.listDeadLetters({
      limit: batchSize,
      after: dlCursor,
    });

    if (deadLetters.length === 0) break;

    const toDelete: string[] = [];
    for (const deadLetter of deadLetters) {
      const ageMs = now.getTime() - new Date(deadLetter.deadLetteredAt).getTime();
      if (ageMs >= deadLetterMs) {
        toDelete.push(deadLetter.deadLetterId);
      }
    }

    const lastDl = deadLetters[deadLetters.length - 1];
    const nextCursor = lastDl?.deadLetterId;

    if (typeof repository.deleteDeadLetter === "function") {
      for (const id of toDelete) {
        await repository.deleteDeadLetter(id);
        deletedDeadLetters++;
      }
    } else {
      for (const id of toDelete) {
        const dl = deadLetters.find((d) => d.deadLetterId === id);
        if (dl) {
          await repository.updateDeadLetter({
            ...dl,
            status: "abandoned",
            abandonedAt: now.toISOString(),
          });
          abandonedDeadLetters++;
        }
      }
    }

    if (!nextCursor || seenDlCursors.has(nextCursor)) break;
    seenDlCursors.add(nextCursor);
    dlCursor = nextCursor;

    if (deadLetters.length < batchSize) break;
  }

  const expiredObjects = objectStore ? await objectStore.cleanupExpired(now) : 0;
  return {
    expiredObjects,
    deletedObjects: expiredObjects,
    abandonedJobs,
    deletedJobs,
    abandonedDeadLetters,
    deletedDeadLetters,
  };
}
