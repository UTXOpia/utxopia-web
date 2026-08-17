import { describe, expect, it, afterEach } from "bun:test";
import { normalizeRelayUrlTemplate, getBuiltinRelaysSerializable } from "../relays";

const original = process.env.NEXT_PUBLIC_RELAY_URLS;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_RELAY_URLS;
  else process.env.NEXT_PUBLIC_RELAY_URLS = original;
});

describe("normalizeRelayUrlTemplate", () => {
  it("adds both placeholders to a bare URL", () => {
    expect(normalizeRelayUrlTemplate("https://relay.example/api/sol/relay"))
      .toBe("https://relay.example/api/sol/relay?network={network}&vault={vault}");
  });

  it("adds only the missing placeholder", () => {
    expect(normalizeRelayUrlTemplate("https://relay.example/r?network={network}"))
      .toBe("https://relay.example/r?network={network}&vault={vault}");
  });

  it("leaves a complete template alone", () => {
    const complete = "/api/sol/relay?network={network}&vault={vault}";
    expect(normalizeRelayUrlTemplate(complete)).toBe(complete);
  });
});

describe("getBuiltinRelaysSerializable", () => {
  it("keeps the same-origin relay when nothing is configured", () => {
    delete process.env.NEXT_PUBLIC_RELAY_URLS;
    const relays = getBuiltinRelaysSerializable("solana");
    expect(relays.map((r) => r.id)).toEqual(["default"]);
  });

  it("puts configured relays ahead of the built-in, so it stays as failover", () => {
    process.env.NEXT_PUBLIC_RELAY_URLS =
      "Docker relay|https://api-hybrid.example/api/sol/relay, https://second.example/r";
    const relays = getBuiltinRelaysSerializable("sol");
    expect(relays.map((r) => r.id)).toEqual(["env-0", "env-1", "default"]);
    expect(relays[0].name).toBe("Docker relay");
    expect(relays[0].urlTemplate)
      .toBe("https://api-hybrid.example/api/sol/relay?network={network}&vault={vault}");
    // Unnamed entries still get a label, since the picker shows one.
    expect(relays[1].name).toBe("Configured relay 2");
  });

  it("ignores empty entries and trailing commas", () => {
    process.env.NEXT_PUBLIC_RELAY_URLS = "https://one.example/r, ,";
    expect(getBuiltinRelaysSerializable("sol").map((r) => r.id)).toEqual(["env-0", "default"]);
  });
});
