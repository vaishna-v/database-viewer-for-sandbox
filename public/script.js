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

// NEW: Core Filtering Engine
function applyFilters(tableId, panelId, tableName) {
    const table = document.getElementById(tableId);
    const panel = document.getElementById(panelId);
    const rows = table.querySelectorAll('tbody tr');
    const inputs = panel.querySelectorAll('input, select');
    const sqlDisplay = panel.querySelector('.sql-query-display');

    let conditions = [];

    // Filter Logic
    rows.forEach(row => {
        let match = true;
        inputs.forEach(input => {
            if (!input.value) return; 
            
            const colIdx = parseInt(input.getAttribute('data-col'));
            const filterType = input.getAttribute('data-type');
            const cellText = row.cells[colIdx].innerText.trim();
            const filterValue = input.value.trim().toLowerCase();

            if (filterType === 'exact') {
                if (cellText.toLowerCase() !== filterValue) match = false;
            } else if (filterType === 'includes') {
                if (!cellText.toLowerCase().includes(filterValue)) match = false;
            } else if (filterType === 'min') {
                if (parseFloat(cellText) < parseFloat(filterValue)) match = false;
            } else if (filterType === 'max') {
                if (parseFloat(cellText) > parseFloat(filterValue)) match = false;
            }
        });
        row.style.display = match ? '' : 'none';
    });

    // SQL Query String Generation
    inputs.forEach(input => {
        if (!input.value) return;
        const colName = input.getAttribute('data-colname');
        const filterType = input.getAttribute('data-type');
        let val = input.value.trim();
        
        // Wrap strings in quotes for SQL syntax accuracy
        if (filterType === 'exact' && isNaN(val)) val = `'${val}'`;
        
        if (filterType === 'exact') conditions.push(`${colName} = ${val}`);
        else if (filterType === 'includes') conditions.push(`${colName} LIKE '%${val}%'`);
        else if (filterType === 'min') conditions.push(`${colName} >= ${val}`);
        else if (filterType === 'max') conditions.push(`${colName} <= ${val}`);
    });

    if (conditions.length === 0) {
        sqlDisplay.innerText = `SELECT * FROM ${tableName};`;
    } else {
        // Special case to append to the complex Leak query, otherwise standard WHERE
        if (tableName === 'memory_leaks_view') {
            sqlDisplay.innerText = `SELECT * FROM memory_events WHERE action = 'ALLOC' AND ... AND ` + conditions.join(' AND ') + `;`;
        } else {
            sqlDisplay.innerText = `SELECT * FROM ${tableName} WHERE ` + conditions.join(' AND ') + `;`;
        }
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
        nodes.add({
            id: p.pid,
            label: `PID: ${p.pid}\n${p.process_name}`,
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