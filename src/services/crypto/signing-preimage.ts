/**
 * Domain-separated signature preimage.
 *
 * Prevents signature replay across different protocols, networks, or operations.
 *
 * Preimage format (v2):
 *
 *   preimage := version_prefix || field(domainTag) || field(version)
 *              || field(network) || field(operation) || field(canonicalPayload)

 *   field(x) := <utf-8 bytes of x> || <utf-8 bytes of len(x)>
 *
 * where len(x) is the decimal length of the UTF-8 byte sequence of x,
 * and the length is terminated by a colon (":"). The version_prefix is
 * the constant "SSOP1:" (Signing Separator Operation Preimage, version 1).
 *
 * Every field is length-prefixed, so delimiters that appear inside the
 * data (e.g. ":") cannot be confused with field boundaries. This prevents
 * forgery across (network, operation) splits of the same string.
 */

export const STEALTH_DOMAIN_TAG = "Stealth_Mail_Protocol";
export const STEALTH_PROTOCOL_VERSION = "v1";

// Preimage encoding format version. Distinct from the protocol version.
export const PREIMAGE_FORMAT_PREFIX = "SSOP1:";

export interface SignaturePreimageOptions {
  network: string;
  operation: string;
  version?: string;
}

const encoder = new TextEncoder();

function encodeField(value: string): string {
  const byteLength = encoder.encode(value).length;
  return `${byteLength}:${value}`;
}

/**
 * Builds a deterministic, domain-separated signature preimage byte array.
 * By incorporating the domain tag, network, protocol version, and operation,
 * we prevent cross-protocol and cross-network signature reuse attacks.
 */
export function buildSignaturePreimage(
  canonicalPayload: string,
  options: SignaturePreimageOptions,
): Uint8Array {
  const version = options.version ?? STEALTH_PROTOCOL_VERSION;

  const preimageStr =
    PRIIMAGE_FORMAT_PREFIX +
    encodeField(STEALTH_DOMAIN_TAG) +
    encodeField(version) +
    encodeField(options.network) +
    encodeField(options.operation) +
    encodeField(canonicalPayload);

  return encoder.encode(preimageStr);
}
