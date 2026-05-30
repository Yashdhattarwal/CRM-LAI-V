const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function check() {
    const SQL = await initSqlJs();
    const dbData = fs.readFileSync(path.join(__dirname, 'lai5.db'));
    const db = new SQL.Database(dbData);
    
    const yash = db.exec("SELECT id, username, first_name, last_name FROM users WHERE username = 'yash' OR first_name = 'Yash'")[0]?.values;
    console.log('Yash Info:', yash);
    
    const logs = db.exec("SELECT id, staff_name, staff_id, comment FROM support_logs WHERE comment = 'rfghuytfv njnm'")[0]?.values;
    console.log('Target Log:', logs);
}
check();
