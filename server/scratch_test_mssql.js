const sql = require('mssql');

const config = {
    user: 'rtnsqlapplicationbot',
    password: 'RtnP@ssw0rd@)@#',
    server: '52.186.36.241',
    port: 1438,
    database: 'RTNMaster_Dev',
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

async function run() {
    try {
        console.log('Connecting to MS SQL Server...');
        let pool = await sql.connect(config);
        console.log('Connected!');

        let usersCount = await pool.request().query('SELECT COUNT(*) as c FROM RTNUserMaster');
        console.log('RTNUserMaster count:', usersCount.recordset[0].c);

        let shopsCount = await pool.request().query('SELECT COUNT(*) as c FROM RTNShopMaster');
        console.log('RTNShopMaster count:', shopsCount.recordset[0].c);

        await sql.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

run();
