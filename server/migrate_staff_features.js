const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function migrate() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, 'lai5.db');
    const dbData = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbData);
    
    console.log('Migrating for Staff Dashboard features...');
    
    try {
        // Add manager_id to users to track teams
        db.run(`ALTER TABLE users ADD COLUMN manager_id INTEGER;`);
    } catch (e) { console.log('manager_id column might already exist'); }

    try {
        // Leave Requests table
        db.run(`
            CREATE TABLE IF NOT EXISTS leave_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                staff_id INTEGER,
                start_date TEXT,
                end_date TEXT,
                reason TEXT,
                status TEXT DEFAULT 'Pending', -- Pending, Approved, Rejected
                manager_comment TEXT,
                reviewed_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Internal Tickets table
        db.run(`
            CREATE TABLE IF NOT EXISTS internal_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER,
                sender_name TEXT,
                receiver_role TEXT, -- 'manager' or 'admin'
                subject TEXT,
                message TEXT,
                status TEXT DEFAULT 'Open', -- Open, Closed
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log('Tables created successfully.');
    } catch (e) { console.error('Error creating tables:', e.message); }
    
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log('Database saved.');
}
migrate();
