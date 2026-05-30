const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function check() {
    const SQL = await initSqlJs();
    const dbData = fs.readFileSync(path.join(__dirname, 'lai5.db'));
    const db = new SQL.Database(dbData);
    
    const admin = db.exec("SELECT id, username FROM users WHERE username = 'Admin@RTN'")[0]?.values[0];
    console.log('Admin Info:', admin);
    
    const logs = db.exec("SELECT id, staff_name, staff_id FROM support_logs LIMIT 5");
    console.log('Log Samples:', logs[0]?.values);
}
check();
