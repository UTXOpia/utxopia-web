"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, LogIn, LogOut, Mail, X, Eye, Upload, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrivySolanaAuthority } from "@/lib/privy-solana-context";
import { VaultSetup } from "@/components/vault/vault-setup";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

export interface AuthState {
  error: string | null;
  onViewOnlyLogin?: (viewingKey: string) => void;
  /** Restore spending keys from a recovery file. Rejects with a user-facing
   *  message, which the modal shows next to the picker. */
  onImportBackup?: (fileContents: string) => Promise<void>;
}

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  auth: AuthState;
}

/**
 * Monochrome provider marks. Privy's own window carries the branded versions;
 * these only have to say "these are the ways in" at a glance, and a row of
 * full-colour logos would outshout every other option in the list.
 */
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 10.9v3.4h4.8c-.2 1.3-1.6 3.7-4.8 3.7a5.6 5.6 0 0 1 0-11.2c1.7 0 2.9.8 3.5 1.4l2.4-2.3A8.6 8.6 0 0 0 12 3.4a8.6 8.6 0 1 0 0 17.2c5 0 8.3-3.5 8.3-8.4 0-.6-.1-1-.2-1.3H12z" />
    </svg>
  );
}

function FarcasterMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M4.8 3h14.4v2.7h-2.1v12.6h2.1V21h-5.6v-2.7h1.3v-4.9a3 3 0 0 0-6 0v4.9h1.3V21H4.8v-2.7h2.1V5.7H4.8V3z" />
    </svg>
  );
}

export function AuthModal({ open, onOpenChange, auth }: AuthModalProps) {
  const { error, onViewOnlyLogin, onImportBackup } = auth;
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const isLoading = importing;
  const [showViewOnly, setShowViewOnly] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showEnvelopeSetup, setShowEnvelopeSetup] = useState(false);

  // Read straight from the context rather than through AuthState: the default
  // is a no-op authority, so every caller of this modal keeps working without
  // learning about a provider they may not have configured.
  const privy = usePrivySolanaAuthority();
  const clearKeys = useUTXOpiaStore((s) => s.clearKeys);
  const [awaitingLogin, setAwaitingLogin] = useState(false);

  // login() only opens a window; there is no promise to await. So the click
  // records that we are waiting, and the session turning authenticated is what
  // carries the member onward — otherwise they log in and land back here.
  useEffect(() => {
    if (awaitingLogin && privy.authenticated) {
      setAwaitingLogin(false);
      setShowEnvelopeSetup(true);
    }
  }, [awaitingLogin, privy.authenticated]);
  const [viewingKeyInput, setViewingKeyInput] = useState("");

  const handleImport = async (file: File | undefined) => {
    if (!file || !onImportBackup) return;
    setImporting(true);
    setImportError(null);
    try {
      await onImportBackup(await file.text());
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "Could not read this recovery file.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 animate-in fade-in-0 duration-200" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "w-[90vw] max-w-[400px] rounded-[20px]",
            "bg-card/95 backdrop-blur-xl border border-gray/20",
            "shadow-[0_0_80px_rgba(255,255,255,0.04),0_0_160px_rgba(153,69,255,0.04)]",
            "animate-in fade-in-0 zoom-in-95 duration-200",
            "focus:outline-none",
          )}
        >
          {/* Close */}
          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 p-1.5 rounded-full bg-gray/10 hover:bg-gray/20 text-gray transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </Dialog.Close>

          {/* Header */}
          <div className="pt-8 pb-2 px-6 text-center">
            <div className="inline-flex mb-4">
              <img src="/brand/logo-transparent-96.png" alt="UTXOpia" className="w-20 h-20 object-contain" />
            </div>
            <Dialog.Title className="text-[20px] font-bold text-foreground mb-1">
              Sign In
            </Dialog.Title>
            <Dialog.Description className="text-body2 text-gray">
              Choose how to access your private vault
            </Dialog.Description>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-6 mt-3 px-3 py-2 rounded-[8px] bg-red-500/10 border border-red-500/20">
              <p className="text-caption text-red-400 text-center">{error}</p>
            </div>
          )}

          {/* Options */}
          <div className="p-6 space-y-3">
            {/* Create or restore. The only way in where forgetting a
                passphrase or losing a device is recoverable without us, which
                is why it is the one the other rows now lead to. */}
            {showEnvelopeSetup ? (
              <div className="flex flex-col gap-3">
                <VaultSetup
                  onDone={() => {
                    setShowEnvelopeSetup(false);
                    onOpenChange(false);
                  }}
                  onBack={() => setShowEnvelopeSetup(false)}
                />

                {/* Signing in and then landing here with no way back is how
                    somebody on the wrong account gets stuck: the rows behind
                    this are gone, and the only other exit was Settings, which
                    means closing the modal to find it. */}
                {privy.enabled && privy.authenticated && (
                  <div className="flex items-center justify-between gap-3 border-t border-gray/10 pt-3">
                    <span className="min-w-0 truncate text-caption text-gray/60">
                      Signed in as{" "}
                      <span className="text-gray-light">{privy.accountLabel ?? "your account"}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        clearKeys();
                        setShowEnvelopeSetup(false);
                        void privy.logout();
                      }}
                      className="flex shrink-0 items-center gap-1.5 text-caption text-gray/50 hover:text-foreground transition-colors cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
              {/* Signing in proves nothing about a vault on its own — nothing
                  is stored on our side to look one up with — so this leads to
                  the same create-or-restore flow as the row below it, with the
                  login already done so this browser can be remembered. */}
              {privy.enabled && (
                <button
                  onClick={() => {
                    if (privy.authenticated) return setShowEnvelopeSetup(true);
                    setAwaitingLogin(true);
                    void privy.login();
                  }}
                  disabled={isLoading || awaitingLogin}
                  className={cn(
                    "w-full flex items-center gap-4 p-4 rounded-[14px]",
                    "bg-privacy/8 hover:bg-privacy/15 border border-privacy/15",
                    "hover:border-privacy/30 disabled:opacity-40",
                    "transition-all duration-200 cursor-pointer group",
                    "hover:shadow-[0_0_24px_rgba(255,255,255,0.06)]",
                  )}
                >
                  <div className="p-2.5 rounded-[10px] bg-privacy/12 group-hover:bg-privacy/20 transition-colors shrink-0">
                    <LogIn className="w-5 h-5 text-privacy" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <p className="text-body2-semibold text-privacy">
                      {awaitingLogin ? "Waiting for sign in\u2026" : "Sign in with"}
                    </p>
                    {/* Under the title, not floating below the row: signing in
                        does not find a vault — nothing is kept on our side to
                        look one up with — and a member expecting one has been
                        misled by the time they are staring at a passphrase. */}
                    <p className="text-caption text-gray mt-0.5">
                      Then create or restore your vault
                    </p>
                  </div>
                  {!awaitingLogin && (
                    <span className="flex items-center gap-2 text-gray-light/70 shrink-0">
                      <FarcasterMark className="w-4 h-4" />
                      <GoogleMark className="w-4 h-4" />
                      <Mail className="w-4 h-4" aria-hidden />
                    </span>
                  )}
                </button>
              )}

              <button
                onClick={() => setShowEnvelopeSetup(true)}
                disabled={isLoading}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-[14px]",
                  "bg-privacy/8 hover:bg-privacy/15 border border-privacy/15",
                  "hover:border-privacy/30 disabled:opacity-40",
                  "transition-all duration-200 cursor-pointer text-left group",
                )}
              >
                <div className="p-2.5 rounded-[10px] bg-privacy/12 group-hover:bg-privacy/20 transition-colors shrink-0">
                  <ShieldCheck className="w-5 h-5 text-privacy" />
                </div>
                <div className="text-left min-w-0">
                  <p className="text-body2-semibold text-foreground">
                    Vault with recovery string
                  </p>
                  <p className="text-caption text-gray mt-0.5">
                    Works on any device you can reach
                  </p>
                </div>
              </button>

            {/* Folded rather than dropped.
             *
             * The passkey and wallet rows are the pre-envelope paths: they
             * derive the identity from the factor, so the factor *is* the
             * account and losing it loses the account. Nothing upgrades those
             * identities yet — adoptExistingSeed exists and nothing calls it —
             * so deleting the rows would strand whoever is still on one, with
             * their funds visible to nobody including them.
             *
             * The other two open something real but are not how anybody
             * arrives: one wants a viewing key already in hand, the other a
             * file. Between them they cost every first-time reader four rows of
             * choice they cannot act on.
             */}
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className="w-full flex items-center justify-center gap-1 py-1 text-caption text-gray/45 hover:text-gray-light transition-colors cursor-pointer"
            >
              Other ways in
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showMore && "rotate-180")} />
            </button>

            {showMore && (
              <>
            {/* View Only */}
            {!showViewOnly ? (
              <button
                onClick={() => setShowViewOnly(true)}
                disabled={isLoading}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-[14px]",
                  "bg-btc/8 hover:bg-btc/15 border border-btc/15",
                  "hover:border-btc/30 disabled:opacity-40",
                  "transition-all duration-200 cursor-pointer group",
                  "hover:shadow-[0_0_24px_rgba(245,158,11,0.08)]",
                )}
              >
                <div className="p-2.5 rounded-[10px] bg-btc/12 group-hover:bg-btc/20 transition-colors shrink-0">
                  <Eye className="w-5 h-5 text-btc" />
                </div>
                <div className="text-left min-w-0">
                  <p className="text-body2-semibold text-btc">
                    View Only
                  </p>
                  <p className="text-caption text-gray mt-0.5">
                    View balances and activity. Cannot send funds.
                  </p>
                </div>
              </button>
            ) : (
              <div className="p-4 rounded-[14px] bg-btc/8 border border-btc/15 space-y-3">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-btc shrink-0" />
                  <span className="text-body2-semibold text-btc">View Only Mode</span>
                </div>
                <p className="text-caption text-gray">
                  A viewing key can reveal private balances and activity, but it cannot sign transactions or move funds. Keep it private.
                </p>
                <label htmlFor="viewing-key-input" className="sr-only">
                  Viewing key
                </label>
                <input
                  id="viewing-key-input"
                  type="text"
                  value={viewingKeyInput}
                  onChange={(e) => setViewingKeyInput(e.target.value.trim())}
                  placeholder="Paste viewing key (192 hex chars)"
                  className={cn(
                    "w-full px-3 py-2 bg-muted border border-gray/20 rounded-[8px]",
                    "text-caption font-mono text-foreground placeholder:text-gray",
                    "outline-none focus:border-btc/40 transition-colors"
                  )}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (viewingKeyInput && onViewOnlyLogin) {
                        onViewOnlyLogin(viewingKeyInput);
                      }
                    }}
                    disabled={!viewingKeyInput}
                    className={cn(
                      "flex-1 px-3 py-2 rounded-[8px]",
                      "bg-btc hover:bg-btc/80 text-background",
                      "disabled:bg-gray/30 disabled:text-gray disabled:cursor-not-allowed",
                      "transition-colors text-caption cursor-pointer"
                    )}
                  >
                    Enter
                  </button>
                  <button
                    onClick={() => { setShowViewOnly(false); setViewingKeyInput(""); }}
                    className="px-3 py-2 rounded-[8px] bg-gray/20 hover:bg-gray/30 text-gray-light text-caption transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Restore from recovery file — one click to the picker, with the
                session-only caveat stated before the click, not after. */}
            {onImportBackup && (
              <>
                <label
                  className={cn(
                    "w-full flex items-center gap-4 p-4 rounded-[14px]",
                    "bg-gray/8 hover:bg-gray/15 border border-gray/15",
                    "hover:border-gray/30 transition-all duration-200 group",
                    isLoading ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <div className="p-2.5 rounded-[10px] bg-gray/12 group-hover:bg-gray/20 transition-colors shrink-0">
                    <Upload className="w-5 h-5 text-gray-light" />
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-body2-semibold text-gray-light">
                      {importing ? "Restoring..." : "Restore from Backup File"}
                    </p>
                    <p className="text-caption text-gray mt-0.5">
                      Unlocks this session only. Keep the file to sign in again.
                    </p>
                  </div>
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    disabled={isLoading}
                    onChange={(e) => { void handleImport(e.target.files?.[0]); e.target.value = ""; }}
                  />
                </label>
                {importError && (
                  <p className="px-1 text-caption text-red-400">{importError}</p>
                )}
              </>
            )}
              </>
            )}
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
