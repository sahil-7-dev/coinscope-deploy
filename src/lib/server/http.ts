export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Start of the upstream response body, for error details. */
    public body = "",
  ) {
    super(message);
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getJson<T>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json", ...opts.headers },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 500);
    throw new HttpError(res.status, `${res.status} ${res.statusText} from ${new URL(url).host}${new URL(url).pathname}`, body);
  }
  return (await res.json()) as T;
}

/** Converts any thrown error into a JSON error response for route handlers. */
export function errorResponse(err: unknown): Response {
  const message = err instanceof Error ? err.message : "Unexpected error";
  const status = err instanceof HttpError ? (err.status === 404 ? 404 : 502) : 500;
  console.error("[api]", message);
  return Response.json({ error: message }, { status });
}
