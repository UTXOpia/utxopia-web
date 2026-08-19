"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Fingerprint, Mail, Wallet, X, Eye, Upload, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrivySolanaAuthority } from "@/lib/privy-solana-context";
import { VaultSetup } from "@/components/vault/vault-setup";

export interface AuthState {
  passkeySupported: boolean;
  hasPasskeyCredential: boolean;
  passkeyLoading: boolean;
  walletLoading: boolean;
  walletConnected: boolean;
  error: string | null;
  onPasskeyRegister: () => void;
  onPasskeyAuthenticate: () => void;
  onWalletConnect: () => void;
  onWalletDeriveKeys: () => void;
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
  const {
    passkeySupported, hasPasskeyCredential, passkeyLoading,
    walletLoading, walletConnected, error,
    onPasskeyRegister, onPasskeyAuthenticate,
    onWalletConnect, onWalletDeriveKeys, onViewOnlyLogin, onImportBackup,
  } = auth;
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const isLoading = passkeyLoading || walletLoading || importing;
  const [showViewOnly, setShowViewOnly] = useState(false);
  const [showEnvelopeSetup, setShowEnvelopeSetup] = useState(false);

  // Read straight from the context rather than through AuthState: the default
  // is a no-op authority, so every caller of this modal keeps working without
  // learning about a provider they may not have configured.
  const privy = usePrivySolanaAuthority();
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
              {error.includes("No saved key found") && passkeySupported && (
                <button
                  onClick={onPasskeyRegister}
                  disabled={isLoading}
                  className={cn(
                    "w-full mt-2 px-3 py-2 rounded-[8px]",
                    "bg-privacy/20 hover:bg-privacy/30 text-privacy",
                    "disabled:opacity-40 transition-colors text-caption font-semibold cursor-pointer",
                  )}
                >
                  Create New Passkey on This Device
                </button>
              )}
            </div>
          )}

          {/* Options */}
          <div className="p-6 space-y-3">
            {/* Envelope vault — create or restore. Offered above the legacy
                paths because it is the only one where forgetting a passphrase
                or losing a device is recoverable without us. */}
            {showEnvelopeSetup ? (
              <VaultSetup
                onDone={() => {
                  setShowEnvelopeSetup(false);
                  onOpenChange(false);
                }}
              />
            ) : (
              <>
              {/* Signing in proves nothing about a vault on its own — nothing
                  is stored on our side to look one up with — so this leads to
                  the same create-or-restore flow as the row below it, with the
                  login already done so this browser can be remembered. */}
              {privy.enabled && (
                <div className="space-y-1.5">
                  <button
                    onClick={() => {
                      if (privy.authenticated) return setShowEnvelopeSetup(true);
                      setAwaitingLogin(true);
                      void privy.login();
                    }}
                    disabled={isLoading || awaitingLogin}
                    className={cn(
                      "w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-[14px]",
                      "bg-muted/40 hover:bg-muted/70 border border-gray/15 hover:border-gray/25",
                      "disabled:opacity-40 transition-all duration-200 cursor-pointer",
                    )}
                  >
                    <span className="text-body2-semibold text-foreground">
                      {awaitingLogin ? "Waiting for sign in\u2026" : "Sign in with"}
                    </span>
                    {!awaitingLogin && (
                      <span className="flex items-center gap-2 text-gray-light">
                        <FarcasterMark className="w-4 h-4" />
                        <GoogleMark className="w-4 h-4" />
                        <Mail className="w-4 h-4" aria-hidden />
                      </span>
                    )}
                  </button>
                  {/* Under the row, not inside it: signing in does not find a
                      vault, and a member who expects one has been misled by the
                      time they are staring at a passphrase field. */}
                  <p className="text-center text-caption text-gray/45">
                    Then create or restore your vault
                  </p>
                </div>
              )}

              <button
                onClick={() => setShowEnvelopeSetup(true)}
                disabled={isLoading}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-[14px]",
                  "bg-privacy/8 hover:bg-privacy/15 border border-privacy/15",
                  "hover:border-privacy/30 disabled:opacity-40",
                  "transition-all duration-200 cursor-pointer text-left",
                )}
              >
                <ShieldCheck className="w-5 h-5 text-privacy shrink-0" aria-hidden />
                <span>
                  <span className="block text-body2-semibold text-foreground">
                    Vault with recovery string
                  </span>
                  <span className="block text-caption text-gray/60">
                    Works on any device you can reach
                  </span>
                </span>
              </button>

            {/* Passkey */}
            {passkeySupported && (
              <button
                onClick={
                  hasPasskeyCredential
                    ? onPasskeyAuthenticate
                    : onPasskeyRegister
                }
                disabled={isLoading}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-[14px]",
                  "bg-privacy/8 hover:bg-privacy/15 border border-privacy/15",
                  "hover:border-privacy/30 disabled:opacity-40",
                  "transition-all duration-200 cursor-pointer group",
                  "hover:shadow-[0_0_24px_rgba(255,255,255,0.06)]",
                )}
              >
                <div className="p-2.5 rounded-[10px] bg-privacy/12 group-hover:bg-privacy/20 transition-colors shrink-0">
                  <Fingerprint className="w-5 h-5 text-privacy" />
                </div>
                <div className="text-left min-w-0">
                  <p className="text-body2-semibold text-privacy">
                    {passkeyLoading
                      ? "Verifying..."
                      : hasPasskeyCredential
                        ? "Sign in with Passkey"
                        : "Create Passkey"}
                  </p>
                  <p className="text-caption text-gray mt-0.5">
                    Face ID, fingerprint, or device PIN
                  </p>
                </div>
              </button>
            )}

            {/* Wallet */}
            <button
              onClick={walletConnected ? onWalletDeriveKeys : onWalletConnect}
              disabled={isLoading}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-[14px]",
                "bg-purple/8 hover:bg-purple/15 border border-purple/15",
                "hover:border-purple/30 disabled:opacity-40",
                "transition-all duration-200 cursor-pointer group",
                "hover:shadow-[0_0_24px_rgba(153,69,255,0.08)]",
              )}
            >
              <div className="p-2.5 rounded-[10px] bg-purple/12 group-hover:bg-purple/20 transition-colors shrink-0">
                <Wallet className="w-5 h-5 text-purple" />
              </div>
              <div className="text-left min-w-0">
                <p className="text-body2-semibold text-purple">
                  {walletLoading
                    ? "Unlocking..."
                    : walletConnected
                      ? "Sign to Unlock"
                      : "Connect Solana Wallet"}
                </p>
                <p className="text-caption text-gray mt-0.5">
                  Connect and sign to derive your vault keys
                </p>
              </div>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-gray/15" />
              <span className="text-caption text-gray/40 uppercase tracking-widest text-[10px]">
                or
              </span>
              <div className="flex-1 h-px bg-gray/15" />
            </div>

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
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
