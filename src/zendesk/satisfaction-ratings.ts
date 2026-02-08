import { pool } from '../db';
import { paginate } from './client';
import { getLastSyncTime, setLastSyncTime } from '../sync/state';
import { config } from '../config';

interface ZendeskSatisfactionRating {
  id: number;
  ticket_id: number;
  score: string;
  comment: string | null;
  assignee_id: number | null;
  group_id: number | null;
  created_at: string;
}

export async function syncSatisfactionRatings(): Promise<number> {
  console.log('Syncing satisfaction ratings...');

  let startTime = await getLastSyncTime('satisfaction_ratings');
  const params: Record<string, string> = {};

  if (startTime === null) {
    const backfillDate = new Date();
    backfillDate.setMonth(backfillDate.getMonth() - config.sync.backfillMonths);
    startTime = Math.floor(backfillDate.getTime() / 1000);
    console.log(`  Initial backfill from ${backfillDate.toISOString()}`);
  } else {
    console.log(`  Incremental from ${new Date(startTime * 1000).toISOString()}`);
  }

  params.start_time = startTime.toString();

  let count = 0;
  let latestCreatedAt = startTime;

  for await (const ratings of paginate<ZendeskSatisfactionRating>(
    '/api/v2/satisfaction_ratings.json',
    'satisfaction_ratings',
    params
  )) {
    for (const r of ratings) {
      await pool.query(
        `INSERT INTO satisfaction_ratings (id, ticket_id, score, comment, assignee_id, group_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           score = $3, comment = $4, assignee_id = $5, group_id = $6, created_at = $7`,
        [r.id, r.ticket_id, r.score, r.comment, r.assignee_id, r.group_id, r.created_at]
      );

      const createdEpoch = Math.floor(new Date(r.created_at).getTime() / 1000);
      if (createdEpoch > latestCreatedAt) {
        latestCreatedAt = createdEpoch;
      }

      count++;
    }

    console.log(`  Processed ${count} ratings so far...`);
  }

  await setLastSyncTime('satisfaction_ratings', latestCreatedAt);
  console.log(`  Synced ${count} satisfaction ratings total.`);
  return count;
}
