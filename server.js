const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const pools = new Map();
const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const DEFAULT_DATABASE = process.env.PGDATABASE || 'dummy';

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

function getDatabase(req, res) {
    const database = req.query.db || DEFAULT_DATABASE;
    if (!/^[A-Za-z0-9_]+$/.test(database)) {
        res.status(400).json({ error: 'Database name may contain only letters, numbers, and underscores.' });
        return null;
    }
    return database;
}

function getPool(database) {
    if (!pools.has(database)) {
        const config = {
            host: process.env.PGHOST || '127.0.0.1',
            port: Number.parseInt(process.env.PGPORT || '5432', 10),
            user: process.env.PGUSER || 'osdbmspbl',
            database,
            max: 5,
            idleTimeoutMillis: 10000
        };
        if (process.env.PGPASSWORD) config.password = process.env.PGPASSWORD;
        pools.set(database, new Pool(config));
    }
    return pools.get(database);
}

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function addCondition(where, params, sql, value) {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
}

function addNumberCondition(where, params, query, key, expression, options = {}) {
    if (query[key] === undefined || query[key] === '') return;
    const value = Number(query[key]);
    if (!Number.isFinite(value) || (options.integer && !Number.isInteger(value)) || (options.nonNegative && value < 0)) {
        throw new Error(`Invalid ${key} filter.`);
    }
    addCondition(where, params, `${expression} ${options.operator || '='} ?`, value);
}

function addTextCondition(where, params, query, key, expression, operator = '=') {
    if (query[key] === undefined || query[key] === '') return;
    addCondition(where, params, `${expression} ${operator} ?`, operator === 'ILIKE' ? `%${query[key]}%` : query[key]);
}

function addTimeCondition(where, params, query, key, expression, operator) {
    if (query[key] === undefined || query[key] === '') return;
    const date = new Date(query[key]);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${key} date filter.`);
    addCondition(where, params, `${expression} ${operator} ?`, date.toISOString());
}

function pageOptions(query) {
    const limit = query.limit === undefined ? 25 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be an integer from 1 to 100.');
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Offset must be a non-negative integer.');
    return { limit, offset };
}

function sortOrder(query, allowed, defaultKey) {
    const key = query.sort || defaultKey;
    if (!Object.hasOwn(allowed, key)) throw new Error('Unsupported sort field.');
    const direction = (query.direction || 'desc').toLowerCase();
    if (direction !== 'asc' && direction !== 'desc') throw new Error('Sort direction must be asc or desc.');
    return `${allowed[key]} ${direction.toUpperCase()}`;
}

function sendPaged(req, res, { select, from, where, params, orderBy, columns, groupBy = '', having = [] }) {
    const { limit, offset } = pageOptions(req.query);
    const queryParams = [...params, limit + 1, offset];
    const havingSql = having.length ? ` HAVING ${having.join(' AND ')}` : '';
    const sql = `${select} ${from}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ${groupBy}${havingSql} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    return getPool(req.database).query(sql, queryParams).then(result => {
        const hasMore = result.rows.length > limit;
        res.json({
            data: result.rows.slice(0, limit),
            queryInfo: { sql, params: queryParams },
            page: { limit, offset, hasMore },
            columns
        });
    });
}

app.use('/api', (req, res, next) => {
    req.database = getDatabase(req, res);
    if (req.database) next();
});

app.get('/api/health', asyncRoute(async (req, res) => {
    const sql = 'SELECT current_database() AS database, current_user AS user, version() AS version';
    const result = await getPool(req.database).query(sql);
    res.json({ data: result.rows[0], queryInfo: { sql, params: [] } });
}));

app.get('/api/overview', asyncRoute(async (req, res) => {
    const sql = `
        SELECT
            (SELECT COUNT(*) FROM process_lifecycle) AS process_count,
            (SELECT COUNT(*) FROM memory_events) AS memory_event_count,
            (SELECT COUNT(*) FROM syscall_telemetry) AS syscall_record_count,
            (SELECT COUNT(*) FROM resource_snapshots) AS resource_snapshot_count,
            (SELECT MAX(timestamp) FROM memory_events) AS latest_memory_event,
            (SELECT MAX(timestamp) FROM resource_snapshots) AS latest_resource_snapshot`;
    const result = await getPool(req.database).query(sql);
    res.json({ data: result.rows[0], queryInfo: { sql, params: [] } });
}));

app.get('/api/processes', asyncRoute(async (req, res) => {
    const where = [];
    const params = [];
    addNumberCondition(where, params, req.query, 'pid', 'p.pid', { integer: true, nonNegative: true });
    addNumberCondition(where, params, req.query, 'parentPid', 'p.parent_pid', { integer: true, nonNegative: true });
    addTextCondition(where, params, req.query, 'name', 'p.process_name', 'ILIKE');
    addTimeCondition(where, params, req.query, 'from', 'p.start_time', '>=');
    addTimeCondition(where, params, req.query, 'to', 'p.start_time', '<=');
    return sendPaged(req, res, {
        select: 'SELECT p.pid, p.parent_pid, p.process_name, p.start_time, p.end_time, p.exit_code',
        from: 'FROM process_lifecycle p',
        where,
        params,
        orderBy: sortOrder(req.query, { pid: 'p.pid', name: 'p.process_name', started: 'p.start_time' }, 'started'),
        columns: ['pid', 'parent_pid', 'process_name', 'start_time', 'end_time', 'exit_code']
    });
}));

app.get('/api/process-tree', asyncRoute(async (req, res) => {
    const sql = `SELECT pid, parent_pid, process_name, start_time, end_time
                 FROM process_lifecycle
                 ORDER BY start_time ASC, pid ASC`;
    const result = await getPool(req.database).query(sql);
    res.json({
        data: result.rows,
        queryInfo: { sql, params: [] }
    });
}));

app.get('/api/memory', asyncRoute(async (req, res) => {
    const where = [];
    const params = [];
    addNumberCondition(where, params, req.query, 'pid', 'e.pid', { integer: true, nonNegative: true });
    addTextCondition(where, params, req.query, 'action', 'e.action');
    addTextCondition(where, params, req.query, 'status', 'e.status');
    addNumberCondition(where, params, req.query, 'minBytes', 'e.requested_bytes', { nonNegative: true, operator: '>=' });
    addNumberCondition(where, params, req.query, 'maxBytes', 'e.requested_bytes', { nonNegative: true, operator: '<=' });
    addTimeCondition(where, params, req.query, 'from', 'e.timestamp', '>=');
    addTimeCondition(where, params, req.query, 'to', 'e.timestamp', '<=');
    return sendPaged(req, res, {
        select: `SELECT e.event_id, e.pid, p.process_name, e.timestamp, e.action, e.requested_bytes,
                        e.status, e.memory_address, e.current_total_usage`,
        from: 'FROM memory_events e LEFT JOIN process_lifecycle p ON p.pid = e.pid',
        where,
        params,
        orderBy: sortOrder(req.query, { time: 'e.timestamp', pid: 'e.pid', bytes: 'e.requested_bytes' }, 'time'),
        columns: ['event_id', 'pid', 'process_name', 'timestamp', 'action', 'requested_bytes', 'status', 'memory_address', 'current_total_usage']
    });
}));

app.get('/api/leaks', asyncRoute(async (req, res) => {
    const where = [
        "a.action = 'ALLOC'",
        "a.status = 'GRANTED'",
        "a.memory_address IS NOT NULL",
        "a.memory_address <> ''",
        `NOT EXISTS (
            SELECT 1 FROM memory_events f
            WHERE f.pid = a.pid
              AND f.memory_address = a.memory_address
              AND f.action = 'FREE'
              AND f.event_id > a.event_id
        )`
    ];
    const params = [];
    addNumberCondition(where, params, req.query, 'pid', 'a.pid', { integer: true, nonNegative: true });
    addTextCondition(where, params, req.query, 'name', 'p.process_name', 'ILIKE');
    addNumberCondition(where, params, req.query, 'minBytes', 'a.requested_bytes', { nonNegative: true, operator: '>=' });
    addTimeCondition(where, params, req.query, 'from', 'a.timestamp', '>=');
    addTimeCondition(where, params, req.query, 'to', 'a.timestamp', '<=');
    return sendPaged(req, res, {
        select: `SELECT a.pid, COALESCE(p.process_name, 'Unknown') AS process_name,
                        a.memory_address, a.requested_bytes, a.timestamp AS alloc_time`,
        from: 'FROM memory_events a LEFT JOIN process_lifecycle p ON p.pid = a.pid',
        where,
        params,
        orderBy: sortOrder(req.query, { time: 'a.timestamp', pid: 'a.pid', bytes: 'a.requested_bytes' }, 'time'),
        columns: ['pid', 'process_name', 'memory_address', 'requested_bytes', 'alloc_time']
    });
}));

app.get('/api/syscalls', asyncRoute(async (req, res) => {
    const where = [];
    const params = [];
    addNumberCondition(where, params, req.query, 'pid', 's.pid', { integer: true, nonNegative: true });
    addTextCondition(where, params, req.query, 'name', 's.syscall_name', 'ILIKE');
    const having = [];
    addNumberCondition(having, params, req.query, 'minCount', 'SUM(s.execution_count)', { nonNegative: true, operator: '>=' });
    return sendPaged(req, res, {
        select: `SELECT s.syscall_name, s.syscall_number,
                        COALESCE(p.process_name, 'Unknown') AS process_name,
                        SUM(s.execution_count)::bigint AS execution_count,
                        COUNT(DISTINCT s.pid)::int AS process_count`,
        from: 'FROM syscall_telemetry s LEFT JOIN process_lifecycle p ON p.pid = s.pid',
        where,
        params,
        orderBy: sortOrder(req.query, { name: 's.syscall_name', count: 'SUM(s.execution_count)', number: 's.syscall_number' }, 'count'),
        columns: ['syscall_name', 'syscall_number', 'process_name', 'execution_count', 'process_count'],
        groupBy: 'GROUP BY s.syscall_name, s.syscall_number, p.process_name',
        having
    });
}));

app.get('/api/resources', asyncRoute(async (req, res) => {
    const where = [];
    const params = [];
    addNumberCondition(where, params, req.query, 'pid', 'r.pid', { integer: true, nonNegative: true });
    addNumberCondition(where, params, req.query, 'minCpu', 'r.cpu_usage_percent', { nonNegative: true, operator: '>=' });
    addNumberCondition(where, params, req.query, 'maxCpu', 'r.cpu_usage_percent', { nonNegative: true, operator: '<=' });
    addNumberCondition(where, params, req.query, 'minRss', 'r.rss_memory_bytes', { nonNegative: true, operator: '>=' });
    addNumberCondition(where, params, req.query, 'maxRss', 'r.rss_memory_bytes', { nonNegative: true, operator: '<=' });
    addTimeCondition(where, params, req.query, 'from', 'r.timestamp', '>=');
    addTimeCondition(where, params, req.query, 'to', 'r.timestamp', '<=');
    return sendPaged(req, res, {
        select: 'SELECT r.snapshot_id, r.pid, p.process_name, r.timestamp, r.cpu_usage_percent, r.rss_memory_bytes',
        from: 'FROM resource_snapshots r LEFT JOIN process_lifecycle p ON p.pid = r.pid',
        where,
        params,
        orderBy: sortOrder(req.query, { time: 'r.timestamp', pid: 'r.pid', cpu: 'r.cpu_usage_percent', rss: 'r.rss_memory_bytes' }, 'time'),
        columns: ['snapshot_id', 'pid', 'process_name', 'timestamp', 'cpu_usage_percent', 'rss_memory_bytes']
    });
}));

app.get('/api/schema', asyncRoute(async (req, res) => {
    const pool = getPool(req.database);
    const queries = [
        {
            label: 'Tables',
            sql: `SELECT table_name, table_type
                  FROM information_schema.tables
                  WHERE table_schema = 'public'
                  ORDER BY table_name`
        },
        {
            label: 'Columns',
            sql: `SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                  WHERE table_schema = 'public'
                  ORDER BY table_name, ordinal_position`
        },
        {
            label: 'Constraints',
            sql: `SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
                         kcu.column_name,
                         CASE WHEN tc.constraint_type = 'FOREIGN KEY' THEN ccu.table_name END AS foreign_table_name,
                         CASE WHEN tc.constraint_type = 'FOREIGN KEY' THEN ccu.column_name END AS foreign_column_name
                  FROM information_schema.table_constraints tc
                  LEFT JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_catalog = kcu.constraint_catalog
                   AND tc.constraint_schema = kcu.constraint_schema
                   AND tc.constraint_name = kcu.constraint_name
                   AND tc.table_name = kcu.table_name
                  LEFT JOIN information_schema.constraint_column_usage ccu
                    ON tc.constraint_catalog = ccu.constraint_catalog
                   AND tc.constraint_schema = ccu.constraint_schema
                   AND tc.constraint_name = ccu.constraint_name
                  WHERE tc.table_schema = 'public'
                  ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`
        },
        {
            label: 'Indexes',
            sql: `SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
                  FROM pg_indexes
                  WHERE schemaname = 'public'
                  ORDER BY tablename, indexname`
        }
    ];
    const [tables, columns, constraints, indexes] = await Promise.all(queries.map(query => pool.query(query.sql)));
    res.json({
        data: {
            tables: tables.rows,
            columns: columns.rows,
            constraints: constraints.rows,
            indexes: indexes.rows,
            foreignKeys: constraints.rows.filter(row => row.constraint_type === 'FOREIGN KEY')
        },
        queryInfo: { queries: queries.map(query => ({ label: query.label, sql: query.sql, params: [] })) }
    });
}));

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.message.startsWith('Invalid ') ||
        error.message.startsWith('Limit ') ||
        error.message.startsWith('Offset ') ||
        error.message.startsWith('Unsupported ') ||
        error.message.startsWith('Sort direction')
        ? 400
        : 500;
    console.error(`[${req.method} ${req.path}]`, error.message);
    res.status(status).json({ error: error.message });
});

const server = app.listen(PORT, () => {
    console.log(`DBMS demo running at http://localhost:${PORT}`);
    console.log(`Default database: ${DEFAULT_DATABASE}`);
});

async function closeServer() {
    server.close();
    await Promise.all([...pools.values()].map(pool => pool.end()));
}

process.on('SIGINT', () => closeServer().then(() => process.exit(0)));
process.on('SIGTERM', () => closeServer().then(() => process.exit(0)));
