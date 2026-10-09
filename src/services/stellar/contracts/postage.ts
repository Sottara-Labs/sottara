// AUTO-GENERATED — do not edit by hand.
// Source: contracts/soroban/postage/spec.json
// Regenerate: npm run generate:bindings

import { contract, Keypair, Transaction } from "@stellar/stellar-sdk";

export interface Postage {
  amount: bigint;
  created_at: bigint;
  dispute_until: bigint;
  expires_at: bigint;
  fee: bigint;
  recipient: string;
  sender: string;
  status: PostageStatus;
}

export interface EscrowConfig {
  asset: string;
  dispute_seconds: bigint;
  expiry_seconds: bigint;
  fee_bps: number;
  minimum: bigint;
  treasury: string;
}

export enum PostageStatus {
  Pending = 0,
  Expired = 1,
  Disputed = 2,
  Settled = 3,
  Refunded = 4,
  Reclaimed = 5,
}

export enum PostageError {
  AlreadyInitialized = 1,
  NotInitialized = 2,
  InvalidAmount = 3,
  DuplicateMessage = 4,
  PostageNotFound = 5,
  AlreadyResolved = 6,
  InvalidFee = 7,
  InvalidWindow = 8,
  NotExpired = 9,
  DisputeUnavailable = 10,
  GuardNotConfigured = 11,
  LifecycleRejected = 12,
}

/** Base64-encoded XDR contract spec entries used to initialize the contract Spec. */
export const SPEC_ENTRIES: string[] = [
  "AAAAAQAAAAAAAAAAAAAAB1Bvc3RhZ2UAAAAACAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAAAAAAA1kaXNwdXRlX3VudGlsAAAAAAAABgAAAAAAAAAKZXhwaXJlc19hdAAAAAAABgAAAAAAAAADZmVlAAAAAAsAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADVBvc3RhZ2VTdGF0dXMAAAA=",
  "AAAAAQAAAAAAAAAAAAAADEVzY3Jvd0NvbmZpZwAAAAYAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAPZGlzcHV0ZV9zZWNvbmRzAAAAAAYAAAAAAAAADmV4cGlyeV9zZWNvbmRzAAAAAAAGAAAAAAAAAAdmZWVfYnBzAAAAAAQAAAAAAAAAB21pbmltdW0AAAAACwAAAAAAAAAIdHJlYXN1cnkAAAAT",
  "AAAAAwAAAAAAAAAAAAAADVBvc3RhZ2VTdGF0dXMAAAAAAAAGAAAAAAAAAAdQZW5kaW5nAAAAAAAAAAAAAAAAB0V4cGlyZWQAAAAAAQAAAAAAAAAIRGlzcHV0ZWQAAAACAAAAAAAAAAdTZXR0bGVkAAAAAAMAAAAAAAAACFJlZnVuZGVkAAAABAAAAAAAAAAJUmVjbGFpbWVkAAAAAAAABQ==",
  "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAMAAAAAAAAAEER1cGxpY2F0ZU1lc3NhZ2UAAAAEAAAAAAAAAA9Qb3N0YWdlTm90Rm91bmQAAAAABQAAAAAAAAAPQWxyZWFkeVJlc29sdmVkAAAAAAYAAAAAAAAACkludmFsaWRGZWUAAAAAAAcAAAAAAAAADUludmFsaWRXaW5kb3cAAAAAAAAIAAAAAAAAAApOb3RFeHBpcmVkAAAAAAAJAAAAAAAAABJEaXNwdXRlVW5hdmFpbGFibGUAAAAAAAoAAAAAAAAAEkd1YXJkTm90Q29uZmlndXJlZAAAAAAACwAAAAAAAAARTGlmZWN5Y2xlUmVqZWN0ZWQAAAAAAAAM",
  "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAABgAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAh0cmVhc3VyeQAAABMAAAAAAAAAB21pbmltdW0AAAAACwAAAAAAAAAHZmVlX2JwcwAAAAAEAAAAAAAAAA5leHBpcnlfc2Vjb25kcwAAAAAABgAAAAAAAAAPZGlzcHV0ZV9zZWNvbmRzAAAAAAYAAAABAAAD6QAAAAIAAAfQAAAABUVycm9yAAAA",
  "AAAAAAAAAAAAAAAPY29uZmlndXJlX2d1YXJkAAAAAAEAAAAAAAAABWd1YXJkAAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAAFRXJyb3IAAAA=",
  "AAAAAAAAAAAAAAAFZ3VhcmQAAAAAAAAAAAAAAQAAA+kAAAATAAAH0AAAAAVFcnJvcgAAAA==",
  "AAAAAAAAAAAAAAAGY29uZmlnAAAAAAAAAAAAAQAAA+kAAAfQAAAADEVzY3Jvd0NvbmZpZwAAB9AAAAAFRXJyb3IAAAA=",
  "AAAAAAAAAAAAAAAHbWluaW11bQAAAAAAAAAAAQAAA+kAAAALAAAH0AAAAAVFcnJvcgAAAA==",
  "AAAAAAAAAAAAAAAFcXVvdGUAAAAAAAABAAAAAAAAAA5zZW5kZXJfdHJ1c3RlZAAAAAAAAQAAAAEAAAPpAAAACwAAB9AAAAAFRXJyb3IAAAA=",
  "AAAAAAAAAAAAAAAGc3VibWl0AAAAAAAEAAAAAAAAAAptZXNzYWdlX2lkAAAAAAPuAAAAIAAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAB9AAAAAHUG9zdGFnZQAAAAfQAAAABUVycm9yAAAA",
  "AAAAAAAAAAAAAAAGc2V0dGxlAAAAAAABAAAAAAAAAAptZXNzYWdlX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAH0AAAAAdQb3N0YWdlAAAAB9AAAAAFRXJyb3IAAAA=",
  "AAAAAAAAAAAAAAAGcmVmdW5kAAAAAAABAAAAAAAAAAptZXNzYWdlX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAH0AAAAAdQb3N0YWdlAAAAB9AAAAAFRXJyb3IAAAA=",
  "AAAAAAAAAAAAAAAHZGlzcHV0ZQAAAAABAAAAAAAAAAptZXNzYWdlX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAH0AAAAAdQb3N0YWdlAAAAB9AAAAAFRXJyb3IAAAA=",
  "AAAAAAAAAAAAAAAGZXhwaXJlAAAAAAABAAAAAAAAAAptZXNzYWdlX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAH0AAAAAdQb3N0YWdlAAAAB9AAAAAFRXJyb3IAAAA=",
  "AAAAAAAAAAAAAAAHcmVjbGFpbQAAAAABAAAAAAAAAAptZXNzYWdlX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAH0AAAAAdQb3N0YWdlAAAAB9AAAAAFRXJyb3IAAAA=",
  "AAAAAAAAAAAAAAADZ2V0AAAAAAEAAAAAAAAACm1lc3NhZ2VfaWQAAAAAA+4AAAAgAAAAAQAAA+kAAAfQAAAAB1Bvc3RhZ2UAAAAH0AAAAAVFcnJvcgAAAA==",
];

export interface PostageClientOptions {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  /** Public key of the transaction source account. */
  publicKey?: string;
  /** Secret seed of the signing keypair (e.g. the operator keypair). */
  signer?: string;
}

type PostageResult<T> = contract.Ok<T> | contract.Err<{ message: string }>;
type PostageTransaction<T> = contract.AssembledTransaction<PostageResult<T>>;

/** Typed contract surface generated from the Postage contract spec. */
export interface PostageContractClient extends contract.Client {
  initialize(args: {
    asset: string;
    treasury: string;
    minimum: bigint;
    fee_bps: number;
    expiry_seconds: bigint;
    dispute_seconds: bigint;
  }): Promise<PostageTransaction<void>>;
  configure_guard(args: { guard: string }): Promise<PostageTransaction<void>>;
  guard(args: Record<string, never>): Promise<PostageTransaction<string>>;
  config(args: Record<string, never>): Promise<PostageTransaction<EscrowConfig>>;
  minimum(args: Record<string, never>): Promise<PostageTransaction<bigint>>;
  quote(args: { sender_trusted: boolean }): Promise<PostageTransaction<bigint>>;
  submit(args: {
    message_id: Buffer;
    sender: string;
    recipient: string;
    amount: bigint;
  }): Promise<PostageTransaction<Postage>>;
  settle(args: { message_id: Buffer }): Promise<PostageTransaction<Postage>>;
  refund(args: { message_id: Buffer }): Promise<PostageTransaction<Postage>>;
  dispute(args: { message_id: Buffer }): Promise<PostageTransaction<Postage>>;
  expire(args: { message_id: Buffer }): Promise<PostageTransaction<Postage>>;
  reclaim(args: { message_id: Buffer }): Promise<PostageTransaction<Postage>>;
  get(args: { message_id: Buffer }): Promise<PostageTransaction<Postage>>;
}

/** Map a contract error code to an actionable PostageError variant. */
export function parsePostageError(code: number): PostageError | undefined {
  return Object.values(PostageError).includes(code as PostageError)
    ? (code as PostageError)
    : undefined;
}

/** Typed Soroban contract client for the Postage contract. */
export function createPostageClient(opts: PostageClientOptions): PostageContractClient {
  return new contract.Client(new contract.Spec(SPEC_ENTRIES), {
    contractId: opts.contractId,
    networkPassphrase: opts.networkPassphrase,
    rpcUrl: opts.rpcUrl,
    ...(opts.publicKey ? { publicKey: opts.publicKey } : {}),
    ...(opts.signer
      ? {
          signTransaction: async (xdrString: string, signOpts?: { networkPassphrase?: string }) => {
            const kp = Keypair.fromSecret(opts.signer!);
            const networkPassphrase = signOpts?.networkPassphrase ?? opts.networkPassphrase;
            const tx = new Transaction(xdrString, networkPassphrase);
            tx.sign(kp);
            return {
              signedTxXdr: tx.toXDR(),
              signerAddress: kp.publicKey(),
            };
          },
        }
      : {}),
  }) as PostageContractClient;
}

// ---------------------------------------------------------------------------
// Typed call helpers
// These wrap contract.Client to provide typed args and return values.
// For Result-returning methods, call .isOk() / .isErr() on the return value.
// Use the contract Error enum to identify specific errors via .unwrapErr().message.
// ---------------------------------------------------------------------------

export async function initialize(
  client: PostageContractClient,
  asset: string,
  treasury: string,
  minimum: bigint,
  fee_bps: number,
  expiry_seconds: bigint,
  dispute_seconds: bigint,
): Promise<contract.Ok<void> | contract.Err<{ message: string }>> {
  const tx = await client.initialize({
    asset,
    treasury,
    minimum,
    fee_bps,
    expiry_seconds,
    dispute_seconds,
  });
  return tx.result;
}

export async function configureGuard(
  client: PostageContractClient,
  guard: string,
): Promise<contract.Ok<void> | contract.Err<{ message: string }>> {
  const tx = await client.configure_guard({ guard });
  return tx.result;
}

export async function guard(
  client: PostageContractClient,
): Promise<contract.Ok<string> | contract.Err<{ message: string }>> {
  const tx = await client.guard({});
  return tx.result;
}

export async function config(
  client: PostageContractClient,
): Promise<contract.Ok<EscrowConfig> | contract.Err<{ message: string }>> {
  const tx = await client.config({});
  return tx.result;
}

export async function minimum(
  client: PostageContractClient,
): Promise<contract.Ok<bigint> | contract.Err<{ message: string }>> {
  const tx = await client.minimum({});
  return tx.result;
}

export async function quote(
  client: PostageContractClient,
  sender_trusted: boolean,
): Promise<contract.Ok<bigint> | contract.Err<{ message: string }>> {
  const tx = await client.quote({ sender_trusted });
  return tx.result;
}

export async function submit(
  client: PostageContractClient,
  message_id: Buffer,
  sender: string,
  recipient: string,
  amount: bigint,
): Promise<contract.Ok<Postage> | contract.Err<{ message: string }>> {
  const tx = await client.submit({ message_id, sender, recipient, amount });
  return tx.result;
}

export async function settle(
  client: PostageContractClient,
  message_id: Buffer,
): Promise<contract.Ok<Postage> | contract.Err<{ message: string }>> {
  const tx = await client.settle({ message_id });
  return tx.result;
}

export async function refund(
  client: PostageContractClient,
  message_id: Buffer,
): Promise<contract.Ok<Postage> | contract.Err<{ message: string }>> {
  const tx = await client.refund({ message_id });
  return tx.result;
}

export async function dispute(
  client: PostageContractClient,
  message_id: Buffer,
): Promise<contract.Ok<Postage> | contract.Err<{ message: string }>> {
  const tx = await client.dispute({ message_id });
  return tx.result;
}

export async function expire(
  client: PostageContractClient,
  message_id: Buffer,
): Promise<contract.Ok<Postage> | contract.Err<{ message: string }>> {
  const tx = await client.expire({ message_id });
  return tx.result;
}

export async function reclaim(
  client: PostageContractClient,
  message_id: Buffer,
): Promise<contract.Ok<Postage> | contract.Err<{ message: string }>> {
  const tx = await client.reclaim({ message_id });
  return tx.result;
}

export async function get(
  client: PostageContractClient,
  message_id: Buffer,
): Promise<contract.Ok<Postage> | contract.Err<{ message: string }>> {
  const tx = await client.get({ message_id });
  return tx.result;
}
