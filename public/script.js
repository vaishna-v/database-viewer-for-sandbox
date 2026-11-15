const pageConfigs = {
    processes: {
        endpoint: '/api/processes',
        form: 'process-filters',
        results: 'processes-results',
        columns: ['pid', 'parent_pid', 'process_name', 'start_time', 'end_time', 'exit_code']
    },
    memory: {
        endpoint: '/api/memory',
        form: 'memory-filters',
        results: 'memory-results',
        columns: ['event_id', 'pid', 'process_name', 'timestamp', 'action', 'requested_bytes', 'status', 'memory_address', 'current_total_usage']
    },
    leaks: {
        endpoint: '/api/leaks',
        form: 'leak-filters',
        results: 'leaks-results',
        columns: ['pid', 'process_name', 'memory_address', 'requested_bytes', 'alloc_time']
    },
    syscalls: {
        endpoint: '/api/syscalls',
        form: 'syscall-filters',
        results: 'syscalls-results',
        columns: ['syscall_name', 'syscall_number', 'process_name', 'execution_count', 'process_count']
    },
    resources: {
        endpoint: '/api/resources',
        form: 'resource-filters',
        results: 'resources-results',
        columns: ['snapshot_id', 'pid', 'process_name', 'timestamp', 'cpu_usage_percent', 'rss_memory_bytes']
    }
};

const offsets = Object.fromEntries(Object.keys(pageConfigs).map(page => [page, 0]));
const databaseForm = document.getElementById('database-form');
const databaseInput = document.getElementById('database-name');
const connectionStatus = document.getElementById('connection-status');
let processTree = null;

function selectedDatabase() {
    return databaseInput.value.trim();
}

function apiUrl(path, params = {}) {
    const query = new URLSearchParams({ db: selectedDatabase(), ...params });
    return `${path}?${query}`;
}

async function request(path, params = {}) {
    const response = await fetch(apiUrl(path, params));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
}

function setStatus(message, isError = false) {
    connectionStatus.textContent = message;
    connectionStatus.classList.toggle('error', isError);
}

function createTable(columns, rows) {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'No matching rows.';
        wrap.append(empty);
        return wrap;
    }
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    columns.forEach(column => {
        const th = document.createElement('th');
        th.textContent = column.replaceAll('_', ' ');
        headRow.append(th);
    });
    head.append(headRow);
    const body = document.createElement('tbody');
    rows.forEach(row => {
        const tr = document.createElement('tr');
        columns.forEach(column => {
            const td = document.createElement('td');
            td.textContent = row[column] === null || row[column] === undefined ? '—' : String(row[column]);
            tr.append(td);
        });
        body.append(tr);
    });
    table.append(head, body);
    wrap.append(table);
    return wrap;
}

function showQueryInfo(container, queryInfo) {
    container.querySelectorAll(':scope > .query-box').forEach(box => box.remove());
    const box = document.createElement('section');
    box.className = 'query-box';
    const title = document.createElement('h3');
    title.textContent = 'SQL executed by PostgreSQL';
    const sql = document.createElement('pre');
    if (queryInfo.queries) {
        sql.textContent = queryInfo.queries.map(item => `-- ${item.label}\n${item.sql}`).join('\n\n');
    } else {
        sql.textContent = queryInfo.sql;
    }
    box.append(title, sql);
    if (queryInfo.params && queryInfo.params.length) {
        const params = document.createElement('pre');
        params.className = 'query-params';
        params.textContent = `Bound parameters: ${JSON.stringify(queryInfo.params)}`;
        box.append(params);
    }
    container.append(box);
}

function formParams(form) {
    const params = {};
    new FormData(form).forEach((value, key) => {
        if (value !== '') params[key] = value;
    });
    return params;
}

async function loadTable(page, resetOffset = false) {
    const config = pageConfigs[page];
    const form = document.getElementById(config.form);
    const results = document.getElementById(config.results);
    if (resetOffset) offsets[page] = 0;
    results.textContent = 'Querying PostgreSQL…';
    try {
        const params = { ...formParams(form), limit: 25, offset: offsets[page] };
        const payload = await request(config.endpoint, params);
        results.replaceChildren();
        results.append(createTable(config.columns, payload.data));
        const pager = document.createElement('div');
        pager.className = 'pager';
        const pageLabel = document.createElement('span');
        pageLabel.textContent = `Rows ${payload.data.length ? offsets[page] + 1 : 0}–${offsets[page] + payload.data.length}`;
        const controls = document.createElement('div');
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.className = 'secondary';
        previous.textContent = 'Previous';
        previous.disabled = offsets[page] === 0;
        previous.addEventListener('click', () => {
            offsets[page] = Math.max(0, offsets[page] - 25);
            loadTable(page);
        });
        const next = document.createElement('button');
        next.type = 'button';
        next.textContent = 'Next';
        next.disabled = !payload.page.hasMore;
        next.addEventListener('click', () => {
            offsets[page] += 25;
            loadTable(page);
        });
        controls.append(previous, next);
        pager.append(pageLabel, controls);
        results.append(pager);
        showQueryInfo(results, payload.queryInfo);
        setStatus(`Connected to PostgreSQL database "${selectedDatabase()}".`);
    } catch (error) {
        results.textContent = error.message;
        setStatus(error.message, true);
    }
}

function renderCards(data) {
    const cards = document.getElementById('overview-cards');
    cards.replaceChildren();
    const labels = {
        process_count: 'Processes',
        memory_event_count: 'Memory events',
        syscall_record_count: 'Syscall records',
        resource_snapshot_count: 'Resource snapshots',
        latest_memory_event: 'Latest memory event',
        latest_resource_snapshot: 'Latest resource snapshot'
    };
    Object.entries(labels).forEach(([key, label]) => {
        const card = document.createElement('article');
        card.className = 'card';
        card.textContent = label;
        const value = document.createElement('strong');
        value.textContent = data[key] === null ? '—' : String(data[key]);
        card.append(value);
        cards.append(card);
    });
}

async function loadOverview() {
    try {
        const [health, overview] = await Promise.all([request('/api/health'), request('/api/overview')]);
        setStatus(`Connected to "${health.data.database}" as PostgreSQL user "${health.data.user}".`);
        renderCards(overview.data);
        showQueryInfo(document.getElementById('overview-query'), overview.queryInfo);
    } catch (error) {
        setStatus(error.message, true);
        document.getElementById('overview-cards').textContent = error.message;
    }
}

async function loadProcessTree() {
    const container = document.getElementById('process-tree-content');
    const count = document.getElementById('process-tree-count');
    container.replaceChildren();
    count.textContent = 'Loading process records…';
    try {
        const payload = await request('/api/process-tree');
        const processes = payload.data;
        count.textContent = `${processes.length} process record${processes.length === 1 ? '' : 's'}`;
        if (processTree) {
            processTree.destroy();
            processTree = null;
        }
        if (!processes.length) {
            container.textContent = 'No process records found in this database.';
        } else if (!window.vis || !window.vis.Network || !window.vis.DataSet) {
            throw new Error('The process graph library did not load. Check the network connection and refresh the page.');
        } else {
            const processIds = new Set(processes.map(process => process.pid));
            const parentByPid = new Map(processes.map(process => [process.pid, process.parent_pid]));
            const nodes = new vis.DataSet(processes.map(process => ({
                id: process.pid,
                label: `PID: ${process.pid}\n${process.process_name || 'Unknown'}`,
                title: `PID: ${process.pid}\nParent PID: ${process.parent_pid ?? 'None'}\nStarted: ${process.start_time ?? 'Unknown'}\nStatus: ${process.end_time ? 'Exited' : 'Active'}`,
                shape: 'box',
                color: {
                    background: process.end_time ? '#eaf0f7' : '#10233f',
                    border: process.end_time ? '#8293a8' : '#1769aa',
                    highlight: { background: '#1769aa', border: '#0c5089' }
                },
                font: { color: process.end_time ? '#172033' : '#ffffff', face: 'ui-monospace, monospace' }
            })));
            let missingParents = 0;
            let cyclicLinks = 0;
            const edges = [];
            processes.forEach(process => {
                if (process.parent_pid === null || process.parent_pid === undefined) return;
                if (!processIds.has(process.parent_pid)) {
                    missingParents += 1;
                    return;
                }
                let ancestor = process.parent_pid;
                const seen = new Set([process.pid]);
                let createsCycle = false;
                while (ancestor !== null && ancestor !== undefined) {
                    if (seen.has(ancestor)) {
                        createsCycle = true;
                        break;
                    }
                    seen.add(ancestor);
                    ancestor = parentByPid.get(ancestor);
                }
                if (createsCycle) {
                    cyclicLinks += 1;
                    return;
                }
                edges.push({ from: process.parent_pid, to: process.pid, arrows: 'to' });
            });
            processTree = new vis.Network(container, { nodes, edges: new vis.DataSet(edges) }, {
                layout: {
                    hierarchical: {
                        direction: 'UD',
                        sortMethod: 'directed',
                        nodeSpacing: 180,
                        levelSeparation: 100
                    }
                },
                physics: false,
                interaction: { dragNodes: true, dragView: true, zoomView: true },
                edges: { color: { color: '#72839a' }, smooth: { type: 'cubicBezier', forceDirection: 'vertical' } }
            });
            const notes = [];
            if (missingParents) notes.push(`${missingParents} process record(s) have parent PIDs not present in this database.`);
            if (cyclicLinks) notes.push(`${cyclicLinks} invalid cyclic parent link(s) were omitted.`);
            if (notes.length) count.textContent += ` — ${notes.join(' ')}`;
            processTree.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
        }
        showQueryInfo(document.getElementById('process-tree-query'), payload.queryInfo);
        setStatus(`Connected to PostgreSQL database "${selectedDatabase()}".`);
    } catch (error) {
        count.textContent = '';
        container.textContent = error.message;
        setStatus(error.message, true);
    }
}

function appendSchemaSection(container, title, columns, rows) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = `${title} (${rows.length})`;
    const result = document.createElement('div');
    result.className = 'results';
    result.append(createTable(columns, rows));
    section.append(heading, result);
    container.append(section);
}

async function loadSchema() {
    const container = document.getElementById('schema-results');
    container.textContent = 'Reading PostgreSQL catalog…';
    try {
        const payload = await request('/api/schema');
        const data = payload.data;
        container.replaceChildren();
        appendSchemaSection(container, 'Tables', ['table_name', 'table_type'], data.tables);
        appendSchemaSection(container, 'Columns', ['table_name', 'ordinal_position', 'column_name', 'data_type', 'is_nullable', 'column_default'], data.columns);
        appendSchemaSection(container, 'Constraints and key relationships', ['table_name', 'constraint_name', 'constraint_type', 'column_name', 'foreign_table_name', 'foreign_column_name'], data.constraints);
        appendSchemaSection(container, 'Declared foreign keys', ['table_name', 'constraint_name', 'column_name', 'foreign_table_name', 'foreign_column_name'], data.foreignKeys);
        appendSchemaSection(container, 'Indexes', ['table_name', 'index_name', 'definition'], data.indexes);
        if (!data.foreignKeys.length) {
            const note = document.createElement('p');
            note.className = 'intro';
            note.textContent = 'No declared foreign-key constraints were found in the public schema. Some pages still join related records by shared PID values.';
            container.prepend(note);
        }
        showQueryInfo(document.getElementById('schema-query'), payload.queryInfo);
        setStatus(`Schema inspected for database "${selectedDatabase()}".`);
    } catch (error) {
        container.textContent = error.message;
        setStatus(error.message, true);
    }
}

function navigate() {
    const page = location.hash.slice(1) || 'overview';
    const validPages = ['overview', 'process-tree', ...Object.keys(pageConfigs), 'schema'];
    const activePage = validPages.includes(page) ? page : 'overview';
    document.querySelectorAll('.page').forEach(section => {
        section.classList.toggle('active', section.id === `page-${activePage}`);
    });
    document.querySelectorAll('.sidebar a').forEach(link => {
        link.classList.toggle('active', link.dataset.page === activePage);
    });
    if (activePage === 'overview') loadOverview();
    else if (activePage === 'process-tree') loadProcessTree();
    else if (activePage === 'schema') loadSchema();
    else loadTable(activePage);
}

Object.entries(pageConfigs).forEach(([page, config]) => {
    const form = document.getElementById(config.form);
    form.addEventListener('submit', event => {
        event.preventDefault();
        loadTable(page, true);
    });
    form.addEventListener('reset', () => {
        window.setTimeout(() => loadTable(page, true), 0);
    });
});

databaseForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!/^[A-Za-z0-9_]+$/.test(selectedDatabase())) {
        setStatus('Database name may contain only letters, numbers, and underscores.', true);
        return;
    }
    Object.keys(offsets).forEach(page => { offsets[page] = 0; });
    navigate();
});

document.getElementById('refresh-schema').addEventListener('click', loadSchema);
document.getElementById('refresh-process-tree').addEventListener('click', loadProcessTree);
document.getElementById('fit-process-tree').addEventListener('click', () => {
    if (processTree) processTree.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } });
});
window.addEventListener('hashchange', navigate);
databaseInput.value = new URLSearchParams(location.search).get('db') || localStorage.getItem('dbmsDatabase') || 'dummy';
databaseForm.addEventListener('submit', () => localStorage.setItem('dbmsDatabase', selectedDatabase()));
navigate();
