// Simple connectivity test for the MS SQL database:
// Data Source=52.186.36.241,1438
// Initial Catalog=RTNMaster_DEV
// User ID=rtnsqlapplicationbot
// Password='RtnP@ssw0rd@)@#'

const sql = require('mssql');

const config = {
  user: 'rtnsqlapplicationbot',
  password: 'RtnP@ssw0rd@)@#',
  server: '52.186.36.241',
  port: 1438,
  database: 'RTNMaster_DEV',
  options: {
    encrypt: true,
    trustServerCertificate: true
  },
  connectionTimeout: 15000,
  requestTimeout: 15000
};

async function main() {
  try {
    console.log('🔗 Connecting to MS SQL...');
    const pool = await sql.connect(config);
    console.log('✅ Connected!');
    const result = await pool.request().query('SELECT 1 AS ping');
    console.log('📊 Result:', result.recordset);
    await pool.close();
    console.log('🔒 Connection closed.');
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
  }
}

main();
