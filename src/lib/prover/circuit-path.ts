export function resolveCircuitPath(configuredUrl?: string): string {
  const base = configuredUrl?.trim().replace(/\/+$/, "");
  if (!base) return "/circuits/groth16";
  if (base.endsWith("/groth16")) return base;
  if (base.endsWith("/circuits")) return `${base}/groth16`;
  return `${base}/circuits/groth16`;
}
