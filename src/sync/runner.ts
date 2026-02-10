import { syncBrands } from '../zendesk/brands';
import { syncGroups } from '../zendesk/groups';
import { syncAgents } from '../zendesk/agents';
import { syncTickets } from '../zendesk/tickets';
import { syncTicketMetrics } from '../zendesk/ticket-metrics';
import { syncSatisfactionRatings } from '../zendesk/satisfaction-ratings';
import { syncFirstPendingTimes } from '../zendesk/ticket-events';

interface SyncResult {
  entity: string;
  count: number;
  error?: string;
}

export async function runFullSync(): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const startTime = Date.now();

  console.log('=== Starting full sync ===\n');

  // Dimension tables first (order matters for data consistency)
  const dimSyncs = [
    { name: 'brands', fn: syncBrands },
    { name: 'groups', fn: syncGroups },
    { name: 'agents', fn: syncAgents },
  ];

  for (const { name, fn } of dimSyncs) {
    try {
      const count = await fn();
      results.push({ entity: name, count });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR syncing ${name}: ${message}`);
      results.push({ entity: name, count: 0, error: message });
    }
  }

  // Core tables
  const coreSyncs = [
    { name: 'tickets', fn: syncTickets },
    { name: 'ticket_metrics', fn: syncTicketMetrics },
    { name: 'satisfaction_ratings', fn: syncSatisfactionRatings },
    { name: 'ticket_events (first_pending_at)', fn: syncFirstPendingTimes },
  ];

  for (const { name, fn } of coreSyncs) {
    try {
      const count = await fn();
      results.push({ entity: name, count });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR syncing ${name}: ${message}`);
      results.push({ entity: name, count: 0, error: message });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Sync complete in ${elapsed}s ===`);

  for (const r of results) {
    const status = r.error ? `FAILED (${r.error})` : `${r.count} records`;
    console.log(`  ${r.entity}: ${status}`);
  }

  return results;
}
