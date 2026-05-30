const fs = require('fs');
const initSqlJs = require('sql-wasm.js');
const path = require('path');

async function check() {
    const SQL = await initSqlJs();
    const dbPath = path.join(__dirname, 'lai5.db');
    const db = new SQL.Database(fs.readFileSync(dbPath));
    
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'RTNTicketConfig%'");
    console.log('Tables found:', tables[0]?.values.map(v => v[0]));
    
    const masterCount = db.exec("SELECT COUNT(*) FROM RTNTicketConfig")[0].values[0][0];
    console.log('Master count:', masterCount);
    
    if (masterCount > 0) {
        const flCount = db.exec("SELECT COUNT(*) FROM RTNTicketConfig_FL")[0].values[0][0];
        console.log('Florida count:', flCount);
    }
}
check();
