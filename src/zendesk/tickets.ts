import { pool } from '../db';
import { incrementalExport } from './client';
import { getLastSyncTime, setLastSyncTime } from '../sync/state';
import { config } from '../config';

const LANGUAGE_TAGS: Record<string, string> = {
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  nl: 'Dutch',
  pt: 'Portuguese',
};

interface ZendeskTicket {
  id: number;
  brand_id: number;
  status: string;
  priority: string | null;
  assignee_id: number | null;
  group_id: number | null;
  tags: string[];
  subject: string;
  created_at: string;
  updated_at: string;
}

function extractLanguage(tags: string[]): { code: string | null; name: string | null } {
  for (const tag of tags) {
    if (LANGUAGE_TAGS[tag]) {
      return { code: tag, name: LANGUAGE_TAGS[tag] };
    }
  }
  return { code: null, name: null };
}

export async function syncTickets(): Promise<number> {
  console.log('Syncing tickets...');

  let startTime = await getLastSyncTime('tickets');

  if (startTime === null) {
    const backfillDate = new Date();
    backfillDate.setMonth(backfillDate.getMonth() - config.sync.backfillMonths);
    startTime = Math.floor(backfillDate.getTime() / 1000);
    console.log(`  Initial backfill from ${backfillDate.toISOString()}`);
  } else {
    console.log(`  Incremental from ${new Date(startTime * 1000).toISOString()}`);
  }

  let count = 0;
  let lastEndTime = startTime;

  for await (const { items, endTime } of incrementalExport<ZendeskTicket>(
    '/api/v2/incremental/tickets.json',
    'tickets',
    startTime
  )) {
    for (const ticket of items) {
      const { code, name } = extractLanguage(ticket.tags || []);

      await pool.query(
        `INSERT INTO tickets (id, brand_id, status, priority, assignee_id, group_id,
           tags, language_code, language_name, subject, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           brand_id = $2, status = $3, priority = $4, assignee_id = $5, group_id = $6,
           tags = $7, language_code = $8, language_name = $9, subject = $10,
           created_at = $11, updated_at = $12`,
        [
          ticket.id, ticket.brand_id, ticket.status, ticket.priority,
          ticket.assignee_id, ticket.group_id, ticket.tags,
          code, name, ticket.subject,
          ticket.created_at, ticket.updated_at,
        ]
      );
      count++;
    }

    lastEndTime = endTime;
    console.log(`  Processed ${count} tickets so far...`);
  }

  await setLastSyncTime('tickets', lastEndTime);
  console.log(`  Synced ${count} tickets total.`);
  return count;
}
