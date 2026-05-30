const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = 'C:/Users/yashd/OneDrive/Desktop/rtnlai.com/server/lai5.db';

async function checkColumns() {
    const fileBuffer = fs.readFileSync(DB_PATH);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fileBuffer);
    
    const info = db.exec("PRAGMA table_info(registrations)");
    console.log('--- Current Columns in registrations ---');
    if (info.length > 0) {
        info[0].values.forEach(v => console.log(v[1]));
    }
    
    db.close();
}

checkColumns().catch(console.error);
