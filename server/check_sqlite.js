const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'lai5.db');

async function run() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        const db = new SQL.Database(fileBuffer);
        
        try {
            const countRegs = db.exec("SELECT COUNT(*) as c FROM registrations")[0].values[0][0];
            console.log(`[SQLITE DIAG] registrations count: ${countRegs}`);
        } catch (e) {
            console.error("[SQLITE DIAG] registrations count failed:", e.message);
        }
        
        try {
            const countUsers = db.exec("SELECT COUNT(*) as c FROM users")[0].values[0][0];
            console.log(`[SQLITE DIAG] users count: ${countUsers}`);
        } catch (e) {
            console.error("[SQLITE DIAG] users count failed:", e.message);
        }
    } else {
        console.log("No lai5.db found!");
    }
}

run();
