# Zendesk Reporting Dashboard — PRD

> **Living Document** — Update this PRD as decisions are made, scope changes, or phases are completed.
> Last updated: 2026-02-08

---

## 1. Overview

### Problem

Zendesk Explore's built-in reporting is too slow and produces stale data, making it inadequate for day-to-day operational decisions. Team leads need fresher, more actionable dashboards they can self-serve without waiting for manual report pulls.

### Solution

A custom reporting dashboard powered by Metabase, backed by a PostgreSQL data warehouse synced hourly from the Zendesk API. Hosted on Railway.

### Audience

- **Primary users:** Team leads / supervisors
- **Usage pattern:** Self-serve filtering and exploration; no SQL required
- **Access model:** All users see all data; brand is the primary filter (no row-level permission boundaries)

---

## 2. Architecture

```
┌──────────────┐     Hourly Sync     ┌──────────────┐     Reads From     ┌──────────────┐
│  Zendesk API │  ─────────────────▶  │  PostgreSQL   │  ◀────────────────  │   Metabase   │
│  (Support)   │                      │  (Railway)    │                     │  (Railway)    │
└──────────────┘                      └──────────────┘                     └──────────────┘
```

### Components

| Component | Platform | Notes |
|-----------|----------|-------|
| **PostgreSQL** | Railway | Data warehouse. Stores synced Zendesk data. |
| **Metabase** | Railway | Dashboard UI. Connected to Postgres over Railway internal network. |
| **Sync Worker** | TBD | Hourly job that pulls from Zendesk API and upserts into Postgres. Options: n8n workflow, Node.js script on Railway cron, or small worker service. |

### Key Architecture Decisions

- [x] **Sync approach:** Node.js cron script on Railway
- [x] **Incremental sync strategy:** Zendesk incremental export API with `start_time` cursor; cursor-based pagination for list endpoints
- [x] **Backfill strategy:** 3-month rolling backfill on first run

---

## 3. Data Model

### Source: Zendesk Support API

All data comes from the Zendesk Support API (v2). Phase 1 does **not** include QA or WFM APIs.

### Entities to Sync

#### `tickets`
Core entity. One row per ticket.

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `ticket.id` | Primary key |
| `brand_id` | `ticket.brand_id` | **Primary filter dimension** |
| `status` | `ticket.status` | new, open, pending, hold, solved, closed |
| `priority` | `ticket.priority` | low, normal, high, urgent |
| `assignee_id` | `ticket.assignee_id` | FK → agents |
| `group_id` | `ticket.group_id` | FK → groups |
| `tags` | `ticket.tags` | Array. Language tags extracted as separate field. |
| `language` | Derived from `tags` | Extracted by matching against known language tag set (see below) |
| `subject` | `ticket.subject` | |
| `created_at` | `ticket.created_at` | |
| `updated_at` | `ticket.updated_at` | Used for incremental sync cursor |
| `solved_at` | `ticket.metric_set` or status events | |

#### `ticket_metrics`
One row per ticket. Contains timing/SLA data.

| Field | Source | Notes |
|-------|--------|-------|
| `ticket_id` | `ticket_metric.ticket_id` | FK → tickets |
| `reply_time_calendar_minutes` | `ticket_metric.reply_time_in_minutes.calendar` | First reply time |
| `reply_time_business_minutes` | `ticket_metric.reply_time_in_minutes.business` | |
| `full_resolution_time_calendar_minutes` | `ticket_metric.full_resolution_time_in_minutes.calendar` | |
| `full_resolution_time_business_minutes` | `ticket_metric.full_resolution_time_in_minutes.business` | |
| `agent_wait_time_minutes` | `ticket_metric.agent_wait_time_in_minutes.calendar` | |
| `requester_wait_time_minutes` | `ticket_metric.requester_wait_time_in_minutes.calendar` | |
| `first_resolution_time_minutes` | `ticket_metric.first_resolution_time_in_minutes.calendar` | |
| `reopens` | `ticket_metric.reopens` | Used for reopen rate metric |
| `replies` | `ticket_metric.replies` | |
| `sla_breach` | Derived | Boolean: did any SLA target breach? |
| `created_at` | `ticket_metric.created_at` | |

#### `satisfaction_ratings`
One row per CSAT response.

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `satisfaction_rating.id` | Primary key |
| `ticket_id` | `satisfaction_rating.ticket_id` | FK → tickets |
| `score` | `satisfaction_rating.score` | "good", "bad", "offered" |
| `comment` | `satisfaction_rating.comment` | For negative CSAT drill-down |
| `assignee_id` | `satisfaction_rating.assignee_id` | FK → agents |
| `group_id` | `satisfaction_rating.group_id` | FK → groups |
| `created_at` | `satisfaction_rating.created_at` | |

#### `agents`
Dimension table for agent/user lookup.

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `user.id` | Primary key |
| `name` | `user.name` | |
| `email` | `user.email` | |
| `role` | `user.role` | |
| `active` | `user.active` | |
| `default_group_id` | `user.default_group_id` | |

#### `groups`
Dimension table for team grouping.

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `group.id` | Primary key |
| `name` | `group.name` | |

#### `brands`
Dimension table for brand lookup.

| Field | Source | Notes |
|-------|--------|-------|
| `id` | `brand.id` | Primary key |
| `name` | `brand.name` | Display name for filters |
| `subdomain` | `brand.subdomain` | |

### Language Tag Mapping

Language is derived from ticket tags. Define a lookup set of known language tags:

```
LANGUAGE_TAGS = {
  "en": "English",
  "fr": "French",
  "de": "German",
  "es": "Spanish",
  "nl": "Dutch",
  "pt": "Portuguese"
  -- extend as needed
}
```

During sync, scan each ticket's tag array and extract the first matching language tag. Store both the code and display name. Tickets with no matching language tag get `NULL` (language filter simply won't apply to them).

> **TODO:** Confirm the exact language tags used in the Zendesk instance.

---

## 4. Dashboard Views & Metrics

### Global Filters (present on every view)

| Filter | Type | Notes |
|--------|------|-------|
| **Brand** | Dropdown (single/multi) | Primary filter. Always visible. |
| **Language** | Dropdown (single/multi) | Secondary filter. Relevant within multilingual brands. |
| **Date Range** | Date picker | Default: last 30 days |

---

### View 1: Productivity (Top Priority)

> **Purpose:** Give leads a clear picture of throughput, workload, and bottlenecks.

| Metric | Visualization | Definition |
|--------|--------------|------------|
| Tickets created vs. solved | Line chart (dual series, trending over time) | Count of tickets created and solved per day/week |
| Open backlog by age | Stacked bar or segmented number | Open tickets grouped into buckets: 0-4hrs, 4-24hrs, 1-3 days, 3+ days |
| Average handle time | Bar chart (by agent, by team) | Mean `full_resolution_time` for solved tickets |
| Throughput per agent | Bar chart or table | Tickets solved per agent per day/week |
| First touch time | Number + trend line | Average time from ticket creation to first agent reply (`reply_time`) |

---

### View 2: Quality

> **Purpose:** Track customer satisfaction and identify quality issues.

| Metric | Visualization | Definition |
|--------|--------------|------------|
| CSAT score trending | Line chart | % "good" out of (good + bad) responses, over time |
| CSAT by agent | Bar chart or table | Same calculation, grouped by assignee |
| Negative CSAT drill-down | Table with ticket links | List of "bad" ratings with comment text, ticket ID, agent |
| Escalation rate | Line chart + number | Tickets tagged/escalated as % of total (requires escalation tag/field definition) |
| Reopened ticket rate | Line chart + number | `reopens > 0` as % of solved tickets |

> **TODO:** Define how "escalation" is identified — is it a tag, a ticket field, or a group transfer?

---

### View 3: Agent / Team Performance

> **Purpose:** Side-by-side agent comparison for coaching and recognition.

| Metric | Visualization | Definition |
|--------|--------------|------------|
| Agent scorecard | Table | Columns: Agent, Tickets Solved, Avg Handle Time, CSAT %, Reopen Rate |
| Team-level rollup | Same table, grouped by team | Aggregated by `group_id` |
| Cross-agent comparison | Bar charts | Visual comparison of key metrics across agents |

---

### View 4: SLA Compliance (Lower Priority)

> **Purpose:** Monitor SLA adherence and catch patterns in breaches.

| Metric | Visualization | Definition |
|--------|--------------|------------|
| SLA breach rate trending | Line chart | % of tickets breaching SLA, over time |
| Breaches by priority | Stacked bar or table | Breach count/rate segmented by ticket priority |
| Near-miss tracking | Number + table | Tickets resolved within last 10% of SLA window |

> **TODO:** Confirm SLA policy structure in Zendesk. Determine how to identify breach vs. near-miss from API data.

---

## 5. Filters & Interactivity

### Metabase Implementation Notes

- Use Metabase **dashboard filters** mapped to Brand, Language, and Date Range
- All questions (cards) on every dashboard should accept these three filters
- Agent and Group can be additional optional filters on the Performance view
- Enable **drill-through** on charts so leads can click a data point and see underlying tickets
- Use Metabase **saved questions** as building blocks, assembled into dashboard views

---

## 6. Tech Stack Summary

| Layer | Technology | Hosting |
|-------|-----------|---------|
| Data warehouse | PostgreSQL | Railway |
| Dashboard UI | Metabase (open-source) | Railway |
| Data sync | Node.js cron (TypeScript) | Railway |
| Source API | Zendesk Support API v2 | N/A |

---

## 7. Phases & Progress

### Phase 1: Core Dashboard ← CURRENT

- [x] **Infrastructure setup**
  - [x] Provision PostgreSQL on Railway
  - [x] Deploy Metabase on Railway
  - [x] Connect Metabase to PostgreSQL
  - [x] Set up public URL / auth for Metabase

- [x] **Data pipeline**
  - [x] Design and create database schema (tables, indexes, constraints)
  - [x] Build sync script: tickets (incremental export, 56k+ synced)
  - [x] Build sync script: ticket_metrics (cursor pagination, 72k+ synced)
  - [x] Build sync script: satisfaction_ratings (cursor pagination, 23k+ synced)
  - [x] Build sync script: agents, groups, brands (dimension tables)
  - [x] Implement incremental sync (updated_at cursor)
  - [x] Implement initial historical backfill (3 months)
  - [ ] Set up hourly cron/schedule on Railway
  - [ ] Add error handling, logging, and alerting

- [x] **Dashboard: Productivity view**
  - [x] Created vs. solved trending
  - [x] Open backlog by age
  - [x] Average handle time
  - [x] Throughput per agent
  - [x] First touch time

- [x] **Dashboard: Quality view**
  - [x] CSAT trending
  - [x] CSAT by agent
  - [x] Negative CSAT drill-down
  - [ ] Escalation rate (blocked: escalation definition needed)
  - [x] Reopened ticket rate

- [x] **Dashboard: Agent/Team Performance view**
  - [x] Agent scorecard table
  - [x] Team rollup
  - [ ] Cross-agent comparison charts

- [x] **Dashboard: SLA Compliance view** (proxy metrics — no SLA policy defined yet)
  - [x] Response time trends (first reply + resolution)
  - [x] Response times by priority
  - [ ] Near-miss tracking (blocked: SLA policy definition needed)

- [x] **Filters & polish**
  - [x] Brand filter on all views (by name)
  - [x] Language filter on all views
  - [x] Date range filter on all views
  - [x] Agent filter on Performance view
  - [x] Team filter on Performance view
  - [ ] Drill-through enabled on charts
  - [ ] Team lead UAT and feedback

### Phase 2: QA & WFM Integration (Future)

- [ ] Integrate Zendesk QA API data
- [ ] Integrate Zendesk WFM API data
- [ ] Add QA scores to agent scorecard
- [ ] Add WFM adherence/utilization metrics
- [ ] Cross-reference QA scores with productivity metrics

---

## 8. Open Questions & TODOs

| # | Question | Status |
|---|----------|--------|
| 1 | Confirm exact language tags used in Zendesk instance | ⬜ Open |
| 2 | Define how "escalation" is identified (tag, field, group transfer?) | ⬜ Open |
| 3 | Confirm SLA policy structure and how breach/near-miss is surfaced via API | ⬜ Open |
| 4 | Choose sync approach (n8n, Node.js cron, worker service) | ✅ Node.js cron on Railway |
| 5 | Determine historical backfill depth (6 months? 1 year? All time?) | ✅ 3 months |
| 6 | Zendesk API rate limits — confirm plan tier and limits for incremental exports | ✅ ~400 req/min, handled with 429 retry |
| 7 | Metabase auth — basic login vs SSO? | ✅ Basic login for now |

---

## 9. Reference

### Zendesk API Endpoints (Phase 1)

| Endpoint | Use |
|----------|-----|
| `GET /api/v2/incremental/tickets` | Incremental ticket export |
| `GET /api/v2/ticket_metrics` | Timing and SLA data per ticket |
| `GET /api/v2/satisfaction_ratings` | CSAT responses |
| `GET /api/v2/users` | Agent dimension table |
| `GET /api/v2/groups` | Group dimension table |
| `GET /api/v2/brands` | Brand dimension table |

### Key Zendesk API Notes

- Incremental exports return tickets updated since a given Unix timestamp
- Rate limits vary by plan: typically 400-700 requests/min for Support API
- Incremental exports are the recommended approach for bulk sync (vs. listing endpoints)
- Satisfaction ratings endpoint supports `start_time` parameter for incremental pulls

---

## Appendix: Decision Log

| Date | Decision | Context |
|------|----------|---------|
| 2026-02-08 | Metabase + PostgreSQL on Railway | Self-hosted, cost-effective, fits existing Railway paid plan |
| 2026-02-08 | Brand as primary filter, language as secondary | Brand is the org-level slice; language only matters within multilingual brands |
| 2026-02-08 | Language derived from ticket tags | Tags already applied to tickets; no custom field needed |
| 2026-02-08 | No row-level permissions | All leads see all brands; filter-based, not permission-based |
| 2026-02-08 | Hourly sync frequency | Balances freshness against API load and complexity |
| 2026-02-08 | Phase 1 excludes QA and WFM | Nice to have, not critical; revisit after core dashboard is stable |
| 2026-02-08 | Node.js cron on Railway for sync | Simplest option, no extra tools to manage |
| 2026-02-08 | 3-month backfill depth | Enough for trend analysis without huge initial load |
| 2026-02-08 | Cursor-based pagination for Zendesk API | Offset pagination capped at 10k records; cursor has no limit |
| 2026-02-08 | No FK constraints in schema | Keeps sync ordering flexible, suits analytics workload |
| 2026-02-08 | Metabase dashboards scripted via API | Reproducible setup via `scripts/setup-metabase.ts` |
