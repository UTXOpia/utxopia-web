/**
 * Solana Proof Relay API
 *
 * Chain-specific entrypoint for Solana JoinSplit relay submissions. The
 * implementation lives at /api/relay for backward compatibility with older
 * clients.
 */

export { POST, dynamic } from "../../relay/route";
