# Sandbox DBMS Lab

A PostgreSQL-backed, read-only demonstration app for the sandbox telemetry tables. Unlike the original browser-side filters, the filters here are sent to Express and applied by parameterized SQL on PostgreSQL.

## Run

```bash
npm install
read -s -p "PostgreSQL password: " PGPASSWORD; printf '\n'
export PGPASSWORD
npm start
```

Open <http://localhost:3001>. The default database is `dummy`. Configure the PostgreSQL connection with `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE`; defaults are localhost, port 5432, user `osdbmspbl`, and database `dummy`. The database can also be selected in the UI.

The database user needs `CONNECT` and `SELECT` access to the telemetry tables and catalog metadata. No schema or telemetry rows are modified by this app.

## Create a demo database

To create a separate `dummy2` database with sample rows for the filters, joins, aggregates, memory-leak report, and schema page:

```bash
./setup_dummy2.sh
```

The script asks for the PostgreSQL password without echoing it, creates the database only if it does not already exist, and refuses to modify an existing `dummy2`. The fixture includes declared foreign keys to demonstrate catalog inspection; the original sandbox schema may not have those constraints. It creates a complete set of telemetry tables with linked sample data, including both freed and outstanding allocations.

## API

- `GET /api/health` — active database and user.
- `GET /api/overview` — database-side table counts and latest event times.
- `GET /api/process-tree` — process IDs, parent IDs, and labels for the interactive hierarchy graph.
- `GET /api/processes` — process filters.
- `GET /api/memory` — memory-event filters and process join.
- `GET /api/leaks` — unmatched granted allocations using `NOT EXISTS`.
- `GET /api/syscalls` — syscall aggregation using `SUM`, `COUNT`, `GROUP BY`, and `HAVING`.
- `GET /api/resources` — CPU, RSS, PID, and time filters.
- `GET /api/schema` — PostgreSQL tables, columns, constraints, foreign keys, and indexes.

All data endpoints accept `db=<database>`; paginated endpoints also accept `limit` (1–100) and `offset`. Filters are bound as SQL parameters. Sort names and directions are allow-listed. Responses include the executed SQL and bound parameter values for demonstration.

The telemetry schema currently has shared PID columns suitable for joins. Whether declared foreign keys exist is discovered from PostgreSQL metadata at runtime; the app does not assume they do.

The **Process tree** page renders `/api/process-tree` results as a hierarchical graph. Parent-child edges are drawn when the parent PID exists in the selected database. Missing parents and cyclic parent links are reported; cyclic links are omitted from the visualization.
