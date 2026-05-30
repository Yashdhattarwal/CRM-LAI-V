const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = 'C:/Users/yashd/OneDrive/Desktop/rtnlai.com/server/lai5.db';

async function listTables() {
    const fileBuffer = fs.readFileSync(DB_PATH);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fileBuffer);
    
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'registrations_%'");
    console.log('--- State Specific Tables ---');
    if (tables.length > 0) {
        tables[0].values.forEach(row => {
            const count = db.exec(`SELECT COUNT(*) as c FROM ${row[0]}`)[0].values[0][0];
            if (count > 0) {
                console.log(`${row[0]}: ${count} records`);
            }
        });
    }

    const masterCount = db.exec("SELECT COUNT(*) FROM registrations")[0].values[0][0];
    console.log(`\nMaster registrations table: ${masterCount} records`);
    
    db.close();
}

listTables().catch(console.error);
