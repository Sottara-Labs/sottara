import { checkDeviceLimit } from "@/server/api/abuse-service";
import type { ApiContext } from "@/server/api/context";
import type { RegistrationRequest } from "@/features/identity/registration";

export interface RegisterOptions {
  inviteCodeRequired?: boolean;
  validInviteCodes?: string[];
}

export class DeviceLimitError extends Error {
  code = "device_limit_exceeded" as const;
  constructor(message = "Too many registrations from this device.") {
    super(message);
    this.name = "DeviceLimitError";
  }
}

export async function registerWithPassword(
  context: ApiContext,
  body: RegistrationRequest,
  ip: string,
  deviceFingerprint: string = "unknown",
  options: RegisterOptions = {},
): Promise<{ userId: string }> {
  // Enforce the per-device signup limit before creating any account.
  // The fingerprint is collected at the route layer and must be honored here.
  const deviceAllowed = await checkDeviceLimit(deviceFingerprint);
  if (!deviceAllowed) {
    throw new DeviceLimitError();
  }

  // BETA-079: invite code enforcement
  if (options.inviteCodeRequired) {
    const providedCode = body.inviteCode;
    const validCodes = options.validInviteCodes ?? [];
    if (!providedCode || !validCodes.includes(providedCode)) {
      throw new Error("invalid_invite_code");
    }
  }

  // Persist the new account through the context's user repository.
  const user = await context.users.createWithPassword({
    email: body.email,
    password: body.password,
    displayName: body.displayName,
    deviceFingerprint,
    ip,
  });

  return { userId: user.id };
}
