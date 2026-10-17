import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: {
    STEALTH_KV: {},
    STEALTH_COORDINATOR: {},
  },
}));

vi.mock("@/config", () => ({
  loadRuntimeConfig: () => ({
    contract: {
      protocolVersion: "v1",
      policiesContractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    },
    network: {
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    },
  }),
}));

vi.mock("@/server/api/context", () => ({
  getApiContext: async () => ({ repository: {} }),
}));

vi.mock("@/server/api/lifecycle-service", () => ({
  scheduleLifecycleAnchor: vi.fn(),
}));

vi.mock("@/server/api/delivery-hooks", () => ({
  advanceToDeliveryState: vi.fn(),
}));

vi.mock("@/server/api/version", () => ({
  getVersionInfo: () => ({ build: "test-build" }),
}));

vi.mock("@/server/api/protocol", () => ({
  protocolManifest: { apiVersion: "v1" },
}));

vi.mock("@/services/relay/policy-chain", () => ({
  createConfiguredAdmissionEvaluator: () => ({
    async evaluate() {
      return {
        policyVersion: 1,
        allowed: true,
        kind: "trusted",
        reason: "sender_allowed",
        rule: "allow",
        requiredPostage: "0",
        source: "offchain_fallback",
        evaluatedAt: new Date().toISOString(),
      };
    },
  }),
}));

import { getRelayService } from "@/services/relay/context";
import { InProcessRelayWorker } from "@/services/relay/in-process-worker";

const globalRelay = globalThis as typeof globalThis & {
  __stealthRelayService?: unknown;
};

describe("getRelayService worker lifecycle (Issue #316)", () => {
  let startSpy: ReturnType<typeof vi.spyOn>;
  const running: InProcessRelayWorker[] = [];

  beforeEach(() => {
    delete globalRelay.__stealthRelayService;
    startSpy = vi.spyOn(InProcessRelayWorker.prototype, "start");
  });

  afterEach(async () => {
    for (const worker of running.splice(0)) {
      await worker.stop();
    }
    delete globalRelay.__stealthRelayService;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function workerFromLastStart(): InProcessRelayWorker {
    return startSpy.mock.contexts[0] as unknown as InProcessRelayWorker;
  }

  it("starts the worker on the dev path instead of only constructing it", async () => {
    const service = await getRelayService();
    expect(service).toBeDefined();
    expect(startSpy).toHaveBeenCalledTimes(1);

    const worker = workerFromLastStart();
    running.push(worker);
    expect(worker.getStatus()).toBe("running");
  });

  it("starts the worker on the production path that serves the relay API", async () => {
    vi.stubEnv("PROD", true);

    const service = await getRelayService();
    expect(service).toBeDefined();
    expect(startSpy).toHaveBeenCalledTimes(1);

    const worker = workerFromLastStart();
    running.push(worker);
    expect(worker.getStatus()).toBe("running");
  });

  it("reuses the cached singleton without constructing or starting another worker", async () => {
    const first = await getRelayService();
    const second = await getRelayService();

    expect(second).toBe(first);
    expect(startSpy).toHaveBeenCalledTimes(1);
    running.push(workerFromLastStart());
  });
});
