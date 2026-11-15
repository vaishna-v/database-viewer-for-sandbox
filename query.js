const { Pool } = require('pg');

// This dedicated Query Engine accepts dynamically generated SQL commands 
// from the frontend and executes them directly on PostgreSQL.
async function executeDynamicSQL(sandboxName, sqlQuery) {
    const pool = new Pool({
        user: 'osdbmspbl',
        host: '127.0.0.1',
        database: sandboxName,
        port: 5432,
    });

    try {
        // Log the query to the terminal so you can prove it's hitting the DB during your demo!
        console.log(`\n[QUERY ENGINE] Executing on database '${sandboxName}':`);
        console.log(`> ${sqlQuery}`);
        
        const result = await pool.query(sqlQuery);
        return result.rows;
    } catch (error) {
        console.error("[QUERY ENGINE ERROR]", error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

module.exports = { executeDynamicSQL };