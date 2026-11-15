const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const { executeDynamicSQL } = require('./query.js'); // Import your new Query Engine

const app = express();
app.use(cors());
app.use(express.json()); // Enable JSON parsing for the new POST requests

app.use(express.static(path.join(__dirname, 'public')));

// NEW: The Dynamic Query Endpoint
// The frontend will send the generated SQL string here whenever a filter is applied
app.post('/api/query/:sandboxName', async (req, res) => {
    const sandboxName = req.params.sandboxName;
    const { sqlQuery } = req.body;

    try {
        const rows = await executeDynamicSQL(sandboxName, sqlQuery);
        res.json({ data: rows });
    } catch (error) {
        res.status(500).json({ error: "Failed to execute dynamic query." });
    }
});

// INITIAL LOAD: Keeps the original queries to populate the dashboard on boot
app.get('/api/data/:sandboxName', async (req, res) => {
    const sandboxName = req.params.sandboxName;
    
    try {
        const pool = new Pool({
            user: 'osdbmspbl',
            host: '127.0.0.1',
            database: sandboxName,
            port: 5432,
        });

        const procs = await pool.query('SELECT * FROM process_lifecycle ORDER BY start_time DESC;');
        const memory = await pool.query('SELECT * FROM memory_events ORDER BY timestamp DESC LIMIT 500;');
        const syscalls = await pool.query('SELECT * FROM syscall_telemetry ORDER BY execution_count DESC;');
        const resources = await pool.query('SELECT * FROM resource_snapshots ORDER BY timestamp DESC LIMIT 500;');

        const leaks = await pool.query(`
            SELECT 
                a.pid, 
                COALESCE(p.process_name, 'Unknown') as process_name, 
                a.memory_address, 
                a.requested_bytes, 
                a.timestamp as alloc_time
            FROM memory_events a
            LEFT JOIN memory_events f 
                ON a.pid = f.pid 
                AND a.memory_address = f.memory_address 
                AND f.action = 'FREE'
                AND f.event_id > a.event_id 
            LEFT JOIN process_lifecycle p 
                ON a.pid = p.pid
            WHERE a.action = 'ALLOC' 
              AND a.status = 'GRANTED'
              AND a.memory_address IS NOT NULL 
              AND a.memory_address != '' 
              AND f.event_id IS NULL
            ORDER BY a.timestamp DESC;
        `);

        await pool.end(); 

        res.json({
            process_lifecycle: procs.rows,
            memory_events: memory.rows,
            syscall_telemetry: syscalls.rows,
            resource_snapshots: resources.rows,
            memory_leaks: leaks.rows 
        });
    } catch (error) {
        res.status(500).json({ error: "Database not found or connection failed." });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`API Server running at http://localhost:${PORT} - Open this in your browser!`);
});