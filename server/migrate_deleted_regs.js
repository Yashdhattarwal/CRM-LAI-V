const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function migrate() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, 'lai5.db');
    const dbData = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbData);
    
    console.log('Creating deleted_registrations table...');
    
    try {
        db.run(`
            CREATE TABLE IF NOT EXISTS deleted_registrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_id INTEGER,
                store_name TEXT,
                first_name TEXT,
                last_name TEXT,
                email TEXT,
                shop_id TEXT,
                deleted_by_name TEXT,
                deleted_by_id INTEGER,
                deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                full_data_json TEXT
            );
        `);
        console.log('deleted_registrations table created.');
    } catch (e) { console.error('Error creating table:', e.message); }
    
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log('Database saved.');
}
migrate();
