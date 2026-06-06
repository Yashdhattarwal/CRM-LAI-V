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

function escapeString(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "''").trim();
}

async function run() {
    try {
        console.log('Connecting to MS SQL Server...');
        let mssqlPool = await sql.connect(config);
        console.log('Connected!');

        console.log('[LEGACY SYNC] Checking for legacy user and shop records to import...');
        
        // 1. Fetch all legacy users
        const legacyUsersRes = await mssqlPool.request().query('SELECT Id, UserName, Passcode, EmailId, PhoneNo1, FirstName, LastName, State, Zip FROM RTNUserMaster');
        const legacyUsers = legacyUsersRes.recordset;
        
        console.log(`[LEGACY SYNC] Found ${legacyUsers.length} legacy users. Checking existing in 'users'...`);
        
        // Load existing emails and usernames to avoid duplicates
        const existingEmails = new Set();
        const existingUsernames = new Set();
        const existingUsersRes = await mssqlPool.request().query('SELECT email, username FROM users');
        existingUsersRes.recordset.forEach(u => {
            if (u.email) existingEmails.add(u.email.toLowerCase().trim());
            if (u.username) existingUsernames.add(u.username.toLowerCase().trim());
        });

        console.log(`[LEGACY SYNC] Found ${existingEmails.size} existing emails in 'users' table.`);

        const password_hash = 'LEGACY_PLAIN_TEXT';
        
        // Batch user imports
        const usersToImport = [];
        for (const u of legacyUsers) {
            const email = (u.EmailId || '').toLowerCase().trim();
            if (!email) continue;
            if (existingEmails.has(email)) continue;
            
            let username = (u.UserName || '').trim() || `customer_${u.Id}`;
            if (existingUsernames.has(username.toLowerCase())) {
                username = `${username}_${u.Id}`;
            }
            
            usersToImport.push({
                id: u.Id,
                username: escapeString(username),
                email: escapeString(email),
                password_hash: escapeString(password_hash),
                passcode: escapeString(u.Passcode || 'RTN@LAI5'),
                first_name: escapeString(u.FirstName || ''),
                last_name: escapeString(u.LastName || '')
            });
            existingEmails.add(email);
            existingUsernames.add(username.toLowerCase());
        }

        console.log(`[LEGACY SYNC] ${usersToImport.length} users queued for import.`);

        let userImportCount = 0;
        const BATCH_SIZE = 100;
        for (let i = 0; i < usersToImport.length; i += BATCH_SIZE) {
            const batch = usersToImport.slice(i, i + BATCH_SIZE);
            
            // Build batch of IF NOT EXISTS insertions
            let query = `SET IDENTITY_INSERT users ON;\n`;
            batch.forEach(u => {
                query += `
                    IF NOT EXISTS (SELECT 1 FROM users WHERE id = ${u.id} OR email = '${u.email}' OR username = '${u.username}')
                    BEGIN
                        INSERT INTO users (id, username, email, password_hash, passcode, first_name, last_name, role, is_active)
                        VALUES (${u.id}, '${u.username}', '${u.email}', '${u.password_hash}', '${u.passcode}', '${u.first_name}', '${u.last_name}', 'customer', 1);
                    END
                `;
            });
            query += `\nSET IDENTITY_INSERT users OFF;`;

            try {
                await mssqlPool.request().query(query);
                userImportCount += batch.length;
            } catch (err) {
                console.error(`[LEGACY SYNC ERROR] User batch failed:`, err.message);
            }
        }
        console.log(`[LEGACY SYNC] Completed users import batch sequence.`);

        // 2. Fetch all legacy shops
        const legacyShopsRes = await mssqlPool.request().query('SELECT Id, EmailId, LocationName, LegalName, Address, StreetNo, Street, City, State, Zip, Phone, Phone2 FROM RTNShopMaster');
        const legacyShops = legacyShopsRes.recordset;
        
        console.log(`[LEGACY SYNC] Found ${legacyShops.length} legacy shops. Checking 'registrations'...`);
        
        // Load existing shop_ids
        const existingShops = new Set();
        const existingRegsRes = await mssqlPool.request().query('SELECT shop_id FROM registrations');
        existingRegsRes.recordset.forEach(r => {
            if (r.shop_id) existingShops.add(r.shop_id.toLowerCase().trim());
        });

        console.log(`[LEGACY SYNC] Found ${existingShops.size} existing registrations in 'registrations' table.`);

        // Map email to user data (id, first_name, last_name)
        const emailToUserData = {};
        const allUsers = await mssqlPool.request().query("SELECT id, email, first_name, last_name FROM users");
        allUsers.recordset.forEach(u => {
            if (u.email) {
                emailToUserData[u.email.toLowerCase().trim()] = {
                    id: u.id,
                    firstName: u.first_name,
                    lastName: u.last_name
                };
            }
        });

        const shopsToImport = [];
        for (const s of legacyShops) {
            const shop_id = String(s.Id).trim();
            if (existingShops.has(shop_id.toLowerCase())) continue;
            
            const email = (s.EmailId || '').toLowerCase().trim();
            const matchedUser = emailToUserData[email] || {};
            const user_id = matchedUser.id || null;
            const first_name = matchedUser.firstName || 'Valued';
            const last_name = matchedUser.lastName || 'Customer';
            
            let fullAddress = (s.Address || '').trim();
            if (!fullAddress && (s.StreetNo || s.Street)) {
                fullAddress = `${s.StreetNo || ''} ${s.Street || ''}`.trim();
            }
            
            const storeName = (s.LocationName || '').trim() || 'Store';
            const corpName = (s.LegalName || '').trim() || 'Corporation';
            const mobile = (s.Phone || '').trim() || '';
            const phone = (s.Phone2 || '').trim() || '';
            
            const stateCode = (s.State || 'GA').toUpperCase().trim();
            const dateOneYearOut = new Date();
            dateOneYearOut.setFullYear(dateOneYearOut.getFullYear() + 1);
            const expiryDate = dateOneYearOut.toISOString().split('T')[0];

            shopsToImport.push({
                id: s.Id,
                user_id: user_id,
                shop_id: escapeString(shop_id),
                first_name: escapeString(first_name),
                last_name: escapeString(last_name),
                email: escapeString(email || 'info@rtnlai.com'),
                mobile: escapeString(mobile),
                store_phone: escapeString(phone),
                address: escapeString(fullAddress),
                city: escapeString(s.City || ''),
                state: escapeString(stateCode),
                zipcode: escapeString(s.Zip || ''),
                store_name: escapeString(storeName),
                corporation: escapeString(corpName),
                expiry_date: expiryDate
            });
            existingShops.add(shop_id.toLowerCase());
        }

        console.log(`[LEGACY SYNC] ${shopsToImport.length} shops queued for import.`);

        let shopImportCount = 0;
        for (let i = 0; i < shopsToImport.length; i += BATCH_SIZE) {
            const batch = shopsToImport.slice(i, i + BATCH_SIZE);
            
            let query = `SET IDENTITY_INSERT registrations ON;\n`;
            batch.forEach(s => {
                query += `
                    IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = ${s.id} OR shop_id = '${s.shop_id}')
                    BEGIN
                        INSERT INTO registrations (id, user_id, shop_id, first_name, last_name, email, mobile, store_phone, address, city, state, zipcode, store_name, corporation, product, [plan], status, expiry_date)
                        VALUES (${s.id}, ${s.user_id || 'NULL'}, '${s.shop_id}', '${s.first_name}', '${s.last_name}', '${s.email}', '${s.mobile}', '${s.store_phone}', '${s.address}', '${s.city}', '${s.state}', '${s.zipcode}', '${s.store_name}', '${s.corporation}', 'LAI V', 'Yearly', 'active', '${s.expiry_date}');
                    END
                `;
            });
            query += `\nSET IDENTITY_INSERT registrations OFF;`;

            try {
                await mssqlPool.request().query(query);
                
                // Group by state for lightning fast batched inserts into registrations_XX
                const byState = {};
                batch.forEach(s => {
                    if (STATES.includes(s.state)) {
                        if (!byState[s.state]) byState[s.state] = [];
                        byState[s.state].push(s);
                    }
                });

                for (const st of Object.keys(byState)) {
                    let stQuery = `SET IDENTITY_INSERT registrations_${st} ON;\n`;
                    byState[st].forEach(s => {
                        stQuery += `
                            IF NOT EXISTS (SELECT 1 FROM registrations_${st} WHERE id = ${s.id})
                            BEGIN
                                INSERT INTO registrations_${st} (id, user_id, shop_id, first_name, last_name, email, mobile, store_phone, address, city, state, zipcode, store_name, corporation, product, [plan], status, expiry_date)
                                VALUES (${s.id}, ${s.user_id || 'NULL'}, '${s.shop_id}', '${s.first_name}', '${s.last_name}', '${s.email}', '${s.mobile}', '${s.store_phone}', '${s.address}', '${s.city}', '${s.state}', '${s.zipcode}', '${s.store_name}', '${s.corporation}', 'LAI V', 'Yearly', 'active', '${s.expiry_date}');
                            END
                        `;
                    });
                    stQuery += `\nSET IDENTITY_INSERT registrations_${st} OFF;`;
                    await mssqlPool.request().query(stQuery).catch(() => {});
                }

                shopImportCount += batch.length;
            } catch (err) {
                console.error(`[LEGACY SYNC ERROR] Shop batch failed:`, err.message);
            }
        }
        console.log(`[LEGACY SYNC] Successfully imported ${shopImportCount} registrations.`);

        await sql.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

run();
