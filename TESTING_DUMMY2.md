# Testing the DBMS Lab with `dummy2`

This guide covers setting up the demo database and manually checking each page and API in the DBMS Lab.

## 1. Create the test database

From a terminal, run:

```bash
cd /home/pop/os_dbms_pbl/dbms_part
./setup_dummy2.sh
```

The script asks for the PostgreSQL password without displaying it. It creates a separate `dummy2` database and loads the schema and sample rows from [`sql/dummy2.sql`](./sql/dummy2.sql). If `dummy2` already exists, the script stops without modifying it.

The fixture contains:

- 5 processes (`91001`–`91005`), with parent-child relationships.
- 11 memory events, including freed allocations, denied allocations, and outstanding granted allocations.
- 12 syscall records for `read`, `write`, `exit`, `mmap`, `munmap`, `stat`, and `fstat`.
- 9 CPU and RSS resource snapshots.
- Primary keys, indexes, checks, and declared foreign keys.

To confirm the fixture is loaded:

```bash
read -s -p "PostgreSQL password: " PGPASSWORD; printf '\n'
export PGPASSWORD
psql -h 127.0.0.1 -p 5432 -U osdbmspbl -d dummy2 \
  -c "SELECT pid, parent_pid, process_name FROM process_lifecycle ORDER BY pid;"
```

Expected process names include `demo-launcher`, `worker-alpha`, `memory-probe`, `worker-beta`, and `io-monitor`.

## 2. Start the app

If `PGPASSWORD` is not set in the terminal where you will run Node:

```bash
read -s -p "PostgreSQL password: " PGPASSWORD; printf '\n'
export PGPASSWORD
```

Then start the server:

```bash
cd /home/pop/os_dbms_pbl/dbms_part
npm start
```

Open <http://localhost:3001>, enter `dummy2` in the database field, and click **Connect**. The status bar should report that it connected to `dummy2`. Keep the server terminal open while testing.

## 3. Test each page

### Overview

Open **Overview**.

Expected counts:

| Metric | Expected |
|---|---:|
| Processes | 5 |
| Memory events | 11 |
| Syscall records | 12 |
| Resource snapshots | 9 |

The page also shows the latest memory-event and resource-snapshot timestamps. The SQL used to calculate the overview should appear below the cards.

### Process tree

Open **Process tree**.

Expected graph: 5 process nodes and 4 parent-child edges:

- `91001 demo-launcher` → `91002 worker-alpha`
- `91001 demo-launcher` → `91003 memory-probe`
- `91002 worker-alpha` → `91004 worker-beta`
- `91001 demo-launcher` → `91005 io-monitor`

Try **Fit view**, dragging the graph, and zooming. The page should show the SQL query used to fetch the process records.

### Process lifecycle

Open **Process lifecycle**:

1. Enter PID `91002` and click **Run SQL query**. Expect `worker-alpha`, parent PID `91001`.
2. Clear the PID; enter `worker` under **Name contains**. Expect `worker-alpha` and `worker-beta`.
3. Use **Clear** to remove filters and reload the full list.

The query display should show a parameterized condition such as `p.pid = $1`; the bound value should be `91002`. The complete result row should remain visible above the SQL display.

### Memory events

Open **Memory events**:

1. PID `91003`, Action `ALLOC`, Status `GRANTED`, Minimum bytes `4000`: expect the 4096-byte allocation at `0xB200`.
2. PID `91003`, Status `DENIED`: expect the denied 2048-byte request.
3. PID `91004`, Action `FREE`: expect its freed 512-byte allocation.
4. Clear filters to see all 11 records.

### Leak analysis

Open **Leak analysis**:

1. Leave filters empty: expect 4 outstanding allocations.
2. Enter PID `91004`: expect the later 256-byte allocation at `0xC300`. The earlier 512-byte allocation at the same address was freed and should not be listed as a leak.
3. Enter PID `91002`: expect the 8192-byte allocation at `0xD400`.

The SQL display should contain the `NOT EXISTS` check for a later matching `FREE` event.

### Syscall analytics

Open **Syscall analytics**:

1. Name contains `read`, Minimum total executions `500`: expect `read` records for `worker-alpha` (950) and `worker-beta` (610).
2. Clear filters, then sort by **Execution count** descending: the highest count should be `read` for `worker-alpha` (950).

The SQL should show the process join and aggregation (`SUM`, `COUNT`, `GROUP BY`, and, when a minimum is set, `HAVING`).

### Resource snapshots

Open **Resource snapshots**:

1. Minimum CPU `%` `15`: expect three records (17.8, 23.4, and 18.6).
2. Clear the CPU filter; set Minimum RSS bytes to `100000000`: expect the two `worker-alpha` records (125829120 and 134217728).
3. Filter by PID `91003`: expect two low-memory snapshots for `memory-probe`.

### Schema & indexes

Open **Schema & indexes** and click **Inspect database schema**.

Expected:

- The four telemetry tables are listed.
- Columns and data types are shown.
- Primary-key and foreign-key constraints appear.
- The declared foreign keys connect child process parent PIDs and telemetry PIDs to process records.
- Index definitions are listed.

## 4. Check server-side pagination through the API

The UI requests 25 rows at a time; the fixture has fewer than 25 rows per table, so its **Next** button should be disabled. To test multiple API pages, query with a smaller limit:

```bash
curl --silent --show-error \
  "http://localhost:3001/api/processes?db=dummy2&limit=2&offset=0"
```

The response should contain 2 process rows and `page.hasMore: true`. Change `offset=2` for the next page. Do not put database passwords in the URL or share them in terminal output.

## 5. Troubleshooting

- **Connection/authentication error:** confirm PostgreSQL is running and `PGPASSWORD` is exported in the same terminal that starts `npm`.
- **Database not found:** run `./setup_dummy2.sh`; it will refuse to overwrite an existing database.
- **Empty result:** confirm the selected database is `dummy2`, click **Run SQL query**, and clear filters to verify the fixture rows.
- **Process graph library error:** the page loads `vis-network` from a CDN, so check network access and refresh the page.
- **Stale page styling or JavaScript:** hard-refresh the browser (`Ctrl+Shift+R`).
