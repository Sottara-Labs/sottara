/**
 * Domain-separated signature preimage.
 *
 * Prevents signature replay across different protocols, networks, or operations.
 *
 * Format (`stealth-preimage-v2`):
 * `stealth-preimage-v2|<len>:<domainTag>|<len>:<version>|<len>:<network>|<len>:<operation>|<len>:<canonicalPayload>`
 * where `<len>` is the UTF-8 byte length of the field value that follows it.
 * The explicit length prefixes make the field boundaries unambiguous for any
 * input: the v1 format joined the fields with `:`, so `network="a:b",
 * operation="c"` and `network="a", operation="b:c"` produced byte-identical
 * preimages and domain separation could be crossed.
 */

export const STEALTH_DOMAIN_TAG = "Stealth_Mail_Protocol";
export const STEALTH_PROTOCOL_VERSION = "v1";

/** Marks the length-prefixed preimage encoding; bump when the format changes. */
export const STEALTH_PREIMAGE_FORMAT = "stealth-preimage-v2";

const encoder = new TextEncoder();

export interface SignaturePreimageOptions {
  network: string;
  operation: string;
  version?: string;
}

/** Encodes a field as `<utf8ByteLength>:<value>`. */
function encodeField(value: string): string {
  return `${encoder.encode(value).byteLength}:${value}`;
}

/**
 * Builds a deterministic, domain-separated signature preimage byte array.
 * Incorporating the domain tag, network, protocol version, and operation
 * prevents cross-protocol and cross-network signature reuse attacks, and the
 * length-prefixed fields keep the boundaries unambiguous for any input. See
 * the module header for the exact byte format.
 */
export function buildSignaturePreimage(
  canonicalPayload: string,
  options: SignaturePreimageOptions,
): Uint8Array {
  const version = options.version ?? STEALTH_PROTOCOL_VERSION;

  const preimageStr = [
    STEALTH_PREIMAGE_FORMAT,
    encodeField(STEALTH_DOMAIN_TAG),
    encodeField(version),
    encodeField(options.network),
    encodeField(options.operation),
    encodeField(canonicalPayload),
  ].join("|");

  return encoder.encode(preimageStr);
}
