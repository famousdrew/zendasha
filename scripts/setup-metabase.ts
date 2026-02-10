import crypto from 'crypto';

const MB_URL = 'https://metabase-production-db36.up.railway.app';
const MB_EMAIL = 'dclark@workwelltech.com';
const MB_PASSWORD = 'iClark2003!';

let sessionToken = '';

// ── API helper ──────────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: any): Promise<any> {
  const res = await fetch(`${MB_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { 'X-Metabase-Session': sessionToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Metabase ${method} ${path}: ${res.status} ${text}`);
  }

  return res.json();
}

// ── Template tags helper ────────────────────────────────────────────────────

function tagsForQuery(sql: string): Record<string, any> {
  const tagDefs: Record<string, any> = {
    brand: { type: 'text', 'display-name': 'Brand' },
    language: { type: 'text', 'display-name': 'Language' },
    start_date: { type: 'date', 'display-name': 'Start Date' },
    end_date: { type: 'date', 'display-name': 'End Date' },
    agent: { type: 'text', 'display-name': 'Agent' },
    team: { type: 'text', 'display-name': 'Team' },
  };
  const tags: Record<string, any> = {};
  for (const [name, def] of Object.entries(tagDefs)) {
    if (sql.includes(`{{${name}}}`)) {
      tags[name] = { ...def, name, id: crypto.randomUUID() };
    }
  }
  return tags;
}

// ── Card definitions ────────────────────────────────────────────────────────

interface CardDef {
  name: string;
  sql: string;
  display: string;
  vizSettings?: Record<string, any>;
}

interface LayoutItem {
  row: number;
  col: number;
  size_x: number;
  size_y: number;
}

// ── Global exclusions ───────────────────────────────────────────────────────
// Hide automated/non-agent work: csops and sales tagged tickets, csops brand/user

// No alias
const EXCL = `
  AND NOT ('csops' = ANY(tags)) AND NOT ('sales' = ANY(tags))
  AND brand_id NOT IN (SELECT id FROM brands WHERE LOWER(REPLACE(name, ' ', '')) LIKE '%csops%')
  AND (assignee_id IS NULL OR assignee_id NOT IN (SELECT id FROM agents WHERE LOWER(REPLACE(name, ' ', '')) LIKE '%csops%'))`;

// With 't' alias
const tEXCL = `
  AND NOT ('csops' = ANY(t.tags)) AND NOT ('sales' = ANY(t.tags))
  AND t.brand_id NOT IN (SELECT id FROM brands WHERE LOWER(REPLACE(name, ' ', '')) LIKE '%csops%')
  AND (t.assignee_id IS NULL OR t.assignee_id NOT IN (SELECT id FROM agents WHERE LOWER(REPLACE(name, ' ', '')) LIKE '%csops%'))`;

// ── Brand/Agent/Team filter fragments ───────────────────────────────────────
// These use subquery lookups so users type names, not IDs.

// For queries on the tickets table directly (no alias)
const B  = `[[AND brand_id IN (SELECT id FROM brands WHERE name = {{brand}})]]`;
const L  = `[[AND language_code = {{language}}]]`;
const DS = `[[AND created_at >= {{start_date}}]]`;
const DE = `[[AND created_at <= {{end_date}}]]`;

// For queries with 't' alias on tickets
const tB  = `[[AND t.brand_id IN (SELECT id FROM brands WHERE name = {{brand}})]]`;
const tL  = `[[AND t.language_code = {{language}}]]`;
const tDS = `[[AND t.created_at >= {{start_date}}]]`;
const tDE = `[[AND t.created_at <= {{end_date}}]]`;

// Date filters on other tables
const srDS = `[[AND sr.created_at >= {{start_date}}]]`;
const srDE = `[[AND sr.created_at <= {{end_date}}]]`;
const updDS = `[[AND updated_at >= {{start_date}}]]`;
const updDE = `[[AND updated_at <= {{end_date}}]]`;

// Agent and Team filters (for Performance dashboard)
const tAgent = `[[AND t.assignee_id IN (SELECT id FROM agents WHERE name = {{agent}})]]`;
const tTeam  = `[[AND t.group_id IN (SELECT id FROM groups WHERE name = {{team}})]]`;
const srAgent = `[[AND sr.assignee_id IN (SELECT id FROM agents WHERE name = {{agent}})]]`;
const srTeam  = `[[AND sr.group_id IN (SELECT id FROM groups WHERE name = {{team}})]]`;

// ── PRODUCTIVITY ────────────────────────────────────────────────────────────

const PRODUCTIVITY_CARDS: CardDef[] = [
  {
    name: 'Tickets Created vs Solved',
    display: 'line',
    sql: `
SELECT "Date", SUM("Created") AS "Created", SUM("Solved") AS "Solved"
FROM (
  SELECT date_trunc('day', created_at)::date AS "Date", COUNT(*) AS "Created", 0 AS "Solved"
  FROM tickets
  WHERE 1=1 ${EXCL} ${B} ${L} ${DS} ${DE}
  GROUP BY 1
  UNION ALL
  SELECT date_trunc('day', updated_at)::date AS "Date", 0 AS "Created", COUNT(*) AS "Solved"
  FROM tickets
  WHERE status IN ('solved', 'closed') ${EXCL} ${B} ${L} ${updDS} ${updDE}
  GROUP BY 1
) sub
GROUP BY 1 ORDER BY 1`,
  },
  {
    name: 'Open Backlog by Age',
    display: 'bar',
    sql: `
SELECT
  CASE
    WHEN age_hours < 4 THEN '0-4 hours'
    WHEN age_hours < 24 THEN '4-24 hours'
    WHEN age_hours < 72 THEN '1-3 days'
    ELSE '3+ days'
  END AS "Age Bucket",
  COUNT(*) AS "Tickets"
FROM (
  SELECT EXTRACT(EPOCH FROM NOW() - created_at) / 3600 AS age_hours
  FROM tickets
  WHERE status IN ('new', 'open', 'pending', 'hold') ${EXCL} ${B} ${L}
) t
GROUP BY 1
ORDER BY MIN(age_hours)`,
  },
  {
    name: 'Avg First Reply Time',
    display: 'scalar',
    sql: `
SELECT ROUND(AVG(tm.reply_time_calendar_minutes), 0) AS "Avg First Reply (min)"
FROM ticket_metrics tm
JOIN tickets t ON t.id = tm.ticket_id
WHERE tm.reply_time_calendar_minutes IS NOT NULL
  AND tm.reply_time_calendar_minutes > 0
  ${tEXCL} ${tB} ${tL} ${tDS} ${tDE}`,
  },
  {
    name: 'Avg Handle Time by Agent',
    display: 'bar',
    sql: `
SELECT
  a.name AS "Agent",
  ROUND(AVG(tm.full_resolution_time_calendar_minutes) / 60, 1) AS "Avg Handle Time (hrs)"
FROM ticket_metrics tm
JOIN tickets t ON t.id = tm.ticket_id
JOIN agents a ON a.id = t.assignee_id
WHERE t.status IN ('solved', 'closed')
  AND tm.full_resolution_time_calendar_minutes IS NOT NULL
  ${tEXCL} ${tB} ${tL} ${tDS} ${tDE}
GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
  },
  {
    name: 'Throughput per Agent',
    display: 'bar',
    sql: `
SELECT
  a.name AS "Agent",
  COUNT(*) AS "Tickets Solved"
FROM tickets t
JOIN agents a ON a.id = t.assignee_id
WHERE t.status IN ('solved', 'closed')
  ${tEXCL} ${tB} ${tL} ${tDS} ${tDE}
GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
  },
  {
    name: 'First Reply Time Trend',
    display: 'line',
    sql: `
SELECT
  date_trunc('day', t.created_at)::date AS "Date",
  ROUND(AVG(tm.reply_time_calendar_minutes), 0) AS "Avg First Reply (min)"
FROM ticket_metrics tm
JOIN tickets t ON t.id = tm.ticket_id
WHERE tm.reply_time_calendar_minutes IS NOT NULL
  AND tm.reply_time_calendar_minutes > 0
  ${tEXCL} ${tB} ${tL} ${tDS} ${tDE}
GROUP BY 1 ORDER BY 1`,
  },
];

const PRODUCTIVITY_LAYOUT: LayoutItem[] = [
  { row: 0, col: 0, size_x: 18, size_y: 8 },
  { row: 8, col: 0, size_x: 9, size_y: 7 },
  { row: 8, col: 9, size_x: 9, size_y: 4 },
  { row: 15, col: 0, size_x: 9, size_y: 8 },
  { row: 15, col: 9, size_x: 9, size_y: 8 },
  { row: 23, col: 0, size_x: 18, size_y: 7 },
];

// ── QUALITY ─────────────────────────────────────────────────────────────────

const QUALITY_CARDS: CardDef[] = [
  {
    name: 'CSAT Score Trending',
    display: 'line',
    sql: `
SELECT
  date_trunc('week', sr.created_at)::date AS "Week",
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE sr.score = 'good')
    / NULLIF(COUNT(*) FILTER (WHERE sr.score IN ('good', 'bad')), 0), 1
  ) AS "CSAT %"
FROM satisfaction_ratings sr
JOIN tickets t ON t.id = sr.ticket_id
WHERE sr.score IN ('good', 'bad')
  ${tEXCL} ${tB} ${tL} ${srDS} ${srDE}
GROUP BY 1 ORDER BY 1`,
  },
  {
    name: 'CSAT by Agent',
    display: 'table',
    sql: `
SELECT
  a.name AS "Agent",
  COUNT(*) FILTER (WHERE sr.score = 'good') AS "Good",
  COUNT(*) FILTER (WHERE sr.score = 'bad') AS "Bad",
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE sr.score = 'good')
    / NULLIF(COUNT(*) FILTER (WHERE sr.score IN ('good', 'bad')), 0), 1
  ) AS "CSAT %"
FROM satisfaction_ratings sr
JOIN agents a ON a.id = sr.assignee_id
JOIN tickets t ON t.id = sr.ticket_id
WHERE sr.score IN ('good', 'bad')
  ${tEXCL} ${tB} ${tL} ${srDS} ${srDE}
GROUP BY 1 ORDER BY 4 DESC`,
  },
  {
    name: 'Negative CSAT Drill-down',
    display: 'table',
    sql: `
SELECT
  sr.ticket_id AS "Ticket ID",
  t.subject AS "Subject",
  a.name AS "Agent",
  sr.comment AS "Comment",
  sr.created_at::date AS "Date"
FROM satisfaction_ratings sr
JOIN tickets t ON t.id = sr.ticket_id
LEFT JOIN agents a ON a.id = sr.assignee_id
WHERE sr.score = 'bad'
  ${tEXCL} ${tB} ${tL} ${srDS} ${srDE}
ORDER BY sr.created_at DESC
LIMIT 100`,
  },
  {
    name: 'Reopened Ticket Rate',
    display: 'line',
    sql: `
SELECT
  date_trunc('week', t.created_at)::date AS "Week",
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE tm.reopens > 0)
    / NULLIF(COUNT(*), 0), 1
  ) AS "Reopen Rate %"
FROM tickets t
JOIN ticket_metrics tm ON tm.ticket_id = t.id
WHERE t.status IN ('solved', 'closed')
  ${tEXCL} ${tB} ${tL} ${tDS} ${tDE}
GROUP BY 1 ORDER BY 1`,
  },
];

const QUALITY_LAYOUT: LayoutItem[] = [
  { row: 0, col: 0, size_x: 18, size_y: 8 },
  { row: 8, col: 0, size_x: 9, size_y: 8 },
  { row: 8, col: 9, size_x: 9, size_y: 8 },
  { row: 16, col: 0, size_x: 18, size_y: 10 },
];

// ── AGENT / TEAM PERFORMANCE ────────────────────────────────────────────────

const PERFORMANCE_CARDS: CardDef[] = [
  {
    name: 'Agent Scorecard',
    display: 'table',
    sql: `
WITH agent_tickets AS (
  SELECT
    t.assignee_id,
    COUNT(*) AS solved,
    ROUND(AVG(tm.full_resolution_time_calendar_minutes) / 60, 1) AS avg_handle_hrs,
    ROUND(100.0 * COUNT(*) FILTER (WHERE tm.reopens > 0) / NULLIF(COUNT(*), 0), 1) AS reopen_pct
  FROM tickets t
  LEFT JOIN ticket_metrics tm ON tm.ticket_id = t.id
  WHERE t.status IN ('solved', 'closed')
    ${tEXCL} ${tB} ${tL} ${tDS} ${tDE} ${tAgent} ${tTeam}
  GROUP BY 1
),
agent_csat AS (
  SELECT
    sr.assignee_id,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE sr.score = 'good')
      / NULLIF(COUNT(*) FILTER (WHERE sr.score IN ('good', 'bad')), 0), 1
    ) AS csat_pct
  FROM satisfaction_ratings sr
  JOIN tickets t ON t.id = sr.ticket_id
  WHERE sr.score IN ('good', 'bad')
    ${tEXCL} ${tB} ${tL} ${srDS} ${srDE} ${srAgent} ${srTeam}
  GROUP BY 1
)
SELECT
  a.name AS "Agent",
  g.name AS "Team",
  at.solved AS "Solved",
  at.avg_handle_hrs AS "Avg Handle Time (hrs)",
  ac.csat_pct AS "CSAT %",
  at.reopen_pct AS "Reopen %"
FROM agent_tickets at
JOIN agents a ON a.id = at.assignee_id
LEFT JOIN groups g ON g.id = a.default_group_id
LEFT JOIN agent_csat ac ON ac.assignee_id = at.assignee_id
ORDER BY at.solved DESC`,
  },
  {
    name: 'Team Rollup',
    display: 'table',
    sql: `
WITH team_tickets AS (
  SELECT
    t.group_id,
    COUNT(*) AS solved,
    ROUND(AVG(tm.full_resolution_time_calendar_minutes) / 60, 1) AS avg_handle_hrs,
    ROUND(100.0 * COUNT(*) FILTER (WHERE tm.reopens > 0) / NULLIF(COUNT(*), 0), 1) AS reopen_pct
  FROM tickets t
  LEFT JOIN ticket_metrics tm ON tm.ticket_id = t.id
  WHERE t.status IN ('solved', 'closed')
    ${tEXCL} ${tB} ${tL} ${tDS} ${tDE} ${tTeam}
  GROUP BY 1
),
team_csat AS (
  SELECT
    sr.group_id,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE sr.score = 'good')
      / NULLIF(COUNT(*) FILTER (WHERE sr.score IN ('good', 'bad')), 0), 1
    ) AS csat_pct
  FROM satisfaction_ratings sr
  JOIN tickets t ON t.id = sr.ticket_id
  WHERE sr.score IN ('good', 'bad')
    ${tEXCL} ${tB} ${tL} ${srDS} ${srDE} ${srTeam}
  GROUP BY 1
)
SELECT
  g.name AS "Team",
  tt.solved AS "Solved",
  tt.avg_handle_hrs AS "Avg Handle Time (hrs)",
  tc.csat_pct AS "CSAT %",
  tt.reopen_pct AS "Reopen %"
FROM team_tickets tt
JOIN groups g ON g.id = tt.group_id
LEFT JOIN team_csat tc ON tc.group_id = tt.group_id
ORDER BY tt.solved DESC`,
  },
];

const PERFORMANCE_LAYOUT: LayoutItem[] = [
  { row: 0, col: 0, size_x: 18, size_y: 12 },
  { row: 12, col: 0, size_x: 18, size_y: 10 },
];

// ── SLA COMPLIANCE ──────────────────────────────────────────────────────────

const SLA_CARDS: CardDef[] = [
  {
    name: 'Response Time Trends',
    display: 'line',
    sql: `
SELECT
  date_trunc('week', t.created_at)::date AS "Week",
  ROUND(AVG(tm.reply_time_calendar_minutes), 0) AS "Avg First Reply (min)",
  ROUND(AVG(tm.full_resolution_time_calendar_minutes) / 60, 1) AS "Avg Resolution (hrs)"
FROM tickets t
JOIN ticket_metrics tm ON tm.ticket_id = t.id
WHERE tm.reply_time_calendar_minutes IS NOT NULL
  AND tm.reply_time_calendar_minutes > 0
  ${tEXCL} ${tB} ${tL} ${tDS} ${tDE}
GROUP BY 1 ORDER BY 1`,
  },
  {
    name: 'Response Times by Priority',
    display: 'bar',
    sql: `
SELECT
  COALESCE(t.priority, 'none') AS "Priority",
  COUNT(*) AS "Tickets",
  ROUND(AVG(tm.reply_time_calendar_minutes), 0) AS "Avg First Reply (min)",
  ROUND(AVG(tm.full_resolution_time_calendar_minutes) / 60, 1) AS "Avg Resolution (hrs)"
FROM tickets t
JOIN ticket_metrics tm ON tm.ticket_id = t.id
WHERE tm.reply_time_calendar_minutes IS NOT NULL
  ${tEXCL} ${tB} ${tL} ${tDS} ${tDE}
GROUP BY 1
ORDER BY CASE t.priority
  WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
  WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5
END`,
  },
];

const SLA_LAYOUT: LayoutItem[] = [
  { row: 0, col: 0, size_x: 18, size_y: 8 },
  { row: 8, col: 0, size_x: 18, size_y: 8 },
];

// ── Dashboard parameter sets ────────────────────────────────────────────────

const BASE_PARAMS = [
  { id: 'brand', name: 'Brand', slug: 'brand', type: 'string/=' },
  { id: 'lang', name: 'Language', slug: 'language', type: 'string/=' },
  { id: 'start', name: 'Start Date', slug: 'start_date', type: 'date/single' },
  { id: 'end', name: 'End Date', slug: 'end_date', type: 'date/single' },
];

const PERF_PARAMS = [
  ...BASE_PARAMS,
  { id: 'agent', name: 'Agent', slug: 'agent', type: 'string/=' },
  { id: 'team', name: 'Team', slug: 'team', type: 'string/=' },
];

// ── Main setup ──────────────────────────────────────────────────────────────

async function createCard(
  dbId: number,
  collectionId: number,
  card: CardDef
): Promise<number> {
  const result = await api('POST', '/card', {
    name: card.name,
    collection_id: collectionId,
    dataset_query: {
      type: 'native',
      native: {
        query: card.sql,
        'template-tags': tagsForQuery(card.sql),
      },
      database: dbId,
    },
    display: card.display,
    visualization_settings: card.vizSettings || {},
  });
  console.log(`  Created card: ${card.name} (ID: ${result.id})`);
  return result.id;
}

function buildParameterMappings(
  cardId: number,
  sql: string
): any[] {
  const mappings: any[] = [];
  const tagToParam: Record<string, string> = {
    brand: 'brand',
    language: 'lang',
    start_date: 'start',
    end_date: 'end',
    agent: 'agent',
    team: 'team',
  };
  for (const [tag, paramId] of Object.entries(tagToParam)) {
    if (sql.includes(`{{${tag}}}`)) {
      mappings.push({
        parameter_id: paramId,
        card_id: cardId,
        target: ['variable', ['template-tag', tag]],
      });
    }
  }
  return mappings;
}

async function setupDashboard(
  name: string,
  collectionId: number,
  dbId: number,
  cards: CardDef[],
  layout: LayoutItem[],
  params: any[]
): Promise<number> {
  const dash = await api('POST', '/dashboard', {
    name,
    collection_id: collectionId,
    parameters: params,
  });
  console.log(`\nCreated dashboard: ${name} (ID: ${dash.id})`);

  const dashcards: any[] = [];
  for (let i = 0; i < cards.length; i++) {
    const cardId = await createCard(dbId, collectionId, cards[i]);
    dashcards.push({
      id: -(i + 1),
      card_id: cardId,
      ...layout[i],
      parameter_mappings: buildParameterMappings(cardId, cards[i].sql),
    });
  }

  await api('PUT', `/dashboard/${dash.id}`, {
    dashcards,
    parameters: params,
  });
  console.log(`  Layout configured with ${dashcards.length} cards.`);

  return dash.id;
}

async function cleanupOldCollections() {
  const collections = await api('GET', '/collection');
  for (const c of collections) {
    if (c.name === 'Zendasha Dashboards' && !c.archived) {
      console.log(`Archiving old collection ID ${c.id}...`);
      await api('PUT', `/collection/${c.id}`, { archived: true });
    }
  }
}

async function main() {
  const session = await api('POST', '/session', {
    username: MB_EMAIL,
    password: MB_PASSWORD,
  });
  sessionToken = session.id;
  console.log('Authenticated with Metabase.\n');

  // Clean up previous runs
  await cleanupOldCollections();

  const dbs = await api('GET', '/database');
  const db = dbs.data?.find((d: any) => d.engine === 'postgres');
  if (!db) throw new Error('No PostgreSQL database found in Metabase');
  console.log(`Using database: ${db.name} (ID: ${db.id})`);

  const collection = await api('POST', '/collection', {
    name: 'Zendasha Dashboards',
  });
  console.log(`Created collection: Zendasha Dashboards (ID: ${collection.id})`);

  await setupDashboard('Productivity', collection.id, db.id, PRODUCTIVITY_CARDS, PRODUCTIVITY_LAYOUT, BASE_PARAMS);
  await setupDashboard('Quality', collection.id, db.id, QUALITY_CARDS, QUALITY_LAYOUT, BASE_PARAMS);
  await setupDashboard('Agent / Team Performance', collection.id, db.id, PERFORMANCE_CARDS, PERFORMANCE_LAYOUT, PERF_PARAMS);
  await setupDashboard('SLA Compliance', collection.id, db.id, SLA_CARDS, SLA_LAYOUT, BASE_PARAMS);

  console.log('\n=== All dashboards created! ===');
  console.log(`View them at: ${MB_URL}/collection/${collection.id}`);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
