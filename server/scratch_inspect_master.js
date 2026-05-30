const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = 'C:/Users/yashd/OneDrive/Desktop/rtnlai.com/server/lai5.db';

async function checkData() {
    const fileBuffer = fs.readFileSync(DB_PATH);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fileBuffer);
    
    console.log('--- Master View ---');
    const master = db.exec("SELECT id, first_name, state, submitted_at FROM registrations");
    if (master.length > 0) {
        console.table(master[0].values.map(v => ({ id: v[0], name: v[1], state: v[2], date: v[3] })));
    } else {
        console.log('No records in master.');
    }

    db.close();
}

checkData().catch(console.error);
