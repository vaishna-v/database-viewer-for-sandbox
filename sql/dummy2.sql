BEGIN;

CREATE TABLE process_lifecycle (
    pid INT PRIMARY KEY,
    parent_pid INT REFERENCES process_lifecycle(pid),
    process_name VARCHAR(255) NOT NULL,
    start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    exit_code INT
);

CREATE TABLE memory_events (
    event_id SERIAL PRIMARY KEY,
    pid INT NOT NULL REFERENCES process_lifecycle(pid),
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    action VARCHAR(50) NOT NULL,
    requested_bytes BIGINT,
    status VARCHAR(50) NOT NULL,
    current_total_usage BIGINT,
    memory_address VARCHAR(50)
);

CREATE TABLE syscall_telemetry (
    pid INT NOT NULL REFERENCES process_lifecycle(pid),
    syscall_number INT NOT NULL,
    syscall_name VARCHAR(255) NOT NULL,
    execution_count INT NOT NULL CHECK (execution_count >= 0),
    PRIMARY KEY (pid, syscall_number)
);

CREATE TABLE resource_snapshots (
    snapshot_id SERIAL PRIMARY KEY,
    pid INT NOT NULL REFERENCES process_lifecycle(pid),
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cpu_usage_percent FLOAT NOT NULL CHECK (cpu_usage_percent >= 0 AND cpu_usage_percent <= 100),
    rss_memory_bytes BIGINT NOT NULL CHECK (rss_memory_bytes >= 0)
);

CREATE INDEX idx_mem_pid ON memory_events(pid);
CREATE INDEX idx_mem_time ON memory_events(timestamp);
CREATE INDEX idx_proc_ppid ON process_lifecycle(parent_pid);
CREATE INDEX idx_sys_pid ON syscall_telemetry(pid);
CREATE INDEX idx_resource_pid_time ON resource_snapshots(pid, timestamp DESC);

INSERT INTO process_lifecycle (pid, parent_pid, process_name, start_time, end_time, exit_code) VALUES
    (91001, NULL, 'demo-launcher', CURRENT_TIMESTAMP - INTERVAL '2 hours', NULL, NULL),
    (91002, 91001, 'worker-alpha', CURRENT_TIMESTAMP - INTERVAL '110 minutes', NULL, NULL),
    (91003, 91001, 'memory-probe', CURRENT_TIMESTAMP - INTERVAL '100 minutes', CURRENT_TIMESTAMP - INTERVAL '10 minutes', 0),
    (91004, 91002, 'worker-beta', CURRENT_TIMESTAMP - INTERVAL '80 minutes', NULL, NULL),
    (91005, 91001, 'io-monitor', CURRENT_TIMESTAMP - INTERVAL '60 minutes', CURRENT_TIMESTAMP - INTERVAL '5 minutes', 0);

INSERT INTO memory_events
    (pid, timestamp, action, requested_bytes, status, current_total_usage, memory_address)
VALUES
    (91002, CURRENT_TIMESTAMP - INTERVAL '55 minutes', 'ALLOC', 1024, 'GRANTED', 1024, '0xA100'),
    (91002, CURRENT_TIMESTAMP - INTERVAL '54 minutes', 'FREE', 1024, 'GRANTED', 0, '0xA100'),
    (91003, CURRENT_TIMESTAMP - INTERVAL '45 minutes', 'ALLOC', 4096, 'GRANTED', 4096, '0xB200'),
    (91003, CURRENT_TIMESTAMP - INTERVAL '40 minutes', 'ALLOC', 2048, 'DENIED', 4096, NULL),
    (91004, CURRENT_TIMESTAMP - INTERVAL '35 minutes', 'ALLOC', 512, 'GRANTED', 512, '0xC300'),
    (91004, CURRENT_TIMESTAMP - INTERVAL '34 minutes', 'FREE', 512, 'GRANTED', 0, '0xC300'),
    (91004, CURRENT_TIMESTAMP - INTERVAL '30 minutes', 'ALLOC', 256, 'GRANTED', 256, '0xC300'),
    (91002, CURRENT_TIMESTAMP - INTERVAL '20 minutes', 'ALLOC', 8192, 'GRANTED', 9216, '0xD400'),
    (91005, CURRENT_TIMESTAMP - INTERVAL '12 minutes', 'ALLOC', 128, 'GRANTED', 128, '0xE500'),
    (91005, CURRENT_TIMESTAMP - INTERVAL '11 minutes', 'FREE', 128, 'GRANTED', 0, '0xE500'),
    (91001, CURRENT_TIMESTAMP - INTERVAL '5 minutes', 'ALLOC', 16384, 'GRANTED', 16384, '0xF600');

INSERT INTO syscall_telemetry (pid, syscall_number, syscall_name, execution_count) VALUES
    (91001, 0, 'read', 120),
    (91001, 1, 'write', 85),
    (91001, 60, 'exit', 1),
    (91002, 0, 'read', 950),
    (91002, 1, 'write', 430),
    (91002, 9, 'mmap', 36),
    (91003, 9, 'mmap', 24),
    (91003, 11, 'munmap', 19),
    (91004, 0, 'read', 610),
    (91004, 1, 'write', 705),
    (91005, 4, 'stat', 48),
    (91005, 5, 'fstat', 32);

INSERT INTO resource_snapshots (pid, timestamp, cpu_usage_percent, rss_memory_bytes) VALUES
    (91001, CURRENT_TIMESTAMP - INTERVAL '9 minutes', 2.5, 33554432),
    (91001, CURRENT_TIMESTAMP - INTERVAL '3 minutes', 3.1, 35651584),
    (91002, CURRENT_TIMESTAMP - INTERVAL '8 minutes', 17.8, 125829120),
    (91002, CURRENT_TIMESTAMP - INTERVAL '2 minutes', 23.4, 134217728),
    (91003, CURRENT_TIMESTAMP - INTERVAL '7 minutes', 0.4, 16777216),
    (91003, CURRENT_TIMESTAMP - INTERVAL '1 minutes', 0.1, 12582912),
    (91004, CURRENT_TIMESTAMP - INTERVAL '6 minutes', 12.2, 75497472),
    (91004, CURRENT_TIMESTAMP - INTERVAL '30 seconds', 18.6, 83886080),
    (91005, CURRENT_TIMESTAMP - INTERVAL '4 minutes', 1.7, 25165824);

COMMIT;
