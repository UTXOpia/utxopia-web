"use client";

import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";

export interface AmountFieldProps {
  /** Display value as a decimal string (e.g. "0.001"). */
  value: string;
  onChange: (next: string) => void;
  /** Number of decimals in the underlying base unit (sats=8, USDC=6, etc). */
  decimals: number;
  /** Display unit shown next to the amount when there is no `tokenSelector`. */
  unit?: string;
  /** Total available in base units (sats / minor units). Unused with `onMax`. */
  availableBaseUnits?: bigint;
  /** Subtracted from availableBaseUnits when "Max" is pressed. */
  feeBufferBaseUnits?: bigint;
  /** Fills the field with the caller's own maximum, for flows that reserve
   *  gas or dust themselves rather than from a plain base-unit balance. */
  onMax?: () => void;
  /** Balance shown beside the Amount label; a node so callers can shimmer it. */
  availableLabel?: React.ReactNode;
  /** Which balance `availableLabel` refers to — deposits spend a public one. */
  balanceLabel?: string;
  /** USD value of one whole unit (used for the "≈ $X" preview). */
  usdPerUnit: number | null;
  placeholder?: string;
  testId?: string;
  /**
   * Asset picker rendered inside the field, replacing the static unit. Amount
   * and asset are one decision; splitting them across two rows states the same
   * asset twice and only makes one of them interactive.
   */
  tokenSelector?: React.ReactNode;
  /** Trailing caption, e.g. which balance the amount is spent from. */
  hint?: string;
  className?: string;
}

const VALID_DECIMAL = /^[0-9]*\.?[0-9]*$/;

function baseUnitsToDecimal(base: bigint, decimals: number): string {
  if (decimals === 0) return base.toString();
  const s = base.toString().padStart(decimals + 1, "0");
  const intPart = s.slice(0, -decimals);
  const fracPart = s.slice(-decimals).replace(/0+$/, "");
  return fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
}

function decimalToFloat(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function AmountField({
  value,
  onChange,
  decimals,
  unit,
  availableBaseUnits = 0n,
  feeBufferBaseUnits = 0n,
  onMax,
  availableLabel,
  balanceLabel = "Balance",
  usdPerUnit,
  tokenSelector,
  hint,
  placeholder = "0",
  testId,
  className,
}: AmountFieldProps) {
  const inputId = useId();
  const usdPreview = useMemo(() => {
    if (usdPerUnit == null) return null;
    const v = decimalToFloat(value);
    if (v <= 0) return null;
    const usd = v * usdPerUnit;
    return usd > 0 ? `≈ $${usd.toFixed(2)}` : null;
  }, [value, usdPerUnit]);

  const onMaxClick = () => {
    if (onMax) return onMax();
    const usable =
      availableBaseUnits > feeBufferBaseUnits
        ? availableBaseUnits - feeBufferBaseUnits
        : 0n;
    onChange(baseUnitsToDecimal(usable, decimals));
  };

  const handleChange = (raw: string) => {
    if (!VALID_DECIMAL.test(raw)) return; // reject — caller stays at last valid
    onChange(raw);
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      {/* Max belongs to the balance, not the amount — and keeping it out of the
          field leaves room for the asset picker on a phone-width row. */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <label htmlFor={inputId}>Amount</label>
        <div className="flex min-w-0 items-center gap-2">
          {availableLabel && (
            <span className="min-w-0 truncate text-right">
              {balanceLabel}: <span className="font-mono text-foreground/80">{availableLabel}</span>
            </span>
          )}
          <button
            type="button"
            onClick={onMaxClick}
            className="shrink-0 text-xs px-2 py-1 rounded bg-privacy/10 text-privacy hover:bg-privacy/15"
          >
            Max
          </button>
        </div>
      </div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg pr-2",
          "bg-muted/40 border border-gray/15",
          "focus-within:ring-2 focus-within:ring-privacy/40",
        )}
      >
        <input
          id={inputId}
          data-testid={testId}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm font-mono outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        {tokenSelector ?? (
          <span className="shrink-0 pr-1 text-xs text-muted-foreground">{unit}</span>
        )}
      </div>
      {(usdPreview || hint) && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {usdPreview && <span>{usdPreview}</span>}
          {usdPreview && hint && <span aria-hidden>·</span>}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}
