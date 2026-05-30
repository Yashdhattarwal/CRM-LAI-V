const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function check() {
    const SQL = await initSqlJs();
    const dbData = fs.readFileSync(path.join(__dirname, 'lai5.db'));
    const db = new SQL.Database(dbData);
    
    console.log('--- Support Logs ---');
    try {
        const logs = db.exec("SELECT * FROM support_logs");
        if (logs.length > 0) {
            console.log(JSON.stringify(logs[0].values, null, 2));
        } else {
            console.log('No logs found.');
        }
    } catch (e) {
        console.error('Table error:', e.message);
    }
}
check();
