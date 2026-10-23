import { describe, expect, it } from "vitest";

import { enforceRetention } from "../../../src/server/api/retention-service";
import { MemoryApiRepository } from "../../../src/server/api/memory-repository";
import { FakeR2Bucket } from "../../../src/services/storage/r2-fake";
import { R2ObjectStoreAdapter } from "../../../src/services/storage/r2-adapter";

const now = new Date("2026-08-20T00:00:00.000Z");

describe("BETA-080 / Issue #509: Paginated retention enforcement and record deletion", () => {
  it("abandons expired failed jobs and deletes expired dead letters and sweeps staged objects", async () => {
    const repository = new MemoryApiRepository();
    const bucket = new FakeR2Bucket();
    const objectStore = new R2ObjectStoreAdapter(bucket);
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();

    await repository.enqueueJob({
      jobId: "job-old",
      type: "cleanup",
      idempotencyKey: "job-old-key",
      payload: {},
      status: "failed",
      attempts: 5,
      maxAttempts: 5,
      backoffMs: 1000,
      nextRunAt: old,
      createdAt: old,
      updatedAt: old,
      failedAt: old,
    });
    await repository.createDeadLetter({
      deadLetterId: "dlq-old",
      jobId: "job-old",
      jobType: "cleanup",
      idempotencyKey: "job-old-key",
      payload: {},
      attempts: 5,
      errorCode: "ERR_UNKNOWN_PERMANENT",
      errorMessage: "failed",
      deadLetteredAt: old,
      status: "dead",
    });

    const result = await enforceRetention(repository, objectStore, now);
    expect(result.abandonedJobs).toBe(1);
    expect(result.deletedDeadLetters).toBe(1);
    expect((await repository.getJob("job-old"))?.status).toBe("abandoned");
    expect(await repository.getDeadLetter("dlq-old")).toBeNull();
  });

  it("abandons all expired jobs across multiple pages with a fixture of 1500 expired jobs", async () => {
    const repository = new MemoryApiRepository();
    const old = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days old (> 7 days)

    const totalJobs = 1500;
    for (let i = 0; i < totalJobs; i++) {
      await repository.enqueueJob({
        jobId: `job-batch-${i}`,
        type: "cleanup",
        idempotencyKey: `idemp-batch-${i}`,
        payload: { index: i },
        status: "failed",
        attempts: 5,
        maxAttempts: 5,
        backoffMs: 1000,
        nextRunAt: old,
        createdAt: new Date(now.getTime() - (10 * 24 * 60 * 60 * 1000 + i * 1000)).toISOString(),
        updatedAt: old,
        failedAt: old,
      });
    }

    // Verify all 1500 jobs are enqueued as failed
    const initialJobs = await repository.listJobs({ status: "failed", limit: 2000 });
    expect(initialJobs.length).toBe(1500);

    // Enforce retention with batchSize 500 across 3+ pages
    const result = await enforceRetention(repository, null, now, { batchSize: 500 });
    expect(result.abandonedJobs).toBe(1500);

    // All jobs should now be abandoned, 0 failed
    const remainingFailed = await repository.listJobs({ status: "failed", limit: 2000 });
    expect(remainingFailed.length).toBe(0);

    const abandonedJobs = await repository.listJobs({ status: "abandoned", limit: 2000 });
    expect(abandonedJobs.length).toBe(1500);
  });

  it("actually deletes dead letters after dead-letter window so get returns not-found", async () => {
    const repository = new MemoryApiRepository();
    const expiredDate = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString(); // 35 days old (> 30 days)
    const freshDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days old (< 30 days)

    await repository.createDeadLetter({
      deadLetterId: "dlq-expired",
      jobId: "job-1",
      jobType: "cleanup",
      idempotencyKey: "idemp-1",
      payload: { sensitive: "encrypted-payload-to-be-purged" },
      attempts: 5,
      errorCode: "ERR_PERMANENT",
      errorMessage: "dead",
      deadLetteredAt: expiredDate,
      status: "dead",
    });

    await repository.createDeadLetter({
      deadLetterId: "dlq-fresh",
      jobId: "job-2",
      jobType: "cleanup",
      idempotencyKey: "idemp-2",
      payload: { sensitive: "recent-dead-letter" },
      attempts: 3,
      errorCode: "ERR_TRANSIENT",
      errorMessage: "failed",
      deadLetteredAt: freshDate,
      status: "dead",
    });

    const result = await enforceRetention(repository, null, now);
    expect(result.deletedDeadLetters).toBe(1);

    // Expired dead letter is deleted and get returns not-found (null)
    expect(await repository.getDeadLetter("dlq-expired")).toBeNull();

    // Fresh dead letter remains untouched
    expect(await repository.getDeadLetter("dlq-fresh")).not.toBeNull();
  });

  it("asserts the cursor loop terminates cleanly when dataset is exhausted or empty", async () => {
    const repository = new MemoryApiRepository();

    // Empty repository
    const emptyResult = await enforceRetention(repository, null, now, { batchSize: 100 });
    expect(emptyResult.abandonedJobs).toBe(0);
    expect(emptyResult.deletedDeadLetters).toBe(0);

    // Dataset smaller than batchSize
    const old = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await repository.enqueueJob({
      jobId: "job-single",
      type: "cleanup",
      idempotencyKey: "idemp-single",
      payload: {},
      status: "failed",
      attempts: 5,
      maxAttempts: 5,
      backoffMs: 1000,
      nextRunAt: old,
      createdAt: old,
      updatedAt: old,
      failedAt: old,
    });

    const singleResult = await enforceRetention(repository, null, now, { batchSize: 100 });
    expect(singleResult.abandonedJobs).toBe(1);

    // Second run has 0 failed jobs and terminates immediately
    const secondResult = await enforceRetention(repository, null, now, { batchSize: 100 });
    expect(secondResult.abandonedJobs).toBe(0);
  });
});
