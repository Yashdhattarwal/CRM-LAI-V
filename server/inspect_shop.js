const sql = require('mssql');

const config = {
    user: 'rtnsqlapplicationbot',
    password: 'RtnP@ssw0rd@)@#',
    server: '52.186.36.241',
    port: 1438,
    database: 'RTNMaster_dev',
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

async function run() {
    try {
        let mssqlPool = await sql.connect(config);
        const res = await mssqlPool.request().query('SELECT TOP 1 * FROM RTNShopMaster');
        console.log("COLUMNS & SAMPLE DATA:", res.recordset[0]);
        await sql.close();
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
