require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
    console.error("❌ Please provide a SQL file path");
    process.exit(1);
}

const sqlPath = path.resolve(process.cwd(), file);
const sql = fs.readFileSync(sqlPath, 'utf-8');

const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

(async () => {
    try {
        await client.connect();
        console.log("✅ Connected");
        await client.query(sql);
        console.log("✅ SQL Executed successfully!");
    } catch (e) {
        console.error("❌ Error executing:", e);
        process.exit(1);
    } finally {
        await client.end();
    }
})();
