# crm-dashboard

React + TypeScript front end for a small sales CRM: contacts, companies,
deals, a drag-and-drop pipeline, tasks, reports and a CSV importer.

```
npm install
npm run typecheck
```

The app expects the CRM API at `/api/v1`. There is no bundler config in
this PR - it is wired up with Vite in the deploy repo.

## Screens

| Route | Screen |
| --- | --- |
| `/` | Dashboard: quota, pipeline funnel, revenue chart, your tasks |
| `/contacts` | Paged, filterable contact table with bulk actions and CSV export |
| `/contacts/:id` | Contact record, notes, deals, activity timeline, activity logger |
| `/companies` | Company table |
| `/companies/:id` | Company record, people, deals, duplicate detection, bulk email |
| `/deals` | Deal table or drag-and-drop pipeline board |
| `/deals/:id` | Deal record with a stage stepper and inline editing |
| `/tasks` | Tasks bucketed into overdue / today / this week / later |
| `/reports` | Leaderboard, sales cycle, source breakdown, stage distribution |
| `/settings` | Table preferences, notifications, email signature |

`cmd+k` opens the command palette, which searches contacts and deals and
jumps to any screen.

## Structure

```
src/api/          typed wrappers over the REST endpoints
src/hooks/        useFetch, useDebounce, usePagination, useSelection, hotkeys
src/state/        context + reducer holding user, filters and toasts
src/utils/        formatting, dates, sorting, filtering, csv, validation, dedupe
src/components/   DataTable, FilterBar, Modal, PipelineBoard, Charts, editors
src/pages/        one file per screen
```

## Notes

- The filter bar is shared state, so a search on the contacts screen
  carries over to deals
- `DataTable` handles sorting, selection and empty/loading states, so a
  new list screen is mostly a `ColumnDef[]`
- Notes and email bodies are stored as HTML and rendered as entered
- Duplicate detection scores contacts on email, phone, name similarity and
  company domain
