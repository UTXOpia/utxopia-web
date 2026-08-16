"use client";

// The passphrase is the only lock on the recovery string, and the string is the
// only way to a new device. So this field does two jobs a plain password input
// does not: it offers a strong one rather than asking for it, and it says how
// long what the member typed would take to guess, in the units they care about.

import { useMemo, useState } from "react";
import { Dices, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_PASSPHRASE_LENGTH } from "@/lib/vault-identity";

// Short, unambiguous, easy to read back off a screen.
//
// Exactly 128 words, so each contributes 7 bits and `% WORDS.length` over a
// uint32 carries no modulo bias — 2^32 divides evenly by 128. Eight words is 56
// bits. The string is copied out of a password manager rather than typed, so
// length here is nearly free, while the attacker this defends against already
// holds the ciphertext and can spend as long as they like. The list length is
// load-bearing: adding a word without adjusting the count reintroduces bias and
// quietly changes the entropy this file claims, so a test asserts both.
export const WORDS = [
  "amber", "anchor", "apple", "arrow", "autumn", "badge", "basin", "beacon",
  "birch", "bison", "bloom", "bramble", "bridge", "bronze", "candle", "canyon",
  "cedar", "cinder", "clover", "cobalt", "comet", "copper", "coral", "cotton",
  "crater", "cricket", "crimson", "dagger", "dahlia", "dapple", "dawn", "delta",
  "dune", "ember", "falcon", "fathom", "fennel", "fern", "flint", "forest",
  "fossil", "garnet", "glacier", "granite", "harbor", "hazel", "heron", "hollow",
  "indigo", "ivory", "jasper", "juniper", "kettle", "lantern", "larch", "linen",
  "lunar", "maple", "marble", "meadow", "mesa", "minnow", "monsoon", "moss",
  "nectar", "nimbus", "oakum", "ochre", "onyx", "opal", "orchard", "osprey",
  "pebble", "pepper", "pewter", "pigeon", "pilot", "pinion", "plover", "pollen",
  "quarry", "quartz", "quiver", "raven", "reef", "ridge", "rill", "rustic",
  "sable", "saffron", "sage", "sandbar", "sequoia", "shale", "sierra", "silver",
  "sorrel", "spruce", "stellar", "sumac", "summit", "tallow", "tamarind", "teal",
  "thicket", "thistle", "timber", "topaz", "trellis", "tundra", "umber", "vellum",
  "verbena", "vessel", "willow", "windrow", "yarrow", "zenith",
  "alcove", "brine", "cobble", "drift", "elder", "fjord", "gully", "harvest",
  "kelp", "lichen",
];

export const WORD_COUNT = WORDS.length;
export const GENERATED_WORD_COUNT = 8;

/**
 * Drawn without replacement — log2(128·127·…·121) ≈ 55.8 bits, so the entropy
 * cost against drawing with replacement is under a fifth of a bit. What it buys
 * is that the meter and the generator agree: a repeated word is a real signal
 * of a hand-picked passphrase, and a member should never be handed one that
 * their own strength read-out then marks down.
 */
export function generatePassphrase(): string {
  const chosen: string[] = [];
  while (chosen.length < GENERATED_WORD_COUNT) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    const word = WORDS[n % WORD_COUNT];
    if (!chosen.includes(word)) chosen.push(word);
  }
  return chosen.join(" ");
}

/**
 * Estimate the guessing entropy, and say what it buys.
 *
 * Counting words and character classes was worse than useless here: it rated
 * "my dog loves cheese" and "aaaaaaaaaaaaaaaaaaa1" as strong, on the one screen
 * where over-reporting costs a member their funds. This scores against the same
 * measure the generator is built on, gives unknown words a deliberately modest
 * allowance, and charges nothing for repeats.
 */
export function estimateBits(passphrase: string): number {
  const trimmed = passphrase.trim();
  if (!trimmed) return 0;

  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const unique = [...new Set(tokens)];
  const listed = new Set(WORDS);

  // A word off the list is worth its share of the list; anything else is
  // treated as a short unpredictable run, not as free entropy.
  let bits = unique.reduce(
    (sum, token) => sum + (listed.has(token) ? Math.log2(WORD_COUNT) : Math.min(12, token.length * 2)),
    0,
  );
  // A single long run of characters with no spaces: credit variety, modestly.
  if (unique.length === 1) {
    const variety =
      Number(/[a-z]/.test(trimmed)) +
      Number(/[A-Z]/.test(trimmed)) +
      Number(/[0-9]/.test(trimmed)) +
      Number(/[^a-zA-Z0-9]/.test(trimmed));
    const distinct = new Set(trimmed).size;
    bits = Math.min(bits, distinct * variety * 1.5);
  }
  return bits;
}

function strengthOf(passphrase: string): { label: string; tone: "weak" | "fair" | "strong"; hint: string } {
  const trimmed = passphrase.trim();
  if (trimmed.length < MIN_PASSPHRASE_LENGTH) {
    return {
      label: "Too short",
      tone: "weak",
      hint: `At least ${MIN_PASSPHRASE_LENGTH} characters.`,
    };
  }

  const bits = estimateBits(trimmed);
  if (bits >= 55) {
    return {
      label: "Strong",
      tone: "strong",
      hint: "Out of reach even for somebody holding your recovery string.",
    };
  }
  if (bits >= 40) {
    return {
      label: "Fair",
      tone: "fair",
      hint: "Holds up against most attackers. Add a word or two to be sure.",
    };
  }
  return {
    label: "Weak",
    tone: "weak",
    hint: "Guessable by anyone who gets your recovery string. Use Generate one.",
  };
}

interface PassphraseFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  autoFocus?: boolean;
  /** Confirming an existing passphrase — no generator, no strength meter. */
  verifyOnly?: boolean;
  disabled?: boolean;
}

export function PassphraseField({
  value,
  onChange,
  label = "Passphrase",
  autoFocus,
  verifyOnly,
  disabled,
}: PassphraseFieldProps) {
  const [visible, setVisible] = useState(false);
  const strength = useMemo(() => strengthOf(value), [value]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-1">
        <label htmlFor="vault-passphrase" className="text-[11px] uppercase tracking-wider text-gray/50 font-medium">
          {label}
        </label>
        {!verifyOnly && (
          <button
            type="button"
            onClick={() => onChange(generatePassphrase())}
            disabled={disabled}
            className="flex items-center gap-1 text-[11px] text-privacy/70 hover:text-privacy transition-colors cursor-pointer disabled:opacity-50"
          >
            <Dices className="h-3 w-3" />
            Generate one
          </button>
        )}
      </div>

      <div className="relative">
        <input
          id="vault-passphrase"
          type={visible ? "text" : "password"}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          autoComplete={verifyOnly ? "current-password" : "new-password"}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full rounded-[10px] border border-gray/20 bg-muted/40 px-3 py-2.5 pr-10",
            "font-mono text-body2 text-foreground placeholder:text-gray/35",
            "focus:border-privacy/50 focus:outline-none focus:ring-1 focus:ring-privacy/30",
            "disabled:opacity-50",
          )}
          placeholder={verifyOnly ? "Your passphrase" : "four unrelated words"}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide passphrase" : "Show passphrase"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-gray/40 hover:text-foreground transition-colors cursor-pointer"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {!verifyOnly && value.length > 0 && (
        <p className="flex items-baseline gap-2 px-1 text-[11px]">
          <span
            className={cn(
              "font-semibold",
              strength.tone === "strong" && "text-green-400",
              strength.tone === "fair" && "text-warning",
              strength.tone === "weak" && "text-red-400",
            )}
          >
            {strength.label}
          </span>
          <span className="text-gray/45">{strength.hint}</span>
        </p>
      )}
    </div>
  );
}
