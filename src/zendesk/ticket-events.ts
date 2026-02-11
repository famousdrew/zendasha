import { pool } from '../db';
import { incrementalExport } from './client';
import { getLastSyncTime, setLastSyncTime } from '../sync/state';
import { config } from '../config';

interface ChildEvent {
  field_name: string;
  value: string;
  previous_value: string;
}

interface TicketEvent {
  id: number;
  ticket_id: number;
  timestamp: string;
  child_events: ChildEvent[];
}

export async function syncFirstPendingTimes(): Promise<number> {
  console.log('Syncing first-pending times from ticket events...');

  let startTime = await getLastSyncTime('ticket_events');

  if (startTime === null) {
    const backfillDate = new Date();
    backfillDate.setMonth(backfillDate.getMonth() - config.sync.backfillMonths);
    startTime = Math.floor(backfillDate.getTime() / 1000);
    console.log(`  Initial backfill from ${backfillDate.toISOString()}`);
  } else {
    console.log(`  Incremental from ${new Date(startTime * 1000).toISOString()}`);
  }

  let count = 0;
  let pages = 0;
  let lastEndTime = startTime;

  for await (const { items, endTime } of incrementalExport<TicketEvent>(
    '/api/v2/incremental/ticket_events.json',
    'ticket_events',
    startTime,
    500 // throttle: 500ms between pages to avoid rate limits on this high-volume endpoint
  )) {
    for (const event of items) {
      const pendingChange = event.child_events?.find(
        (ce) => ce.field_name === 'status' && ce.value === 'pending'
      );

      if (pendingChange) {
        // Keep the earliest pending time per ticket
        await pool.query(
          `UPDATE tickets
           SET first_pending_at = $2
           WHERE id = $1 AND (first_pending_at IS NULL OR first_pending_at > $2)`,
          [event.ticket_id, event.timestamp]
        );
        count++;
      }
    }

    lastEndTime = endTime;
    pages++;
    if (pages % 50 === 0) {
      console.log(`  Page ${pages}: ${count} pending events found so far (cursor at ${new Date(endTime * 1000).toISOString()})...`);
    }
  }

  await setLastSyncTime('ticket_events', lastEndTime);
  console.log(`  Updated ${count} tickets with first_pending_at.`);
  return count;
}
