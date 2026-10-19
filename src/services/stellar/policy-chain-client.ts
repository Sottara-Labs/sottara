import { contract, Keypair, rpc, Transaction } from "@stellar/stellar-sdk";

import { loadRuntimeConfig } from "../../config";
import type { BetaRuntimeConfig } from "../../config/schema";
import type { ChainMailboxPolicy, MailboxPolicy, SenderRule } from "../../server/api/domain";
import { ManagedWalletService } from "./managed-wallet";
import {
  createPoliciesClient,
  getVersionedPolicy,
  senderRule as readContractSenderRule,
  senderTier as readContractSenderTier,
  SenderRule as ContractSenderRule,
  type MailboxPolicy as ContractMailboxPolicy,
} from "./contracts/policies";

export interface VersionedChainPolicy {
  policy: ContractMailboxPolicy;
  version: number;
}

export interface PolicyChainSubmitResult {
  txHash: string;
}

/**
 * Error thrown when a policy read could not be completed because the chain is
 * unavailable (e.g. RPC outage). This is distinct from "not found" and must be
 * treated as a retryable, fail-closed condition by callers.
 */
export class PolicyChainUnavailableError extends Error {
  readonly retryable = true as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "PolicyChainUnavailableError";
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isPolicyChainUnavailableError(error: unknown): error is PolicyChainUnavailableError {
  return error instanceof PolicyChainUnavailableError;
}

export interface PolicyChainClient {
  readVersionedPolicy(owner: string): Promise<VersionedChainPolicy | null>;
  readMailboxPolicy(
    owner: string,
  ): Promise<{ policy: MailboxPolicy | null; version: number | null };
  readSenderRule(owner: string, sender: string): Promise<SenderRule | null>;
  readSenderTier(owner: string, sender: string): Promise<string | null>;
  submitMailboxPolicyWrite(
    owner: string,
    policy: ChainMailboxPolicy,
    actorAddress: string,
    requestId?: string,
  ): Promise<PolicyChainSubmitResult>;
  submitSenderRuleWrite(
    owner: string,
    sender: string,
    rule: SenderRule,
    actorAddress: string,
    requestId?: string,
  ): Promise<PolicyChainSubmitResult>;
  submitSenderTierWrite(
    owner: string,
    sender: string,
    minimumPostage: string,
    actorAddress: string,
    requestId?: string,
  ): Promise<PolicyChainSubmitResult>;
}

export function contractPolicyToApi(policy: ContractMailboxPolicy): MailboxPolicy {
  return {
    allowUnknown: policy.allow_unknown,
    requireVerified: policy.require_verified,
    minimumPostage: policy.minimum_postage.toString(),
  };
}

export function contractPolicyToChain(policy: ContractMailboxPolicy): ChainMailboxPolicy {
  return {
    allowUnknown: policy.allow_unknown,
    requireVerified: policy.require_verified,
    requireReceipt: policy.require_receipt,
    minimumPostage: policy.minimum_postage.toString(),
  };
}

function toContractPolicy(policy: ChainMailboxPolicy): ContractMailboxPolicy {
  return {
    allow_unknown: policy.allowUnknown,
    require_verified: policy.requireVerified,
    require_receipt: policy.requireReceipt,
    minimum_postage: BigInt(policy.minimumPostage),
  };
}

function toContractSenderRule(rule: SenderRule): ContractSenderRule {
  switch (rule) {
    case "allow":
      return ContractSenderRule.Allow;
    case "block":
      return ContractSenderRule.Block;
    case "default":
      return ContractSenderRule.Default;
    case "verify":
    case "price":
      throw new Error(`Sender rule '${rule}' must not be submitted via set_sender_rule`);
    default:
      return ContractSenderRule.Default;
  }
}

function fromContractSenderRule(rule: ContractSenderRule | number): SenderRule {
  const value = typeof rule === "number" ? rule : rule;
  switch (value) {
    case ContractSenderRule.Allow: // eslint-disable-line @typescript-eslint/no-duplicate-enum-members
      return "allow";
    case ContractSenderRule.Block:
      return "block";
    default:
      return "default";
  }
}

function toPolicyChainUnavailableError(operation: string, cause: unknown): PolicyChainUnavailableError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new PolicyChainUnavailableError(`Failed to ${operation}: ${detail}`, {
    cause,
  });
}

export class SorobanPolicyChainClient implements PolicyChainClient {
  private readonly rpc: rpc.Server;
  private readonly wallet: ManagedWalletService;
  private readonly operatorKeypair: Keypair;

  constructor(private readonly config: BetaRuntimeConfig) {
    this.rpc = new rpc.Server(config.network.sorobanRpcUrl);
    this.wallet = new ManagedWalletService(config);
    const operatorSecret = config.secrets?.operatorSecret;
    if (!operatorSecret) {
      throw new Error("Policy chain client requires STEALHT_OPERATOR_SECRET");
    }
    this.operatorKeypair = Keypair.fromSecret(operatorSecret);
  }

  private policiesClient(publicKey?: string) {
    return createPoliciesClient({
      contractId: this.config.contract.policiesContractId,
      networkPassphrase: this.config.network.networkPassphrase,
      rpcUrl: this.config.network.sorobanRpcUrl,
      publicKey: publicKey ?? this.operatorKeypair.publicKey(),
    });
  }

  async readVersionedPolicy(owner: string): Promise<VersionedChainPolicy | null> {
    try {
      const client = this.policiesClient();
      const versioned = await getVersionedPolicy(client, owner);
      return { policy: versioned.policy, version: versioned.version };
    } catch (error) {
      if (isPolicyNotFoundError(error)) {
        return null;
      }
      throw toPolicyChainUnavailableError(`read policy for ${owner}`, error);
    }
  }

  async readMailboxPolicy(
    owner: string,
  ): Promise<{ policy: MailboxPolicy | null; version: number | null }> {
    const versioned = await this.readVersionedPolicy(owner);
    if (!versioned) return { policy: null, version: null };
    return { policy: contractPolicyToApi(versioned.policy), version: versioned.version };
  }

  async readSenderRule(owner: string, sender: string): Promise<SenderRule | null> {
    try {
      const client = this.policiesClient();
      const rule = await readContractSenderRule(client, owner, sender);
      return fromContractSenderRule(rule);
    } catch (error) {
      if (isPolicyNotFoundError(error)) {
        return null;
      }
      throw toPolicyChainUnavailableError(`read sender rule for ${owner}/${sender}`, error);
    }
  }

  async readSenderTier(owner: string, sender: string): Promise<string | null> {
    try {
      const client = this.policiesClient();
      const tier = await readContractSenderTier(client, owner, sender);
      return tier === null || tier === undefined ? null : tier.toString();
    } catch (error) {
      if (isPolicyNotFoundError(error)) {
        return null;
      }
      throw toPolicyChainUnavailableError(`read sender tier for ${owner}/${sender}`, error);
    }
  }

  async submitMailboxPolicyWrite(
    owner: string,
    policy: ChainMailboxPolicy,
    actorAddress: string,
    requestId?: string,
  ): Promise<PolicyChainSubmitResult> {
    const client = this.policiesClient(this.operatorKeypair.publicKey());
    const assembled = await (
      client as contract.Client & {
        set_policy: (args: {
          owner: string;
          policy: ContractMailboxPolicy;
        }) => Promise<contract.AssembledTransaction<unknown>>;
      }
    ).set_policy({
      owner,
      policy: toContractPolicy(policy),
    });

    const unsignedXdr = assembled.built!.toEnvelope().toXDR("base64");
    const signedXdr = await this.wallet.signTransaction(
      { type: "policy", ownerAddress: owner },
      actorAddress,
      unsignedXdr,
      requestId,
    );

    return this.submitSignedXdr(signedXdr);
  }

  async submitSenderRuleWrite(
    owner: string,
    sender: string,
    rule: SenderRule,
    actorAddress: string,
    requestId?: string,
  ): Promise<PolicyChainSubmitResult> {
    const client = this.policiesClient(this.operatorKeypair.publicKey());
    const assembled = await (
      client as contract.Client & {
        set_sender_rule: (args: {
          owner: string;
          sender: string;
          rule: ContractSenderRule;
        }) => Promise<contract.AssembledTransaction<unknown>>;
      }
    ).set_sender_rule({
      owner,
      sender,
      rule: toContractSenderRule(rule),
    });

    const unsignedXdr = assembled.built!.toEnvelope().toXDR("base64");
    const signedXdr = await this.wallet.signTransaction(
      { type: "policy", ownerAddress: owner },
      actorAddress,
      unsignedXdr,
      requestId,
    );

    return this.submitSignedXdr(signedXdr);
  }

  async submitSenderTierWrite(
    owner: string,
    sender: string,
    minimumPostage: string,
    actorAddress: string,
    requestId?: string,
  ): Promise<PolicyChainSubmitResult> {
    const client = this.policiesClient(this.operatorKeypair.publicKey());
    const assembled = await (
      client as contract.Client & {
        set_sender_tier: (args: {
          owner: string;
          sender: string;
          minimum_postage: bigint;
        }) => Promise<contract.AssembledTransaction<unknown>>;
      }
    ).set_sender_tier({
      owner,
      sender,
      minimum_postage: BigInt(minimumPostage),
    });

    const unsignedXdr = assembled.built!.toEnvelope().toXDR("base64");
    const signedXdr = await this.wallet.signTransaction(
      { type: "policy", ownerAddress: owner },
      actorAddress,
      unsignedXdr,
      requestId,
    );

    return this.submitSignedXdr(signedXdr);
  }

  private async submitSignedXdr(signedXdr: string): Promise<PolicyChainSubmitResult> {
    const tx = new Transaction(signedXdr, this.config.network.networkPassphrase);
    const response = await this.rpc.sendTransaction(tx);
    if (response.status === "ERROR") {
      throw new Error(response.errorResult?.result()?.switch().name ?? "transaction failed");
    }

    const hash = response.hash ?? tx.hash().toString("hex");
    if (response.status === "PENDING" || response.status === "DUPLICATE") {
      await this.rpc.pollTransaction(hash, {
        attempts: 30,
        sleepStrategy: rpc.LinearSleepStrategy,
      });
    }

    return { txHash: hash };
  }
}

/**
 * Determine whether an error from the contract client indicates a missing
 * entry ("not found") rather than an infrastructure failure. Only the former
 * should be converted to `null`; everything else must fail closed.
 */
function isPolicyNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; message?: string; code?: string };
  const name = candidate.name ?? "";
  if (name === "PolicyNotFound" || name === "NotFound") return true;
  const message = candidate.message ?? "";
  if (/not found/i.test(message)) return true;
  if (/no policy/i.test(message)) return true;
  if (/contract entry missing/i.test(message)) return true;
  return false;
}

export class InMemoryPolicyChainClient implements PolicyChainClient {
  private readonly mailbox = new Map<string, { policy: ChainMailboxPolicy; version: number }>();
  private readonly rules = new Map<string, SenderRule>();
  private readonly tiers = new Map<string, string>();
  public submitCalls = 0;
  public failNextSubmit = false;
  /** When true, every read fails closed as chain-unavailable. */
  public unavailable = false;

  seedMailbox(owner: string, policy: ChainMailboxPolicy, version: number): void {
    this.mailbox.set(owner, { policy, version });
  }

  seedSenderRule(owner: string, sender: string, rule: SenderRule): void {
    const key = `${owner}:${sender}`;
    if (rule === "default") this.rules.delete(key);
    else this.rules.set(key, rule);
  }

  seedSenderTier(owner: string, sender: string, minimumPostage: string | null): void {
    const key = `${owner}:${sender}`;
    if (minimumPostage === null) this.tiers.delete(key);
    else this.tiers.set(key, minimumPostage);
  }

  async readVersionedPolicy(owner: string): Promise<VersionedChainPolicy | null> {
    if (this.unavailable) {
      throw new PolicyChainUnavailableError(`read policy for ${owner}: RPC unavailable`);
    }
    const entry = this.mailbox.get(owner);
    if (!entry) return null;
    return { policy: entry.policy, version: entry.version };
  }

  async readMailboxPolicy(
    owner: string,
  ): Promise<{ policy: MailboxPolicy | null; version: number | null }> {
    const versioned = await this.readVersionedPolicy(owner);
    if (!versioned) return { policy: null, version: null };
    return { policy: contractPolicyToApi(versioned.policy), version: versioned.version };
  }

  async readSenderRule(owner: string, sender: string): Promise<SenderRule | null> {
    if (this.unavailable) {
      throw new PolicyChainUnavailableError(`read sender rule for ${owner}/${sender}: RPC unavailable`);
    }
    return this.rules.get(`${owner}:${sender}`) ?? null;
  }

  async readSenderTier(owner: string, sender: string): Promise<string | null> {
    if (this.unavailable) {
      throw new PolicyChainUnavailableError(`read sender tier for ${owner}/${sender}: RPC unavailable`);
    }
    return this.tiers.get(`${owner}:${sender}`) ?? null;
  }

  async submitMailboxPolicyWrite(
    owner: string,
    policy: ChainMailboxPolicy,
    _actorAddress: string,
    _requestId?: string,
  ): Promise<PolicyChainSubmitResult> {
    this.submitCalls += 1;
    if (this.failNextSubmit) {
      this.failNextSubmit = false;
      throw new Error("submit failed");
    }
    const existing = this.mailbox.get(owner);
    const version = (existing?.version ?? 0) + 1;
    this.mailbox.set(owner, { policy, version });
    return { txHash: `in-memory-${version}` };
  }

  async submitSenderRuleWrite(
    owner: string,
    sender: string,
    rule: SenderRule,
    _actorAddress: string,
    _requestId?: string,
  ): Promise<PolicyChainSubmitResult> {
    this.submitCalls += 1;
    if (this.failNextSubmit) {
      this.failNextSubmit = false;
      throw new Error("submit failed");
    }
    this.seedSenderRule(owner, sender, rule);
    return { txHash: `in-memory-rule-${this.submitCalls}` };
  }

  async submitSenderTierWrite(
    owner: string,
    sender: string,
    minimumPostage: string,
    _actorAddress: string,
    _requestId?: string,
  ): Promise<PolicyChainSubmitResult> {
    this.submitCalls += 1;
    if (this.failNextSubmit) {
      this.failNextSubmit = false;
      throw new Error("submit failed");
    }
    this.seedSenderTier(owner, sender, minimumPostage);
    return { txHash: `in-memory-tier-${this.submitCalls}` };
  }
}
