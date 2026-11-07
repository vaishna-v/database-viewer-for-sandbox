const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(cors());

// Serve the separated HTML/CSS/JS files statically from the public folder
app.use(express.static(path.join(__dirname, 'public')));

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

        // EXTENSION: Advanced SQL Query for Memory Leak Detection
        // FIX: Added 'f.event_id > a.event_id' to prevent false negatives from recycled memory addresses!
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