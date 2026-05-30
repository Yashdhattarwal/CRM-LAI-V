const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function backfill() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, 'lai5.db');
    const dbData = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbData);
    
    // Assign ALL 'Yash Dhattarwal' logs to ID 14 (current active user)
    db.run("UPDATE support_logs SET staff_id = 14 WHERE staff_name LIKE '%Yash%Dhattarwal%'");
    
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log('Final mapping applied.');
}
backfill();
