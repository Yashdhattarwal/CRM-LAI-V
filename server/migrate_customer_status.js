const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function migrate() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, 'lai5.db');
    const dbData = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbData);
    
    console.log('Migrating registrations table and creating customer status logs...');
    
    // 1. Add is_active to registrations
    try {
        db.run("ALTER TABLE registrations ADD COLUMN is_active INTEGER DEFAULT 1;");
        console.log('Column is_active added to registrations.');
    } catch (e) { console.log('is_active column might already exist in registrations.'); }
    
    // 2. Create customer_status_logs
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS customer_status_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                registration_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                changed_by_name TEXT NOT NULL,
                changed_by_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('customer_status_logs table created.');
    } catch (e) { console.error('Error creating table:', e.message); }
    
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log('Database saved.');
}
migrate();
