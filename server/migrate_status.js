const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function migrate() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, 'lai5.db');
    const dbData = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbData);
    
    console.log('Migrating users table and creating status logs...');
    try {
        // 1. Add is_active to users
        db.run("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1;");
        console.log('Column is_active added to users.');
    } catch (e) {
        console.log('is_active column might already exist.');
    }
    
    try {
        // 2. Create user_status_logs
        db.run(`
            CREATE TABLE IF NOT EXISTS user_status_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                reason TEXT NOT NULL,
                changed_by_name TEXT NOT NULL,
                changed_by_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('user_status_logs table created.');
    } catch (e) {
        console.error('Error creating table:', e.message);
    }
    
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log('Database saved.');
}
migrate();
