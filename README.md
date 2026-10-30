# WhatsWork

A personal life planner: separate calendars, a 24-hour day view, clashes, post briefings, hours per calendar, sleep and weekly reviews. Live at https://ateebhassan.github.io/whatswork/

## How it fits together

| Part | Where |
|---|---|
| The app (Today dashboard, Calendar day/week/month, Add with voice, Review, Settings) | `index.html` |
| College planner data lives in the app (posts, birthdays, to confirm); the old page is kept for designer sheets and backup (Settings) | `planner.html`, `planner-bridge.js` |
| Planner rules, world days, birthdays | `planner-core.js` |
| Calendars, clashes, 24-hour split, posts, briefings, hours, quick add, reviews | `ww-core.js` |
| The same two files bundled for the background worker | `core.mjs` (made by `build-worker-core.sh`) |
| Designer portal (link with a key, no account) | `designer.html` |
| Background worker: 9 am / 8 pm briefings, Sunday review, quick add with AI, sleep from the iPhone Shortcut | `supabase/functions/whatswork-worker/index.ts` |
| Database setup, in order | `schema.sql`, `schema-v2.sql`, `schema-v3-planner.sql`, `schema-v4-calendars.sql`, `schema-v5-health-reviews.sql`, `schema-v6-designer-notify.sql` |

Data lives in the Supabase project "WhatsWork". Every table has row level security: each person only sees their own rows.

After editing `planner-core.js` or `ww-core.js`: run `./build-worker-core.sh`, push, point the worker's import at the new commit (`https://cdn.jsdelivr.net/gh/Ateebhassan/whatswork@<commit>/core.mjs`) and redeploy the worker.

## For Claude: writing a review from a chat

With the Supabase connector, read the owner's `calendars`, `events`, `post_status`, `planner_docs`, `health_days` and `health_weeks`, then add one row:

```sql
insert into public.reviews (user_id, kind, source, title, summary, items, period_start, period_end)
values ('<user id>', 'on_demand', 'claude', 'Week of 2 Nov', 'One-sentence summary.',
        '[{"type":"warning","text":"..."},{"type":"tip","text":"..."},{"type":"win","text":"..."}]'::jsonb,
        '2026-11-02', '2026-11-08');
```

`type` is `warning`, `tip` or `win`. Keep it to 3 to 6 short, concrete items: name the day, time, calendar and what to do. It shows up in the Review tab straight away.

## Sleep from an iPhone Shortcut

The app's Review tab makes a key and shows the steps. The Shortcut posts to the worker with header `x-health-token: <key>` and JSON `{"sleep_start": "<ISO 8601>", "sleep_end": "<ISO 8601>"}` (optional `asleep_minutes`, `screen_minutes`). Only a SHA-256 fingerprint of the key is stored.
