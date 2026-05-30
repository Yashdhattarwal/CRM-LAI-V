const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'lai5.db');

initSqlJs().then(SQL => {
    const fileBuffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(fileBuffer);
    
    console.log("--- USERS (Last 5) ---");
    const users = db.exec("SELECT id, username, email, role FROM users ORDER BY id DESC LIMIT 5");
    if(users[0]) console.log(JSON.stringify(users[0].values, null, 2));

    console.log("--- REGISTRATIONS (Last 5) ---");
    const regs = db.exec("SELECT id, user_id, shop_id, first_name, email, plan, product FROM registrations ORDER BY id DESC LIMIT 5");
    if(regs[0]) console.log(JSON.stringify(regs[0].values, null, 2));

    console.log("--- PURCHASE HISTORY (Last 5) ---");
    const purchases = db.exec("SELECT * FROM purchase_history ORDER BY id DESC LIMIT 5");
    if(purchases[0]) console.log(JSON.stringify(purchases[0].values, null, 2));

}).catch(err => console.error(err));
