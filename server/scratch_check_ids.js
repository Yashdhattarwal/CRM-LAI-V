const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = 'C:/Users/yashd/OneDrive/Desktop/rtnlai.com/server/lai5.db';

async function checkIds() {
    const fileBuffer = fs.readFileSync(DB_PATH);
    const SQL = await initSqlJs();
    const db = new SQL.Database(fileBuffer);
    
    console.log('--- Users ---');
    const users = db.exec("SELECT id, username FROM users");
    if (users.length > 0) {
        console.table(users[0].values.map(v => ({ id: v[0], username: v[1] })));
    } else {
        console.log('No users found.');
    }

    console.log('\n--- Registrations (Master) ---');
    const regs = db.exec("SELECT id, user_id, first_name FROM registrations");
    if (regs.length > 0) {
        console.table(regs[0].values.map(v => ({ id: v[0], user_id: v[1], name: v[2] })));
    } else {
        console.log('No registrations found.');
    }

    db.close();
}

checkIds().catch(console.error);
