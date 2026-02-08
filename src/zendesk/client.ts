import { config } from '../config';

const BASE_URL = `https://${config.zendesk.subdomain}.zendesk.com`;
const AUTH_HEADER = `Basic ${Buffer.from(
  `${config.zendesk.email}/token:${config.zendesk.apiToken}`
).toString('base64')}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: AUTH_HEADER,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
    console.log(`  Rate limited. Retrying in ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return apiRequest<T>(url);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Zendesk API ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

function buildUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(path, BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Paginate through a standard Zendesk list endpoint.
 * Yields one page of items at a time.
 */
export async function* paginate<T>(
  path: string,
  dataKey: string,
  params?: Record<string, string>
): AsyncGenerator<T[]> {
  let nextPage: string | null = buildUrl(path, params);

  while (nextPage) {
    const data: Record<string, any> = await apiRequest(nextPage);
    const items = data[dataKey] as T[];
    if (items && items.length > 0) {
      yield items;
    }
    nextPage = data.next_page || null;
  }
}

/**
 * Paginate through a Zendesk incremental export endpoint.
 * Yields { items, endTime } per page. endTime is the cursor for the next sync.
 */
export async function* incrementalExport<T>(
  path: string,
  dataKey: string,
  startTime: number
): AsyncGenerator<{ items: T[]; endTime: number }> {
  let nextPage: string | null = buildUrl(path, {
    start_time: startTime.toString(),
  });

  while (nextPage) {
    const data: Record<string, any> = await apiRequest(nextPage);
    const items = data[dataKey] as T[];
    const endTime = data.end_time as number;
    const endOfStream = data.end_of_stream as boolean;

    if (items && items.length > 0) {
      yield { items, endTime };
    }

    if (endOfStream) {
      break;
    }

    nextPage = data.next_page || null;
  }
}

export { apiRequest, buildUrl, sleep };
