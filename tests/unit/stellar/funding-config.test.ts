import { describe, expect, it } from "vitest";

import {
  DEFAULT_TESTNET_FRIENDBOT_URL,
  resolveStellarFundingConfig,
} from "@/services/stellar/funding-config";

describe("resolveStellarFundingConfig", () => {
  it("yields the default friendbot URL when STEALTH_TESTNET_FRIENDBOT_URL is unset", () => {
    expect(DEFAULT_TESTNET_FRIENDBOT_URL).toBe("https://friendbot.stellar.org");
    expect(resolveStellarFundingConfig()).toEqual({
      friendbotUrl: "https://friendbot.stellar.org",
    });
    expect(resolveStellarFundingConfig({})).toEqual({
      friendbotUrl: DEFAULT_TESTNET_FRIENDBOT_URL,
    });
  });

  it("returns explicit override value unchanged", () => {
    const customUrl = "https://custom-friendbot.stellar.org";
    const config = resolveStellarFundingConfig({
      STEALTH_TESTNET_FRIENDBOT_URL: customUrl,
    });
    expect(config).toEqual({
      friendbotUrl: customUrl,
    });
  });

  it("treats empty string as valid value under ?? semantics", () => {
    // Under nullish coalescing (??), empty string is not nullish and is preserved
    const config = resolveStellarFundingConfig({
      STEALTH_TESTNET_FRIENDBOT_URL: "",
    });
    expect(config).toEqual({
      friendbotUrl: "",
    });
  });

  it("returns an object containing only the friendbotUrl key", () => {
    const config = resolveStellarFundingConfig();
    expect(Object.keys(config)).toEqual(["friendbotUrl"]);
  });
});
