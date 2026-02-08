import { pool } from '../db';
import { paginate } from './client';

interface ZendeskTicketMetric {
  ticket_id: number;
  reply_time_in_minutes: { calendar: number | null; business: number | null } | null;
  full_resolution_time_in_minutes: { calendar: number | null; business: number | null } | null;
  agent_wait_time_in_minutes: { calendar: number | null } | null;
  requester_wait_time_in_minutes: { calendar: number | null } | null;
  first_resolution_time_in_minutes: { calendar: number | null } | null;
  reopens: number;
  replies: number;
  created_at: string;
}

export async function syncTicketMetrics(): Promise<number> {
  console.log('Syncing ticket metrics...');
  let count = 0;

  for await (const metrics of paginate<ZendeskTicketMetric>(
    '/api/v2/ticket_metrics.json',
    'ticket_metrics'
  )) {
    for (const m of metrics) {
      await pool.query(
        `INSERT INTO ticket_metrics (
           ticket_id, reply_time_calendar_minutes, reply_time_business_minutes,
           full_resolution_time_calendar_minutes, full_resolution_time_business_minutes,
           agent_wait_time_minutes, requester_wait_time_minutes,
           first_resolution_time_minutes, reopens, replies, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (ticket_id) DO UPDATE SET
           reply_time_calendar_minutes = $2, reply_time_business_minutes = $3,
           full_resolution_time_calendar_minutes = $4, full_resolution_time_business_minutes = $5,
           agent_wait_time_minutes = $6, requester_wait_time_minutes = $7,
           first_resolution_time_minutes = $8, reopens = $9, replies = $10, created_at = $11`,
        [
          m.ticket_id,
          m.reply_time_in_minutes?.calendar ?? null,
          m.reply_time_in_minutes?.business ?? null,
          m.full_resolution_time_in_minutes?.calendar ?? null,
          m.full_resolution_time_in_minutes?.business ?? null,
          m.agent_wait_time_in_minutes?.calendar ?? null,
          m.requester_wait_time_in_minutes?.calendar ?? null,
          m.first_resolution_time_in_minutes?.calendar ?? null,
          m.reopens,
          m.replies,
          m.created_at,
        ]
      );
      count++;
    }

    console.log(`  Processed ${count} ticket metrics so far...`);
  }

  console.log(`  Synced ${count} ticket metrics total.`);
  return count;
}
