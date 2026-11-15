let networkTree = null; 

window.onload = () => {
    const savedSandbox = localStorage.getItem('activeSandbox');
    if (savedSandbox) {
        document.getElementById('sandboxInput').value = savedSandbox;
        connectAndFetch(); 
    }
};

function switchTab(tabId, btnElement) {
    document.querySelectorAll('.section').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(tabId).style.display = 'block';
    
    if (btnElement) {
        btnElement.classList.add('active');
    } else {
        document.querySelector(`[onclick*="${tabId}"]`).classList.add('active');
    }
}

function recenterTree() {
    if (networkTree) {
        networkTree.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } });
    }
}

async function applyFilters(tableId, panelId, tableName) {
    const panel = document.getElementById(panelId);
    const inputs = panel.querySelectorAll('input, select');
    const sqlDisplay = panel.querySelector('.sql-query-display');
    const sandboxName = localStorage.getItem('activeSandbox');

    let conditions = [];

    inputs.forEach(input => {
        if (!input.value) return;
        
        const colName = input.getAttribute('data-colname');
        const filterType = input.getAttribute('data-type');
        let val = input.value.trim();
        
        if (isNaN(val)) val = `'${val}'`;
        
        if (filterType === 'exact') conditions.push(`${colName} = ${val}`);
        else if (filterType === 'includes') conditions.push(`${colName} ILIKE '%${val.replace(/'/g, '')}%'`);
        else if (filterType === 'min') conditions.push(`${colName} >= ${val}`);
        else if (filterType === 'max') conditions.push(`${colName} <= ${val}`);
    });

    let finalSQL = "";

    // NEW: Dynamic Recursive CTE Generation
    if (tableName === 'process_tree_cte') {
        const rootPidFilter = conditions.find(c => c.startsWith('pid ='));
        let baseCondition = "WHERE parent_pid NOT IN (SELECT pid FROM process_lifecycle)";
        
        // If user filters for a specific PID, dynamically shift the CTE base case to start the tree there!
        if (rootPidFilter) {
            baseCondition = `WHERE ${rootPidFilter}`;
        }

        finalSQL = `WITH RECURSIVE process_tree AS (
            SELECT pid, parent_pid, process_name, start_time, 1 as depth
            FROM process_lifecycle
            ${baseCondition}
            UNION ALL
            SELECT p.pid, p.parent_pid, p.process_name, p.start_time, pt.depth + 1
            FROM process_lifecycle p
            INNER JOIN process_tree pt ON pt.pid = p.parent_pid
        )
        SELECT * FROM process_tree;`;
        
    } else if (tableName === 'memory_leaks_view') {
        const baseLeakQuery = `SELECT a.pid, COALESCE(p.process_name, 'Unknown') as process_name, a.memory_address, a.requested_bytes, a.timestamp as alloc_time FROM memory_events a LEFT JOIN memory_events f ON a.pid = f.pid AND a.memory_address = f.memory_address AND f.action = 'FREE' AND f.event_id > a.event_id LEFT JOIN process_lifecycle p ON a.pid = p.pid WHERE a.action = 'ALLOC' AND a.status = 'GRANTED' AND a.memory_address IS NOT NULL AND a.memory_address != '' AND f.event_id IS NULL`;
        
        if (conditions.length === 0) {
            finalSQL = baseLeakQuery + ` ORDER BY a.timestamp DESC;`;
        } else {
            finalSQL = `SELECT * FROM (${baseLeakQuery}) as base_leaks WHERE ` + conditions.join(' AND ') + ` ORDER BY alloc_time DESC;`;
        }
    } else {
        if (conditions.length === 0) {
            finalSQL = `SELECT * FROM ${tableName};`;
        } else {
            finalSQL = `SELECT * FROM ${tableName} WHERE ` + conditions.join(' AND ') + `;`;
        }
    }

    sqlDisplay.innerText = finalSQL;

    try {
        const response = await fetch(`http://localhost:3000/api/query/${sandboxName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sqlQuery: finalSQL })
        });

        const result = await response.json();
        if (result.error) throw new Error(result.error);

        if (tableName === 'process_tree_cte') {
            renderTree(result.data);
        } else {
            const columnMaps = {
                'tbl-leaks': ['pid', 'process_name', 'memory_address', 'requested_bytes', 'alloc_time'],
                'tbl-process': ['pid', 'parent_pid', 'process_name', 'start_time'],
                'tbl-syscalls': ['pid', 'syscall_number', 'syscall_name', 'execution_count'],
                'tbl-memory': ['event_id', 'pid', 'timestamp', 'action', 'requested_bytes', 'status', 'memory_address', 'current_total_usage'],
                'tbl-resources': ['snapshot_id', 'pid', 'timestamp', 'cpu_usage_percent', 'rss_memory_bytes']
            };
            renderTable(tableId, result.data, columnMaps[tableId]);
        }
    } catch (err) {
        console.error("Query Execution Error:", err);
        alert("SQL Execution Error. Check backend console.");
    }
}

function clearFilters(tableId, panelId, tableName) {
    const panel = document.getElementById(panelId);
    const inputs = panel.querySelectorAll('input, select');
    inputs.forEach(input => input.value = '');
    applyFilters(tableId, panelId, tableName); 
}

async function connectAndFetch() {
    const sandboxName = document.getElementById('sandboxInput').value.trim();
    if (!sandboxName) return;
    localStorage.setItem('activeSandbox', sandboxName);
    
    const errorDiv = document.getElementById('error-msg');
    errorDiv.style.display = 'none';

    try {
        const response = await fetch(`http://localhost:3000/api/data/${sandboxName}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        renderTree(data.process_lifecycle);
        renderTable('tbl-leaks', data.memory_leaks, ['pid', 'process_name', 'memory_address', 'requested_bytes', 'alloc_time']);
        renderTable('tbl-process', data.process_lifecycle, ['pid', 'parent_pid', 'process_name', 'start_time']);
        renderTable('tbl-syscalls', data.syscall_telemetry, ['pid', 'syscall_number', 'syscall_name', 'execution_count']);
        renderTable('tbl-memory', data.memory_events, ['event_id', 'pid', 'timestamp', 'action', 'requested_bytes', 'status', 'memory_address', 'current_total_usage']);
        renderTable('tbl-resources', data.resource_snapshots, ['snapshot_id', 'pid', 'timestamp', 'cpu_usage_percent', 'rss_memory_bytes']);

        document.getElementById('tab-bar').style.display = 'flex';
        
        const activeTab = document.querySelector('.tab-btn.active');
        if (!activeTab) switchTab('sec-tree', null);

    } catch (err) {
        errorDiv.innerText = `[ERROR] Failed to load data for '${sandboxName}'. Ensure the backend is running.`;
        errorDiv.style.display = 'block';
        document.getElementById('tab-bar').style.display = 'none';
        document.querySelectorAll('.section').forEach(el => el.style.display = 'none');
    }
}

function renderTable(tableId, rowsData, columns) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    tbody.innerHTML = ''; 

    if (!rowsData || rowsData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${columns.length}">No data found.</td></tr>`;
        return;
    }

    rowsData.forEach(row => {
        const tr = document.createElement('tr');
        columns.forEach(col => {
            const td = document.createElement('td');
            td.innerText = row[col] !== null && row[col] !== '' ? row[col] : 'N/A';
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function renderTree(procs) {
    const container = document.getElementById('process-tree-content');
    if (!procs || procs.length === 0) {
        container.innerHTML = "<p style='padding: 20px;'>No processes tracked yet.</p>";
        return;
    }

    const nodes = new vis.DataSet();
    const edges = new vis.DataSet();

    procs.forEach(p => {
        // NEW: Display the PostgreSQL-calculated 'depth' dynamically on the node!
        const depthLabel = p.depth ? `\nDepth: ${p.depth}` : "";
        nodes.add({
            id: p.pid,
            label: `PID: ${p.pid}\n${p.process_name}${depthLabel}`,
            shape: 'box',
            color: { background: '#000', border: '#000', highlight: { background: '#444', border: '#444' } },
            font: { color: '#fff', face: 'monospace', align: 'center' }
        });

        if (p.parent_pid && procs.some(parent => parent.pid === p.parent_pid)) {
            edges.add({ from: p.parent_pid, to: p.pid, arrows: 'to', color: { color: '#000' } });
        }
    });

    const data = { nodes, edges };
    const options = {
        layout: { hierarchical: { direction: 'UD', sortMethod: 'directed', nodeSpacing: 180, levelSeparation: 120 } },
        physics: false, 
        interaction: { dragNodes: true, dragView: true, zoomView: true }
    };

    networkTree = new vis.Network(container, data, options);
}