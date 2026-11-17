const USER_AGENT = 'F1RainRadar (+https://github.com/; open-source fan project)';

export class HttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimum spacing between requests per host, to stay well inside free-tier rate limits. */
const HOST_SPACING_MS: Record<string, number> = {
  'api.jolpi.ca': 300,
  'api.openf1.org': 400,
  'api.open-meteo.com': 150,
  'archive-api.open-meteo.com': 150,
  'tilecache.rainviewer.com': 700,
};
const lastRequestAt = new Map<string, number>();

async function throttle(url: string) {
  const host = new URL(url).host;
  const spacing = HOST_SPACING_MS[host] ?? 0;
  const wait = (lastRequestAt.get(host) ?? 0) + spacing - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

/** fetch with throttling and exponential backoff on network errors, 429 and 5xx. */
export async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);
    await throttle(url);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return res;
      lastError = new HttpError(url, res.status);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function fetchJson(url: string): Promise<unknown> {
  return (await fetchWithRetry(url)).json();
}

export async function fetchBuffer(url: string): Promise<Buffer> {
  return Buffer.from(await (await fetchWithRetry(url)).arrayBuffer());
}
