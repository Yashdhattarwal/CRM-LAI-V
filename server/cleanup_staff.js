const fs = require('fs');
const initSqlJs = require('sql.js');

async function cleanup() {
    const SQL = await initSqlJs();
    const dbData = fs.readFileSync('lai5.db');
    const db = new SQL.Database(dbData);

    console.log('--- Current Staff Users ---');
    const results = db.exec("SELECT id, username, role FROM users WHERE role IN ('admin', 'manager', 'employee')");
    if (results[0]) {
        results[0].values.forEach(v => console.log(`ID: ${v[0]}, User: ${v[1]}, Role: ${v[2]}`));
    }

    console.log('\nCleaning up all staff except Admin@RTN...');
    db.run("DELETE FROM users WHERE role IN ('manager', 'employee') OR (role = 'admin' AND LOWER(username) != 'admin@rtn')");
    
    // Also clean up any orphan data in staff-related tables if they still exist
    try { db.run("DELETE FROM attendance"); } catch(e){}
    try { db.run("DELETE FROM leave_requests"); } catch(e){}
    try { db.run("DELETE FROM internal_tickets"); } catch(e){}
    try { db.run("DELETE FROM tickets"); } catch(e){}

    const data = db.export();
    fs.writeFileSync('lai5.db', Buffer.from(data));
    console.log('Cleanup complete. lai5.db updated.');
}

cleanup().catch(console.error);
