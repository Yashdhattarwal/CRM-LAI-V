const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function backfill() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, 'lai5.db');
    const dbData = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbData);
    
    console.log('Backfilling staff_id...');
    // Update 'System Admin' to ID 5 (Admin@RTN)
    db.run("UPDATE support_logs SET staff_id = 5 WHERE staff_name = 'System Admin' AND staff_id IS NULL");
    
    // For others, if they have a username in the DB, try to match it
    // But for now, we know the user is System Admin
    
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log('Done.');
}
backfill();
