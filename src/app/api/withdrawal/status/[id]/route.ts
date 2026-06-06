import { proxyToBackend } from "@/lib/api/backend-proxy";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToBackend(req, `/api/withdrawal/status/${encodeURIComponent(id)}`);
}
