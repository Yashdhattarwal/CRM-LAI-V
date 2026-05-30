const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function backfill() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, 'lai5.db');
    const dbData = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbData);
    
    console.log('Backfilling staff_id for all logs...');
    
    // 1. System Admin -> 5
    db.run("UPDATE support_logs SET staff_id = 5 WHERE staff_name = 'System Admin' AND staff_id IS NULL");
    
    // 2. Yash Dhattarwal -> 1 (Assuming ID 1 is the main one) or match by name
    db.run("UPDATE support_logs SET staff_id = 1 WHERE staff_name LIKE '%Yash%Dhattarwal%' AND staff_id IS NULL");
    
    // 3. Fallback: try to match staff_name to first_name + last_name
    db.run(`
        UPDATE support_logs 
        SET staff_id = (SELECT id FROM users WHERE (first_name || ' ' || last_name) = support_logs.staff_name LIMIT 1)
        WHERE staff_id IS NULL
    `);

    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log('Done.');
}
backfill();
