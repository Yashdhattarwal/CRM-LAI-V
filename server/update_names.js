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

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY'
];

async function run() {
    try {
        console.log('Connecting to MS SQL Server...');
        let mssqlPool = await sql.connect(config);
        console.log('Connected!');

        console.log('Updating first_name and last_name on main registrations table...');
        
        // 1. Update main registrations table
        const updateMain = await mssqlPool.request().query(`
            UPDATE r
            SET r.first_name = COALESCE(NULLIF(u.first_name, ''), 'Valued'),
                r.last_name  = COALESCE(NULLIF(u.last_name, ''), 'Customer')
            FROM registrations r
            JOIN users u ON r.user_id = u.id
            WHERE r.first_name = 'Valued' AND r.last_name = 'Customer';
        `);
        console.log(`Updated registrations table. Rows affected: ${updateMain.rowsAffected[0]}`);

        // 2. Update state registrations tables
        for (const st of STATES) {
            try {
                const updateState = await mssqlPool.request().query(`
                    UPDATE r
                    SET r.first_name = COALESCE(NULLIF(u.first_name, ''), 'Valued'),
                        r.last_name  = COALESCE(NULLIF(u.last_name, ''), 'Customer')
                    FROM registrations_${st} r
                    JOIN users u ON r.user_id = u.id
                    WHERE r.first_name = 'Valued' AND r.last_name = 'Customer';
                `);
                if (updateState.rowsAffected[0] > 0) {
                    console.log(`Updated registrations_${st}. Rows affected: ${updateState.rowsAffected[0]}`);
                }
            } catch (err) {
                // Table might not exist or be empty
            }
        }

        console.log('All updates complete!');
        await sql.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

run();
