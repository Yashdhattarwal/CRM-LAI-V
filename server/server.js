/**
 * RTN LAI 5 – Backend API Server
 * Express + sql.js (pure-JS SQLite) + bcryptjs
 *
 * Endpoints:
 *   POST /api/register        – Create user + store registration
 *   POST /api/login           – Authenticate, start session
 *   GET  /api/me              – Return current session user
 *   POST /api/logout          – Destroy session
 *   GET  /api/admin/users     – List all registrations
 *   GET  /api/admin/stats     – Summary counts
 */

const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const initSqlJs = require('sql.js');
const multer    = require('multer');
const pdfService = require('./services/pdfService');
const mailer = require('./services/mailer');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3001;
const DB_PATH     = path.join(__dirname, 'lai5.db');
const FRONTEND    = path.join(__dirname, '..', 'New code');
const ADMIN_PORTAL = path.join(__dirname, '..', 'admin-portal');
const UPLOADS     = path.join(__dirname, 'attachments');

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

// ─── Express setup ────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', 1); // Trust Localtunnel/Proxy headers
app.use(express.static(FRONTEND));
app.use('/admin', express.static(ADMIN_PORTAL));
app.use('/attachments', express.static(UPLOADS));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: true }));
app.use(session({
  secret: 'lai5-super-secret-2025',
  resave: true,
  saveUninitialized: true,
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000, 
    httpOnly: true,
    secure: false, // Set to false to allow Localtunnel/HTTP mapping
    sameSite: 'lax'
  }
}));

// ─── Database helpers ─────────────────────────────────────────────────────────
const sql = require('mssql');

const mssqlConfig = {
    user: 'rtnsqlapplicationbot',
    password: 'RtnP@ssw0rd@)@#',
    server: '52.186.36.241',
    port: 1438,
    database: 'RTNMaster_Dev',
    connectionTimeout: 10000,
    requestTimeout: 10000,
    options: {
        encrypt: true,
        trustServerCertificate: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

let mssqlPool = null;
let mssqlConnectionError = null;
let db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Helper to asynchronously execute SQLite mutations on Microsoft SQL Server
function runMssqlQuery(queryStr, params = []) {
    if (!mssqlPool) return Promise.resolve();
    
    let converted = queryStr;
    
    // Replace SQLite specific INSERT OR IGNORE with standard INSERT
    converted = converted.replace(/INSERT OR IGNORE/gi, 'INSERT');

    // Replace SQLite specific INSERT OR REPLACE with standard INSERT
    if (converted.toUpperCase().includes('INSERT OR REPLACE INTO')) {
        const match = converted.match(/INSERT OR REPLACE INTO\s+(\w+)\s*\((.*?)\)\s*VALUES\s*\((.*?)\)/is);
        if (match) {
            const tableName = match[1];
            const cols = match[2].split(',').map(c => c.trim());
            const idColIndex = cols.indexOf('id');
            if (idColIndex !== -1 && params[idColIndex] !== undefined) {
                // Pre-delete record on MS SQL to avoid primary key/unique constraint violations
                const deleteReq = mssqlPool.request();
                deleteReq.input('delete_id', params[idColIndex]);
                deleteReq.query(`DELETE FROM ${tableName} WHERE id = @delete_id`).catch(e => {
                    console.warn(`[MSSQL DUAL-SYNC WARNING] Pre-delete failed for ${tableName}:`, e.message);
                });
            }
        }
        converted = converted.replace(/INSERT OR REPLACE INTO/gi, 'INSERT INTO');
    }
    
    // Replace ? placeholders with T-SQL @p0, @p1, @p2...
    let paramIndex = 0;
    converted = converted.replace(/\?/g, () => {
        return `@p${paramIndex++}`;
    });

    const req = mssqlPool.request();
    params.forEach((val, i) => {
        req.input(`p${i}`, val);
    });

    return req.query(converted).catch(err => {
        console.warn(`[MSSQL DUAL-SYNC WARNING] Query failed on cloud MS SQL Server:`, err.message);
        console.warn(`Query:`, converted);
    });
}

// ─── States List ─────────────────────────────────────────────────────────────
const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY'
];

const STATE_NAME_TO_CODE = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
    'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
    'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
    'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
    'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
    'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
    'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
    'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
};

async function createMssqlTables() {
    const schemas = [
        `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[users]') AND type in (N'U'))
         CREATE TABLE users (
             id INT IDENTITY(1,1) PRIMARY KEY,
             username NVARCHAR(255) UNIQUE NOT NULL,
             email NVARCHAR(255) UNIQUE NOT NULL,
             password_hash NVARCHAR(255) NOT NULL,
             passcode NVARCHAR(255),
             first_name NVARCHAR(255),
             last_name NVARCHAR(255),
             role NVARCHAR(50) DEFAULT 'customer',
             is_active INT DEFAULT 1,
             created_at DATETIME DEFAULT GETDATE()
         )`,
         
         `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[registrations]') AND type in (N'U'))
          CREATE TABLE registrations (
              id INT IDENTITY(1,1) PRIMARY KEY,
              user_id INT,
              shop_id NVARCHAR(255) UNIQUE,
              passcode NVARCHAR(255),
              first_name NVARCHAR(255) NOT NULL,
              last_name NVARCHAR(255) NOT NULL,
              email NVARCHAR(255) NOT NULL,
              mobile NVARCHAR(255),
              store_phone NVARCHAR(255),
              address NVARCHAR(255),
              city NVARCHAR(255),
              state NVARCHAR(255),
              zipcode NVARCHAR(255),
              store_name NVARCHAR(255),
              corporation NVARCHAR(255),
              product NVARCHAR(255),
              [plan] NVARCHAR(255),
              scanner NVARCHAR(255),
              shipping NVARCHAR(255),
              payment_mode NVARCHAR(255),
              bank_name NVARCHAR(255),
              routing_no NVARCHAR(255),
              account_no NVARCHAR(255),
              account_type NVARCHAR(255),
              account_name NVARCHAR(255),
              card_no NVARCHAR(255),
              status NVARCHAR(255) DEFAULT 'pending',
              is_active INT DEFAULT 1,
              expiry_date NVARCHAR(255),
              submitted_at DATETIME DEFAULT GETDATE()
          )`,
          
          `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[support_logs]') AND type in (N'U'))
           CREATE TABLE support_logs (
               id INT IDENTITY(1,1) PRIMARY KEY,
               registration_id INT NOT NULL,
               comment NVARCHAR(MAX) NOT NULL,
               caller_number   NVARCHAR(255),
               staff_name      NVARCHAR(255),
               staff_id        INT,
               attachment_path NVARCHAR(500),
               created_at      DATETIME DEFAULT GETDATE()
           )`,
           
           `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[audit_logs]') AND type in (N'U'))
            CREATE TABLE audit_logs (
                id INT IDENTITY(1,1) PRIMARY KEY,
                user_id INT NOT NULL,
                resource_type NVARCHAR(255) NOT NULL,
                resource_id NVARCHAR(255) NOT NULL,
                changes NVARCHAR(MAX) NOT NULL,
                timestamp DATETIME DEFAULT GETDATE()
            )`,
            
            `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[purchase_history]') AND type in (N'U'))
             CREATE TABLE purchase_history (
                 id INT IDENTITY(1,1) PRIMARY KEY,
                 registration_id INT NOT NULL,
                 amount FLOAT NOT NULL,
                 details NVARCHAR(MAX) NOT NULL,
                 invoice_date DATETIME DEFAULT GETDATE(),
                 attachment_path NVARCHAR(500)
             )`,
             
             `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[deleted_registrations]') AND type in (N'U'))
              CREATE TABLE deleted_registrations (
                  id INT IDENTITY(1,1) PRIMARY KEY,
                  original_id INT,
                  store_name NVARCHAR(255),
                  first_name NVARCHAR(255),
                  last_name NVARCHAR(255),
                  email NVARCHAR(255),
                  shop_id NVARCHAR(255),
                  deleted_by_name NVARCHAR(255),
                  deleted_by_id INT,
                  deletion_reason NVARCHAR(MAX),
                  deleted_at DATETIME DEFAULT GETDATE(),
                  full_data_json NVARCHAR(MAX)
              )`,
              
              `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[attendance]') AND type in (N'U'))
               CREATE TABLE attendance (
                   id INT IDENTITY(1,1) PRIMARY KEY,
                   user_id INT NOT NULL,
                   login_time DATETIME,
                   logout_time DATETIME,
                   date DATE DEFAULT GETDATE()
               )`,

              `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[user_status_logs]') AND type in (N'U'))
               CREATE TABLE user_status_logs (
                   id INT IDENTITY(1,1) PRIMARY KEY,
                   user_id INT NOT NULL,
                   status NVARCHAR(255) NOT NULL,
                   reason NVARCHAR(MAX) NOT NULL,
                   changed_by_name NVARCHAR(255) NOT NULL,
                   changed_by_id INT NOT NULL,
                   created_at DATETIME DEFAULT GETDATE()
               )`,

              `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[customer_status_logs]') AND type in (N'U'))
               CREATE TABLE customer_status_logs (
                   id INT IDENTITY(1,1) PRIMARY KEY,
                   registration_id INT NOT NULL,
                   status NVARCHAR(255) NOT NULL,
                   reason NVARCHAR(MAX) NOT NULL,
                   changed_by_name NVARCHAR(255) NOT NULL,
                   changed_by_id INT NOT NULL,
                   created_at DATETIME DEFAULT GETDATE()
               )`,
               
               `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[RTNTicketConfig]') AND type in (N'U'))
                CREATE TABLE RTNTicketConfig (
                    id INT PRIMARY KEY,
                    StateId INT NOT NULL,
                    State NVARCHAR(255) NOT NULL,
                    TicketLength INT NOT NULL,
                    TicketId_start INT NOT NULL,
                    TicketId_length INT NOT NULL,
                    PackNo_start INT NOT NULL,
                    PackNo_length INT NOT NULL,
                    PackPos_start INT NOT NULL,
                    PackPos_length INT NOT NULL
                )`,

               `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[leads]') AND type in (N'U'))
                CREATE TABLE leads (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    source NVARCHAR(255) NOT NULL,
                    external_lead_id NVARCHAR(255) UNIQUE,
                    campaign_name NVARCHAR(255),
                    ad_set_name NVARCHAR(255),
                    lead_name NVARCHAR(255) NOT NULL,
                    email NVARCHAR(255),
                    phone NVARCHAR(255),
                    normalized_phone NVARCHAR(255),
                    store_name NVARCHAR(255),
                    city NVARCHAR(255),
                    state NVARCHAR(255),
                    pos_system NVARCHAR(255),
                    status NVARCHAR(255) DEFAULT 'New',
                    assigned_to INT REFERENCES users(id),
                    notes NVARCHAR(MAX),
                    created_at DATETIME DEFAULT GETDATE(),
                    updated_at DATETIME DEFAULT GETDATE()
                )`,

               `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[lead_activities]') AND type in (N'U'))
                CREATE TABLE lead_activities (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    lead_id INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                    activity_type NVARCHAR(255) NOT NULL,
                    activity_notes NVARCHAR(MAX),
                    created_by NVARCHAR(255) NOT NULL,
                    created_at DATETIME DEFAULT GETDATE()
                )`,

               `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[lead_sources]') AND type in (N'U'))
                CREATE TABLE lead_sources (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    source_name NVARCHAR(255) UNIQUE NOT NULL,
                    source_type NVARCHAR(255) NOT NULL,
                    active INT DEFAULT 1
                )`,
                
               `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[lead_api_keys]') AND type in (N'U'))
                CREATE TABLE lead_api_keys (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    key_name NVARCHAR(255) NOT NULL,
                    api_key NVARCHAR(255) UNIQUE NOT NULL,
                    api_secret NVARCHAR(255) NOT NULL,
                    active INT DEFAULT 1,
                    created_by NVARCHAR(255) NOT NULL,
                    created_at DATETIME DEFAULT GETDATE(),
                    last_used_at DATETIME
                )`,
                
               `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[crm_settings]') AND type in (N'U'))
                CREATE TABLE crm_settings (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    setting_key NVARCHAR(255) UNIQUE NOT NULL,
                    setting_value NVARCHAR(MAX),
                    updated_at DATETIME DEFAULT GETDATE()
                )`,

               `IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[meta_sync_logs]') AND type in (N'U'))
                CREATE TABLE meta_sync_logs (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    lead_id INT,
                    facebook_lead_id NVARCHAR(255),
                    status NVARCHAR(50) NOT NULL,
                    error_message NVARCHAR(MAX),
                    payload NVARCHAR(MAX),
                    created_at DATETIME DEFAULT GETDATE()
                )`
    ];
    await Promise.all(schemas.map(q => 
        mssqlPool.request().query(q).catch(e => {
            console.error('[MSSQL SCHEMA ERROR]', e.message);
        })
    ));

    // Dynamic state tables
    const stateQueries = [];
    for (const st of STATES) {
        const stateRegSchema = `
            IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[registrations_${st}]') AND type in (N'U'))
            CREATE TABLE registrations_${st} (
                id INT IDENTITY(1,1) PRIMARY KEY,
                user_id INT,
                shop_id NVARCHAR(255) UNIQUE,
                passcode NVARCHAR(255),
                first_name NVARCHAR(255) NOT NULL,
                last_name NVARCHAR(255) NOT NULL,
                email NVARCHAR(255) NOT NULL,
                mobile NVARCHAR(255),
                store_phone NVARCHAR(255),
                address NVARCHAR(255),
                city NVARCHAR(255),
                state NVARCHAR(255),
                zipcode NVARCHAR(255),
                store_name NVARCHAR(255),
                corporation NVARCHAR(255),
                product NVARCHAR(255),
                [plan] NVARCHAR(255),
                scanner NVARCHAR(255),
                shipping NVARCHAR(255),
                payment_mode NVARCHAR(255),
                bank_name NVARCHAR(255),
                routing_no NVARCHAR(255),
                account_no NVARCHAR(255),
                account_type NVARCHAR(255),
                account_name NVARCHAR(255),
                card_no NVARCHAR(255),
                status NVARCHAR(255) DEFAULT 'pending',
                is_active INT DEFAULT 1,
                expiry_date NVARCHAR(255),
                submitted_at DATETIME DEFAULT GETDATE()
            )
        `;
        const stateTicketSchema = `
            IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[RTNTicketConfig_${st}]') AND type in (N'U'))
            CREATE TABLE RTNTicketConfig_${st} (
                id INT PRIMARY KEY,
                StateId INT NOT NULL,
                State NVARCHAR(255) NOT NULL,
                TicketLength INT NOT NULL,
                TicketId_start INT NOT NULL,
                TicketId_length INT NOT NULL,
                PackNo_start INT NOT NULL,
                PackNo_length INT NOT NULL,
                PackPos_start INT NOT NULL,
                PackPos_length INT NOT NULL
            )
        `;
        stateQueries.push(mssqlPool.request().query(stateRegSchema).catch(e => {}));
        stateQueries.push(mssqlPool.request().query(stateTicketSchema).catch(e => {}));
    }
    await Promise.all(stateQueries);

    // Perform migrations on MS SQL to ensure existing tables have is_active
    try {
        await mssqlPool.request().query("ALTER TABLE registrations ADD is_active INT DEFAULT 1");
    } catch (e) {}
    for (const st of STATES) {
        try {
            await mssqlPool.request().query(`ALTER TABLE registrations_${st} ADD is_active INT DEFAULT 1`);
        } catch (e) {}
    }
}

async function syncLegacyCsharpData() {
    if (!mssqlPool) return;
    try {
        console.log('[LEGACY SYNC] Checking for legacy user and shop records to import...');
        
        // 1. Fetch all legacy users
        const legacyUsersRes = await mssqlPool.request().query('SELECT Id, UserName, Passcode, EmailId, PhoneNo1, FirstName, LastName, State, Zip FROM RTNUserMaster');
        const legacyUsers = legacyUsersRes.recordset;
        
        console.log(`[LEGACY SYNC] Found ${legacyUsers.length} legacy users. Synchronizing to 'users'...`);
        
        // Load existing emails in our system to avoid duplicates
        const existingEmails = new Set();
        const existingUsersRes = await mssqlPool.request().query('SELECT email FROM users');
        existingUsersRes.recordset.forEach(u => {
            if (u.email) existingEmails.add(u.email.toLowerCase().trim());
        });

        const salt = await bcrypt.genSalt(10);
        
        // Import users
        let userImportCount = 0;
        for (const u of legacyUsers) {
            const email = (u.EmailId || '').toLowerCase().trim();
            if (!email) continue;
            if (existingEmails.has(email)) continue; // Skip already imported or existing
            
            const username = (u.UserName || '').trim() || `customer_${u.Id}`;
            const passcode = (u.Passcode || '').trim() || 'RTN@LAI5';
            
            // Hash passcode for secure logins in Node app
            const password_hash = await bcrypt.hash(passcode, salt);
            
            try {
                // Insert into MS SQL users table
                const insertUserReq = mssqlPool.request();
                insertUserReq.input('id', u.Id);
                insertUserReq.input('username', username);
                insertUserReq.input('email', email);
                insertUserReq.input('password_hash', password_hash);
                insertUserReq.input('passcode', passcode);
                insertUserReq.input('first_name', u.FirstName || '');
                insertUserReq.input('last_name', u.LastName || '');
                
                await insertUserReq.query(`
                    SET IDENTITY_INSERT users ON;
                    INSERT INTO users (id, username, email, password_hash, passcode, first_name, last_name, role, is_active)
                    VALUES (@id, @username, @email, @password_hash, @passcode, @first_name, @last_name, 'customer', 1);
                    SET IDENTITY_INSERT users OFF;
                `);
                
                // Also insert into our local SQLite instance
                db.run(`
                    INSERT OR REPLACE INTO users (id, username, email, password_hash, passcode, first_name, last_name, role, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'customer', 1)
                `, [u.Id, username, email, password_hash, passcode, u.FirstName || '', u.LastName || '']);
                
                existingEmails.add(email);
                userImportCount++;
            } catch (err) {
                try {
                    const insertUserReq = mssqlPool.request();
                    insertUserReq.input('username', username);
                    insertUserReq.input('email', email);
                    insertUserReq.input('password_hash', password_hash);
                    insertUserReq.input('passcode', passcode);
                    insertUserReq.input('first_name', u.FirstName || '');
                    insertUserReq.input('last_name', u.LastName || '');
                    
                    const res = await insertUserReq.query(`
                        INSERT INTO users (username, email, password_hash, passcode, first_name, last_name, role, is_active)
                        VALUES (@username, @email, @password_hash, @passcode, @first_name, @last_name, 'customer', 1);
                        SELECT SCOPE_IDENTITY() as new_id;
                    `);
                    
                    const newId = res.recordset[0]?.new_id;
                    if (newId) {
                        db.run(`
                            INSERT OR REPLACE INTO users (id, username, email, password_hash, passcode, first_name, last_name, role, is_active)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 'customer', 1)
                        `, [newId, username, email, password_hash, passcode, u.FirstName || '', u.LastName || '']);
                    }
                    existingEmails.add(email);
                    userImportCount++;
                } catch (e) {}
            }
        }
        console.log(`[LEGACY SYNC] Successfully imported ${userImportCount} new users.`);
        
        // 2. Fetch all legacy shops
        const legacyShopsRes = await mssqlPool.request().query('SELECT Id, EmailId, LocationName, LegalName, Address, StreetNo, Street, City, State, Zip, Phone, Phone2 FROM RTNShopMaster');
        const legacyShops = legacyShopsRes.recordset;
        
        console.log(`[LEGACY SYNC] Found ${legacyShops.length} legacy shops. Synchronizing to 'registrations'...`);
        
        // Load existing shop_ids
        const existingShops = new Set();
        const existingRegsRes = await mssqlPool.request().query('SELECT shop_id FROM registrations');
        existingRegsRes.recordset.forEach(r => {
            if (r.shop_id) existingShops.add(r.shop_id.toLowerCase().trim());
        });

        let shopImportCount = 0;
        
        // Map email to user ID in SQLite
        const emailToUserId = {};
        const allUsers = dbAll("SELECT id, email FROM users");
        allUsers.forEach(u => {
            if (u.email) emailToUserId[u.email.toLowerCase().trim()] = u.id;
        });

        for (const s of legacyShops) {
            const shop_id = String(s.Id).trim();
            if (existingShops.has(shop_id.toLowerCase())) continue; // Skip existing
            
            const email = (s.EmailId || '').toLowerCase().trim();
            const user_id = emailToUserId[email] || null;
            
            // Format address
            let fullAddress = (s.Address || '').trim();
            if (!fullAddress && (s.StreetNo || s.Street)) {
                fullAddress = `${s.StreetNo || ''} ${s.Street || ''}`.trim();
            }
            
            const storeName = (s.LocationName || '').trim() || 'Store';
            const corpName = (s.LegalName || '').trim() || 'Corporation';
            const mobile = (s.Phone || '').trim() || '';
            const phone = (s.Phone2 || '').trim() || '';
            
            let firstName = 'Valued';
            let lastName = 'Customer';
            const linkedUser = dbGet("SELECT first_name, last_name FROM users WHERE id = ?", [user_id]);
            if (linkedUser) {
                firstName = linkedUser.first_name || firstName;
                lastName = linkedUser.last_name || lastName;
            }

            const stateCode = (s.State || 'GA').toUpperCase().trim();
            const dateOneYearOut = new Date();
            dateOneYearOut.setFullYear(dateOneYearOut.getFullYear() + 1);
            const expiryDate = dateOneYearOut.toISOString().split('T')[0];

            try {
                const insertRegReq = mssqlPool.request();
                insertRegReq.input('id', s.Id);
                insertRegReq.input('user_id', user_id);
                insertRegReq.input('shop_id', shop_id);
                insertRegReq.input('first_name', firstName);
                insertRegReq.input('last_name', lastName);
                insertRegReq.input('email', email || 'info@rtnlai.com');
                insertRegReq.input('mobile', mobile);
                insertRegReq.input('store_phone', phone);
                insertRegReq.input('address', fullAddress);
                insertRegReq.input('city', s.City || '');
                insertRegReq.input('state', stateCode);
                insertRegReq.input('zipcode', s.Zip || '');
                insertRegReq.input('store_name', storeName);
                insertRegReq.input('corporation', corpName);
                insertRegReq.input('expiry_date', expiryDate);

                await insertRegReq.query(`
                    SET IDENTITY_INSERT registrations ON;
                    INSERT INTO registrations (id, user_id, shop_id, first_name, last_name, email, mobile, store_phone, address, city, state, zipcode, store_name, corporation, product, [plan], status, expiry_date)
                    VALUES (@id, @user_id, @shop_id, @first_name, @last_name, @email, @mobile, @store_phone, @address, @city, @state, @zipcode, @store_name, @corporation, 'LAI V', 'Yearly', 'active', @expiry_date);
                    SET IDENTITY_INSERT registrations OFF;
                `);
                
                // Mirror into state table
                if (STATES.includes(stateCode)) {
                    await mssqlPool.request().query(`
                        SET IDENTITY_INSERT registrations_${stateCode} ON;
                        INSERT INTO registrations_${stateCode} (id, user_id, shop_id, first_name, last_name, email, mobile, store_phone, address, city, state, zipcode, store_name, corporation, product, [plan], status, expiry_date)
                        VALUES (${s.Id}, ${user_id || 'NULL'}, '${shop_id}', '${firstName}', '${lastName}', '${email || 'info@rtnlai.com'}', '${mobile}', '${phone}', '${fullAddress}', '${s.City || ''}', '${stateCode}', '${s.Zip || ''}', '${storeName}', '${corpName}', 'LAI V', 'Yearly', 'active', '${expiryDate}');
                        SET IDENTITY_INSERT registrations_${stateCode} OFF;
                    `).catch(e => {});
                }

                // Also insert into our local SQLite instance
                db.run(`
                    INSERT OR REPLACE INTO registrations (id, user_id, shop_id, first_name, last_name, email, mobile, store_phone, address, city, state, zipcode, store_name, corporation, product, plan, status, expiry_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LAI V', 'Yearly', 'active', ?)
                `, [s.Id, user_id, shop_id, firstName, lastName, email || 'info@rtnlai.com', mobile, phone, fullAddress, s.City || '', stateCode, s.Zip || '', storeName, corpName, expiryDate]);
                
                if (STATES.includes(stateCode)) {
                    db.run(`
                        INSERT OR REPLACE INTO registrations_${stateCode} (id, user_id, shop_id, first_name, last_name, email, mobile, store_phone, address, city, state, zipcode, store_name, corporation, product, plan, status, expiry_date)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LAI V', 'Yearly', 'active', ?)
                    `, [s.Id, user_id, shop_id, firstName, lastName, email || 'info@rtnlai.com', mobile, phone, fullAddress, s.City || '', stateCode, s.Zip || '', storeName, corpName, expiryDate]);
                }

                existingShops.add(shop_id.toLowerCase());
                shopImportCount++;
            } catch (err) {
                try {
                    const insertRegReq = mssqlPool.request();
                    insertRegReq.input('user_id', user_id);
                    insertRegReq.input('shop_id', shop_id);
                    insertRegReq.input('first_name', firstName);
                    insertRegReq.input('last_name', lastName);
                    insertRegReq.input('email', email || 'info@rtnlai.com');
                    insertRegReq.input('mobile', mobile);
                    insertRegReq.input('store_phone', phone);
                    insertRegReq.input('address', fullAddress);
                    insertRegReq.input('city', s.City || '');
                    insertRegReq.input('state', stateCode);
                    insertRegReq.input('zipcode', s.Zip || '');
                    insertRegReq.input('store_name', storeName);
                    insertRegReq.input('corporation', corpName);
                    insertRegReq.input('expiry_date', expiryDate);

                    const res = await insertRegReq.query(`
                        INSERT INTO registrations (user_id, shop_id, first_name, last_name, email, mobile, store_phone, address, city, state, zipcode, store_name, corporation, product, [plan], status, expiry_date)
                        VALUES (@user_id, @shop_id, @first_name, @last_name, @email, @mobile, @store_phone, @address, @city, @state, @zipcode, @store_name, @corporation, 'LAI V', 'Yearly', 'active', @expiry_date);
                        SELECT SCOPE_IDENTITY() as new_id;
                    `);
                    
                    const newId = res.recordset[0]?.new_id;
                    if (newId) {
                        db.run(`
                            INSERT OR REPLACE INTO registrations (id, user_id, shop_id, first_name, last_name, email, mobile, store_phone, address, city, state, zipcode, store_name, corporation, product, plan, status, expiry_date)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LAI V', 'Yearly', 'active', ?)
                        `, [newId, user_id, shop_id, firstName, lastName, email || 'info@rtnlai.com', mobile, phone, fullAddress, s.City || '', stateCode, s.Zip || '', storeName, corpName, expiryDate]);
                    }
                    existingShops.add(shop_id.toLowerCase());
                    shopImportCount++;
                } catch (e) {}
            }
        }
        console.log(`[LEGACY SYNC] Successfully imported ${shopImportCount} new registrations.`);
        
        saveDb();
    } catch (err) {
        console.error('[LEGACY SYNC ERROR] Failed to sync legacy data:', err);
    }
}

async function initLocalDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('✅ Loaded existing SQLite instance: lai5.db');
  } else {
    db = new SQL.Database();
    console.log('✅ Created new local SQLite database instance');
  }

  const regSchema = `
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER REFERENCES users(id),
      shop_id         TEXT    UNIQUE,
      passcode        TEXT,
      first_name      TEXT    NOT NULL,
      last_name       TEXT    NOT NULL,
      email           TEXT    NOT NULL,
      mobile          TEXT,
      store_phone     TEXT,
      address         TEXT,
      city            TEXT,
      state           TEXT,
      zipcode         TEXT,
      store_name      TEXT,
      corporation     TEXT,
      product         TEXT,
      plan            TEXT,
      scanner         TEXT,
      shipping        TEXT,
      payment_mode    TEXT,
      bank_name       TEXT,
      routing_no      TEXT,
      account_no      TEXT,
      account_type    TEXT,
      account_name    TEXT,
      card_no         TEXT,
      status          TEXT    DEFAULT 'pending',
      expiry_date     TEXT,
      is_active       INTEGER DEFAULT 1,
      submitted_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  `;

  const ticketSchema = `
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      StateId         INTEGER NOT NULL,
      State           TEXT NOT NULL,
      TicketLength    INTEGER NOT NULL,
      TicketId_start  INTEGER NOT NULL,
      TicketId_length INTEGER NOT NULL,
      PackNo_start    INTEGER NOT NULL,
      PackNo_length   INTEGER NOT NULL,
      PackPos_start   INTEGER NOT NULL,
      PackPos_length  INTEGER NOT NULL
  `;

  // Create Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    UNIQUE NOT NULL,
      email         TEXT    UNIQUE NOT NULL,
      password_hash TEXT    NOT NULL,
      passcode      TEXT,
      first_name    TEXT,
      last_name     TEXT,
      role          TEXT    DEFAULT 'customer', -- 'admin', 'manager', 'employee', 'customer'
      is_active     INTEGER DEFAULT 1,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create Audit Logs table
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id   TEXT NOT NULL,
      changes       TEXT NOT NULL, -- JSON string of old vs new values
      timestamp     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create Master registration table
  db.run(`CREATE TABLE IF NOT EXISTS registrations (${regSchema});`);

  // Support Logs table (for technical support comments)
  db.run(`
    CREATE TABLE IF NOT EXISTS support_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL,
      comment         TEXT NOT NULL,
      caller_number   TEXT,
      staff_name      TEXT,
      staff_id        INTEGER,
      attachment_path TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbRun(`
    CREATE TABLE IF NOT EXISTS user_status_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      changed_by_name TEXT NOT NULL,
      changed_by_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbRun(`
    CREATE TABLE IF NOT EXISTS customer_status_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      changed_by_name TEXT NOT NULL,
      changed_by_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  dbRun(`
    CREATE TABLE IF NOT EXISTS purchase_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL,
      amount          REAL NOT NULL,
      details         TEXT NOT NULL,
      invoice_date    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    dbRun("ALTER TABLE purchase_history ADD COLUMN attachment_path TEXT;");
  } catch (err) {
    // column already exists or fails gracefully
  }

  dbRun(`
    CREATE TABLE IF NOT EXISTS deleted_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_id INTEGER,
      store_name TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      shop_id TEXT,
      deleted_by_name TEXT,
      deleted_by_id INTEGER,
      deletion_reason TEXT,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      full_data_json TEXT
    );
  `);

  // Staff Attendance table
  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      login_time    DATETIME,
      logout_time   DATETIME,
      date          DATE DEFAULT (date('now')),
      UNIQUE(user_id, date) -- One entry per staff per day for simplified attendance
    );
  `);

  // Leads table
  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source          TEXT NOT NULL,
      external_lead_id TEXT UNIQUE,
      campaign_name   TEXT,
      ad_set_name     TEXT,
      lead_name       TEXT NOT NULL,
      email           TEXT,
      phone           TEXT,
      normalized_phone TEXT,
      store_name      TEXT,
      city            TEXT,
      state           TEXT,
      pos_system      TEXT,
      status          TEXT DEFAULT 'New',
      assigned_to     INTEGER REFERENCES users(id),
      notes           TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Lead Activities table
  db.run(`
    CREATE TABLE IF NOT EXISTS lead_activities (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id         INTEGER REFERENCES leads(id) ON DELETE CASCADE,
      activity_type   TEXT NOT NULL,
      activity_notes  TEXT,
      created_by      TEXT NOT NULL,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Lead Sources table
  db.run(`
    CREATE TABLE IF NOT EXISTS lead_sources (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name     TEXT UNIQUE NOT NULL,
      source_type     TEXT NOT NULL,
      active          INTEGER DEFAULT 1
    );
  `);

  // Seed default lead sources
  try {
    const sourceExists = dbGet("SELECT id FROM lead_sources LIMIT 1");
    if (!sourceExists) {
      dbRun("INSERT INTO lead_sources (source_name, source_type, active) VALUES (?, ?, ?)", ["Manual Entry", "manual", 1]);
      dbRun("INSERT INTO lead_sources (source_name, source_type, active) VALUES (?, ?, ?)", ["Facebook Lead Ads", "facebook", 1]);
      dbRun("INSERT INTO lead_sources (source_name, source_type, active) VALUES (?, ?, ?)", ["Instagram Lead Ads", "instagram", 1]);
      dbRun("INSERT INTO lead_sources (source_name, source_type, active) VALUES (?, ?, ?)", ["Website Form", "website", 1]);
    }
  } catch (e) {
    console.error('[LEAD SOURCES SEED ERROR]', e);
  }

  // Lead API Keys table
  db.run(`
    CREATE TABLE IF NOT EXISTS lead_api_keys (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      key_name        TEXT NOT NULL,
      api_key         TEXT UNIQUE NOT NULL,
      api_secret      TEXT NOT NULL,
      active          INTEGER DEFAULT 1,
      created_by      TEXT NOT NULL,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at    DATETIME
    );
  `);

  // CRM Settings table
  db.run(`
    CREATE TABLE IF NOT EXISTS crm_settings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_key     TEXT UNIQUE NOT NULL,
      setting_value   TEXT,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Meta Sync Logs table
  db.run(`
    CREATE TABLE IF NOT EXISTS meta_sync_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id         INTEGER,
      facebook_lead_id TEXT,
      status          TEXT NOT NULL,
      error_message   TEXT,
      payload         TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default settings
  try {
    const settingExists = dbGet("SELECT id FROM crm_settings LIMIT 1");
    if (!settingExists) {
      dbRun("INSERT INTO crm_settings (setting_key, setting_value) VALUES (?, ?)", ["lead_assignment_mode", "round_robin"]);
      dbRun("INSERT INTO crm_settings (setting_key, setting_value) VALUES (?, ?)", ["lead_assignment_user", ""]);
      dbRun("INSERT INTO crm_settings (setting_key, setting_value) VALUES (?, ?)", ["lead_assignment_round_robin_index", "0"]);
      dbRun("INSERT INTO crm_settings (setting_key, setting_value) VALUES (?, ?)", ["lead_notification_emails", "admin@rtnlai.com"]);
    }

    // Ensure Meta configuration settings exist
    const ensureSetting = (key, defaultVal) => {
      const exists = dbGet("SELECT id FROM crm_settings WHERE setting_key = ?", [key]);
      if (!exists) {
        dbRun("INSERT INTO crm_settings (setting_key, setting_value) VALUES (?, ?)", [key, defaultVal]);
      }
    };
    ensureSetting("meta_page_id", "");
    ensureSetting("meta_form_id", "");
    ensureSetting("meta_access_token", "");
    ensureSetting("meta_connection_status", "Disconnected");
    ensureSetting("meta_last_sync_timestamp", "");
    ensureSetting("meta_verify_token", "lai_meta_verify_token_2026");
    ensureSetting("meta_app_secret", "");
    ensureSetting("meta_lead_mappings", JSON.stringify({
      "full_name": "lead_name",
      "phone_number": "phone",
      "email": "email",
      "store_name": "store_name",
      "city": "city"
    }));
  } catch (e) {
    console.error('[CRM SETTINGS SEED ERROR]', e);
  }

  // Create 50 State-specific tables
  STATES.forEach(st => {
    db.run(`CREATE TABLE IF NOT EXISTS registrations_${st} (${regSchema});`);
  });

  // Create Master Ticket Config table
  db.run(`CREATE TABLE IF NOT EXISTS RTNTicketConfig (${ticketSchema});`);

  // Create 50 State-specific Ticket Config tables
  STATES.forEach(st => {
    db.run(`CREATE TABLE IF NOT EXISTS RTNTicketConfig_${st} (${ticketSchema});`);
  });

  // ─── Migration: Ensure all registration tables (Master + 50 States) have all columns ───
  try {
    const tablesToMigrate = ['registrations', ...STATES.map(st => `registrations_${st}`)];

    // Also migrate users table
    try {
        const userCols = db.exec("PRAGMA table_info(users)")[0].values.map(v => v[1]);
        if (!userCols.includes('passcode')) {
            console.log(`[DB MIGRATION] Adding column passcode to users table...`);
            db.run("ALTER TABLE users ADD COLUMN passcode TEXT;");
        }
    } catch (e) {}

    tablesToMigrate.forEach(tbl => {
        try {
            const existingCols = db.exec(`PRAGMA table_info(${tbl})`)[0].values.map(v => v[1]);
            const requiredCols = [
                ['bank_name', 'TEXT'], ['routing_no', 'TEXT'], ['account_no', 'TEXT'], 
                ['account_type', 'TEXT'], ['account_name', 'TEXT'], ['shop_id', 'TEXT'],
                ['card_no', 'TEXT'], ['passcode', 'TEXT'], ['expiry_date', 'TEXT'],
                ['is_active', 'INTEGER DEFAULT 1']
            ];
            
            requiredCols.forEach(([col, type]) => {
                if (!existingCols.includes(col)) {
                    console.log(`[DB MIGRATION] Adding column ${col} to ${tbl} table...`);
                    db.run(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${type};`);
                }
            });
        } catch (e) {
            // Table might not exist yet or other minor issue
        }
    });

    // ─── Data Repair: Link legacy user_id=0 records ───
    db.run("UPDATE registrations SET user_id = 1 WHERE user_id = 0 AND id = 1");
    db.run("UPDATE registrations SET user_id = 2 WHERE user_id = 0 AND id = 2");

    // ─── Data Repair: Assign Unique Shop IDs to existing records ───
    const orphanedShopIds = db.exec("SELECT id FROM registrations WHERE shop_id IS NULL OR shop_id = ''");
    if (orphanedShopIds.length > 0) {
        orphanedShopIds[0].values.forEach(row => {
            const id = row[0];
            const paddedId = String(id).padStart(2, '0');
            console.log(`[DB REPAIR] Assigning Shop ID ${paddedId} to registration ${id}`);
            db.run("UPDATE registrations SET shop_id = ? WHERE id = ?", [paddedId, id]);
        });
    }

    // ─── Data Repair: Populate expiry_date for records missing it ───
    console.log(`[DB REPAIR] Harmonizing expiry_date for all tables...`);
    const allTables = ['registrations', ...STATES.map(st => `registrations_${st}`)];
    allTables.forEach(tbl => {
        try {
            db.run(`
                UPDATE ${tbl} SET expiry_date = (
                    CASE 
                        WHEN plan LIKE '%Trial%' THEN date(submitted_at, '+30 days')
                        WHEN plan = 'Monthly' THEN date(submitted_at, '+1 month')
                        WHEN plan = '1 Year'  THEN date(submitted_at, '+1 year')
                        WHEN plan = '2 Years' THEN date(submitted_at, '+2 years')
                        WHEN plan = '3 Years' THEN date(submitted_at, '+3 years')
                        ELSE date(submitted_at, '+1 year')
                    END
                ) WHERE expiry_date IS NULL OR expiry_date = ''
            `);
        } catch(e) {}
    });

    // ─── Data Repair: Sync legacy records to state tables ───
    const legacyGA = dbGet("SELECT * FROM registrations WHERE id = 1");
    if (legacyGA) {
        db.run(`INSERT OR REPLACE INTO registrations_GA 
                (id, user_id, shop_id, first_name, last_name, email, state, status, submitted_at, store_name, product, plan) 
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, 
                [legacyGA.id, legacyGA.user_id, legacyGA.shop_id, legacyGA.first_name, legacyGA.last_name, legacyGA.email, 'GA', legacyGA.status, legacyGA.submitted_at, legacyGA.store_name, legacyGA.product, legacyGA.plan]);
    }

    const legacyFL = dbGet("SELECT * FROM registrations WHERE id = 2");
    if (legacyFL) {
        db.run(`INSERT OR REPLACE INTO registrations_FL 
                (id, user_id, shop_id, first_name, last_name, email, state, status, submitted_at, store_name, product, plan) 
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, 
                [legacyFL.id, legacyFL.user_id, legacyFL.shop_id, legacyFL.last_name, legacyFL.email, 'FL', legacyFL.status, legacyFL.submitted_at, legacyFL.store_name, legacyFL.product, legacyFL.plan]);
    }

    // Seed default admin if no admin exists (Async)
    (async () => {
        try {
            const adminExists = dbGet("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
            if (!adminExists) {
                console.log('[DB SEED] Creating default super admin...');
                const salt = await bcrypt.genSalt(10);
                const hash = await bcrypt.hash('RTN@LAI5', salt);
                dbRun(`
                    INSERT INTO users (username, email, password_hash, passcode, first_name, last_name, role)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, ['Admin@RTN', 'admin@rtnlai.com', hash, 'RTN@LAI5', 'System', 'Admin', 'admin']);
            }
        } catch (e) {
            console.error('[SEED ERROR]', e);
        }
    })();

  } catch (err) {
    console.warn('[DB MIGRATION WARNING] Non-critical migration skip:', err.message);
  }

    saveDb();

    // ─── Data Import: Tickets CSV ───
    const ticketsCsvPath = path.join(__dirname, '..', 'State-wise DB For tickets', 'tickets.csv');
    if (fs.existsSync(ticketsCsvPath)) {
        const ticketCount = (dbGet("SELECT COUNT(*) as c FROM RTNTicketConfig") || {}).c || 0;
        // Re-run import if we have less than 40 tickets (ensures repair of partial failed import)
        if (ticketCount < 40) {
            console.log(`[DB IMPORT] Importing/Repairing tickets from ${ticketsCsvPath}...`);
            try {
                const csvData = fs.readFileSync(ticketsCsvPath, 'utf-8');
                const rows = csvData.split('\n').filter(r => r.trim() && !r.startsWith('Id,'));
                rows.forEach(row => {
                    const cols = row.split(',');
                    if (cols.length < 10) return;
                    
                    const vals = [
                        cols[1], cols[2], cols[3], cols[4], cols[5], cols[6], cols[7], cols[8], cols[9]
                    ];
                    
                    const masterId = dbRun(`
                        INSERT OR REPLACE INTO RTNTicketConfig (id, StateId, State, TicketLength, TicketId_start, TicketId_length, PackNo_start, PackNo_length, PackPos_start, PackPos_length)
                        VALUES (?,?,?,?,?,?,?,?,?,?)
                    `, [cols[0], ...vals]);
                    
                    const stateCode = STATE_NAME_TO_CODE[cols[2].trim()];
                    if (stateCode && STATES.includes(stateCode)) {
                        dbRun(`
                            INSERT OR REPLACE INTO RTNTicketConfig_${stateCode} (id, StateId, State, TicketLength, TicketId_start, TicketId_length, PackNo_start, PackNo_length, PackPos_start, PackPos_length)
                            VALUES (?,?,?,?,?,?,?,?,?,?)
                        `, [masterId, ...vals]);
                    }
                });
                console.log(`[DB IMPORT] Successfully imported/synchronized ${rows.length} ticket configurations.`);
            } catch (err) {
                console.error('[DB IMPORT ERROR] Failed to import tickets:', err);
            }
        }
    }

}

async function connectAndSyncMssql() {
  try {
    console.log('🔌 Connecting to MS SQL Server (52.186.36.241:1438)...');
    mssqlPool = await sql.connect(mssqlConfig);
    console.log('✅ Connected to cloud MS SQL Server!');
    mssqlConnectionError = null;
    
    // Create MS SQL tables if they do not exist
    await createMssqlTables();
  } catch (err) {
    console.error('❌ Failed to connect to cloud MS SQL Server:', err.message);
    mssqlConnectionError = err.message;
    return;
  }

  // Sync all data from MS SQL into local SQLite!
  if (mssqlPool) {
    console.log('🔄 Synchronizing data from MS SQL to local SQLite...');
    const tablesToSync = [
        'users', 'registrations', 'support_logs', 'audit_logs', 
        'purchase_history', 'deleted_registrations', 'RTNTicketConfig', 
        'attendance', 'user_status_logs', 'customer_status_logs',
        'leads', 'lead_activities', 'lead_sources', 'lead_api_keys', 'crm_settings'
    ];
    
    STATES.forEach(st => {
        tablesToSync.push(`registrations_${st}`);
        tablesToSync.push(`RTNTicketConfig_${st}`);
    });

    const syncPromises = tablesToSync.map(async (table) => {
        try {
            const result = await mssqlPool.request().query(`SELECT * FROM ${table}`);
            if (result.recordset && result.recordset.length > 0) {
                console.log(`[MSSQL SYNC] Pulling ${result.recordset.length} rows for table ${table}...`);
                result.recordset.forEach(row => {
                    try {
                        const keys = Object.keys(row);
                        const placeholders = keys.map(() => '?').join(',');
                        const values = keys.map(k => {
                            if (row[k] instanceof Date) {
                                return row[k].toISOString().replace('T', ' ').substring(0, 19);
                            }
                            return row[k];
                        });
                        db.run(`INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`, values);
                    } catch (err) {
                        console.warn(`[MSSQL SYNC WARNING] Failed row in ${table}:`, err.message);
                    }
                });
            }
        } catch (e) {
            // Table might not exist or be empty
        }
    });

    await Promise.all(syncPromises);
    console.log('✅ MS SQL to local SQLite synchronization complete!');
    saveDb(); // Explicitly write the loaded data to disk!

    // Trigger background sync of legacy C# table records (users & shops)
    setTimeout(() => {
        syncLegacyCsharpData().catch(e => console.error('[LEGACY SYNC ERROR]', e));
    }, 1000);
  }
}

// ─── DB query helpers ─────────────────────────────────────────────────────────
function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function dbAll(sql, params = []) {
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function dbRun(sqlStr, params = []) {
  db.run(sqlStr, params);
  const rowId = db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
  saveDb();

  // Mirror query asynchronously to Microsoft SQL Server in the cloud
  runMssqlQuery(sqlStr, params);

  return rowId;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/diagnostics', async (req, res) => {
  const renderEnv = {};
  for (const k in process.env) {
    if (k.startsWith('RENDER_')) {
      renderEnv[k] = process.env[k];
    }
  }

  const diag = {
    timestamp: new Date().toISOString(),
    sqliteConnected: !!db,
    sqliteStats: {},
    mssqlConnected: !!mssqlPool,
    mssqlConfigServer: mssqlConfig.server,
    mssqlError: mssqlConnectionError,
    mssqlPing: null,
    renderEnv: renderEnv
  };

  if (db) {
    try {
      diag.sqliteStats.users = (dbGet('SELECT COUNT(*) as c FROM users') || {}).c || 0;
      diag.sqliteStats.registrations = (dbGet('SELECT COUNT(*) as c FROM registrations') || {}).c || 0;
      diag.sqliteStats.registrations_cols = dbAll("PRAGMA table_info(registrations)").map(c => c.name);
      diag.sqliteStats.leads = (dbGet('SELECT COUNT(*) as c FROM leads') || {}).c || 0;
      diag.sqliteStats.lead_sources = (dbGet('SELECT COUNT(*) as c FROM lead_sources') || {}).c || 0;
    } catch (e) {
      diag.sqliteStats.error = e.message;
    }
  }

  try {
    if (mssqlPool) {
      const result = await mssqlPool.request().query('SELECT 1 as ping');
      diag.mssqlPing = result.recordset[0]?.ping === 1 ? 'OK' : 'FAILED';
    } else {
      diag.mssqlPing = 'NOT_CONNECTED';
    }
  } catch (e) {
    diag.mssqlError = e.message;
    diag.mssqlPing = 'ERROR';
  }

  res.json(diag);
});

// ─── PaymentsVault Gateway Config ─────────────────────────────────────────────
const VAULT_CONFIG = {
  baseUrl: "https://rtnpaymentvault.azurewebsites.net",
  xKey: "YTJGVVJObVdMcENsdkRlMENVTjlVdz09",
  xPassword: "VFZYR2FZUjl1ckl4N2VlUXdyakN2UT09",
  returnUrl: "https://rtngateway.com/payment_status"
};

/**
 * Vault Step 1: Save Instrument (CARD or ACH)
 */
async function vaultSaveInstrument(type, data) {
  try {
    const body = {
      CustomerId: parseInt(data.customerId) || 1,
      InstrumentType: type.toUpperCase(), // "CARD" or "ACH"
      BillingName: data.billingName,
      BillingPostalCode: data.zipcode
    };

    if (type === "Card") {
      body.CardNumber = data.card_no.replace(/\D/g, ''); // Digits only
      body.ExpMonth   = parseInt(data.exp_month);
      body.ExpYear    = parseInt(data.exp_year);
      body.Brand      = body.CardNumber.startsWith("4") ? "VISA" : "MasterCard";
    } else {
      body.AchRoutingNumber = data.routing_no.replace(/\D/g, ''); // Digits only
      body.AchAccountNumber = data.account_no.replace(/\D/g, ''); // Digits only
      body.BankAccountType  = data.account_type || "CHECKING";
      body.BankName         = data.bank_name;
    }

    const response = await fetch(`${VAULT_CONFIG.baseUrl}/api/savepaymentvault`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Key": VAULT_CONFIG.xKey,
        "X-Password": VAULT_CONFIG.xPassword
      },
      body: JSON.stringify(body)
    });

    const result = await response.json();
    if (!response.ok) {
        console.error("[VAULT SAVE ERROR]", result);
        return { success: false, message: result.message || "Failed to vault instrument" };
    }
    return { success: true, instrumentId: result.paymentInstrumentId };
  } catch (err) {
    console.error("[VAULT SAVE EXCEPTION]", err);
    return { success: false, message: "Network error during vaulting" };
  }
}

/**
 * Vault Step 2: Charge Using Instrument ID
 */
async function vaultCharge(instrumentId, data) {
  try {
    const isACH = data.payment_mode === "ACH";
    const amountNum = parseFloat(data.amount);
    
    // Safely parse mobile to ensure 10 digits
    let safeMobile = (data.customerMobile || "").replace(/\D/g, '').slice(-10);
    if (safeMobile.length !== 10) safeMobile = "0000000000"; // Fallback to avoid gateway parse errors

    const body = {
      PaymentInstrumentId: parseInt(instrumentId),
      Amount: amountNum, 
      CustomerId: parseInt(data.customerId) || 999,
      CustomerName: data.customerName.trim(),
      CustomerEmail: data.customerEmail.trim(),
      CustomerMobile: "+1" + safeMobile, 
      Resource: "LAI_REG",      
      Description: "REGISTRATION" 
    };

    // Card-only required fields for charge
    if (!isACH) {
      body.Cvv = data.cvv;
      body.Address1 = data.address;
      body.City = data.city;
      body.State = data.state || "GA";
      body.Country = "USA";
      body.PostalCode = data.zipcode;
    }

    const response = await fetch(`${VAULT_CONFIG.baseUrl}/api/paymentvault/charge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Key": VAULT_CONFIG.xKey,
        "X-Password": VAULT_CONFIG.xPassword
      },
      body: JSON.stringify(body)
    });

    const result = await response.json();
    if (!response.ok) {
        console.error("[VAULT CHARGE ERROR]", result);
        return { success: false, message: result.message || "Failed to process charge" };
    }

    // Spec says payResponse contains the status
    const payRes = result.payResponse;
    if (payRes.status.toLowerCase().includes("fail")) {
        return { success: false, message: payRes.message || payRes.result_message || "Payment declined" };
    }

    return { success: true, transaction_id: payRes.transaction_id || "N/A" };
  } catch (err) {
    console.error("[VAULT CHARGE EXCEPTION]", err);
    return { success: false, message: "Network error during payment execution" };
  }
}

/**
 * Calculate registration amount (Keep in sync with FE)
 */
function calculateRegAmount(body) {
  let softwareTotal = 0;
  
  // Software Logic (Inclusive of Tax)
  const plan_val = body.plan;
  const prod_val = body.product;
  
  if (plan_val && plan_val !== 'Trial' && !plan_val.includes('Trial')) {
    if (prod_val === 'LAI V') {
      softwareTotal = (plan_val === 'Monthly') ? 39.99 : 299.99;
    } else if (prod_val === 'RTN Display' || prod_val === 'Display') {
      softwareTotal = (plan_val === 'Monthly') ? 39.99 : 399.99;
    } else if (prod_val.includes('Display') && prod_val.includes('LAI')) {
      // LAI + Display (Pro)
      softwareTotal = (plan_val === 'Monthly') ? 59.99 : 599.99;
    }
    
    // Multi-year multiplier
    if (plan_val === '2 Years') softwareTotal *= 2;
    else if (plan_val === '3 Years') softwareTotal *= 3;
  }
  
  // Scanner Price (Inclusive of Tax: $79.78)
  let scannerTotal = 0;
  if (body.scanner && body.scanner !== 'Not-Needed') {
    if (body.scanner === 'WiFi & Display Scanner') {
      scannerTotal = 159.56; // 79.78 * 2
    } else {
      scannerTotal = 79.78; 
    }
  }
  
  // Shipping Logic
  let shippingTotal = 0;
  if (plan_val !== 'Trial' && (!plan_val || !plan_val.includes('Trial'))) {
    if (body.scanner && body.scanner !== 'Not-Needed') {
      if (body.scanner === 'WiFi & Display Scanner') {
        shippingTotal = 29.98;
      } else {
        shippingTotal = 14.99;
      }
    }
  }
  
  // Tax is already included in the totals above
  const taxTotal = 0;
  
  const grandTotal = softwareTotal + scannerTotal + shippingTotal + taxTotal;
  return {
    softwareTotal,
    scannerTotal,
    shippingTotal,
    taxTotal,
    grandTotal: parseFloat(grandTotal.toFixed(2))
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/register
app.post("/api/register", async (req, res) => {
  try {
    const {
      first_name, last_name, email, username, password,
      mobile, store_phone, address, city, state, zipcode,
      store_name, corporation, product, plan, scanner, shipping,
      payment_mode, bank_name, routing_no, account_no, account_type, account_name,
      card_no, card_cvv, card_exp_month, card_exp_year
    } = req.body;

    // Validate required fields
    const missing = [];
    if (!first_name?.trim())  missing.push("first_name");
    if (!last_name?.trim())   missing.push("last_name");
    if (!email?.trim())       missing.push("email");
    if (!username?.trim())    missing.push("username");
    if (!password?.trim())    missing.push("password");
    if (!store_name?.trim())  missing.push("store_name");

    if (missing.length) {
      const errorMsg = `Missing fields: ${missing.join(", ")}`;
      await mailer.sendFailureNotification(req.body, new Error(errorMsg));
      return res.status(400).json({ error: errorMsg });
    }

    // Check duplicate username
    const existingUser = dbGet("SELECT id FROM users WHERE username = ?", [username.trim()]);
    if (existingUser) {
      await mailer.sendFailureNotification(req.body, new Error("Validation Error: Username already taken."));
      return res.status(409).json({ error: "That username is already taken. Please choose a different one." });
    }

    // Check duplicate email
    const existingEmail = dbGet("SELECT id FROM users WHERE email = ?", [email.trim().toLowerCase()]);
    if (existingEmail) {
      await mailer.sendFailureNotification(req.body, new Error("Validation Error: Account with this email already exists."));
      return res.status(409).json({ error: "An account with that email already exists. Try logging in." });
    }

    // ─── PAYMENTS VAULT FLOW ───
    const amountBreakdown = calculateRegAmount(req.body);
    const amount = amountBreakdown.grandTotal;
    let transaction_id = "";

    // TEST CARD & ACH BYPASS
    const isTestCard = (card_no || "").replace(/\s/g, '') === "4242424242424242";
    const isTestACH = (routing_no || "").trim() === "021000021" && (account_no || "").trim() === "123456789";
    const isTestBypass = isTestCard || isTestACH;

    if (amount > 0 && !isTestBypass) {
      console.log(`[VAULT] Processing $${amount} for ${email} (${payment_mode})`);
      
      // Get a TRULY unique customer ID for testing to avoid 409 conflicts
      const count = (dbGet("SELECT count(*) as c FROM registrations") || { c: 0 }).c;
      const nextId = Math.floor(Date.now() / 1000) + count; 

      // 1. Save to Vault
      const vaultSave = await vaultSaveInstrument(payment_mode, {
        customerId: nextId,
        card_no: card_no,
        exp_month: card_exp_month,
        exp_year: card_exp_year,
        routing_no: routing_no,
        account_no: account_no,
        account_type: account_type,
        bank_name: bank_name,
        billingName: `${first_name} ${last_name}`,
        zipcode: zipcode
      });

      if (!vaultSave.success) {
        await mailer.sendFailureNotification(req.body, new Error(`Vault Error: ${vaultSave.message}`));
        return res.status(400).json({ error: vaultSave.message });
      }

      // 2. Charge
      const chargeRes = await vaultCharge(vaultSave.instrumentId, {
        customerId: nextId,
        payment_mode: payment_mode,
        amount: amount,
        customerName: `${first_name} ${last_name}`,
        customerEmail: email,
        customerMobile: mobile,
        cvv: card_cvv,
        address: address,
        city: city,
        state: state === "Georgia" ? "GA" : (state.length > 2 ? state.slice(0,2).toUpperCase() : state),
        zipcode: zipcode
      });

      if (!chargeRes.success) {
        await mailer.sendFailureNotification(req.body, new Error(`Charge Error: ${chargeRes.message}`));
        return res.status(400).json({ error: chargeRes.message });
      }

      transaction_id = chargeRes.transaction_id;
      console.log(`[VAULT ✅] TransID: ${transaction_id}`);
    } else if (isTestBypass) {
      transaction_id = isTestCard ? "TEST-CARD-TX-" + Date.now() : "TEST-ACH-TX-" + Date.now();
      console.log(`[VAULT BYPASS] Test instruments used: Card=${isTestCard}, ACH=${isTestACH}. Skipping gateway charge.`);
    } else {
      console.log(`[VAULT] Skipping for $0.00 (Trial/Free)`);
    }


    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Insert user
    dbRun(
      `INSERT INTO users (username, email, password_hash, passcode, first_name, last_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username.trim(), email.trim().toLowerCase(), password_hash, password, first_name.trim(), last_name.trim()]
    );

    // Query user ID explicitly
    const userRow = dbGet("SELECT id FROM users WHERE email = ? ORDER BY id DESC LIMIT 1", [email.trim().toLowerCase()]);
    const userId = userRow ? userRow.id : 0;

    // Identify target table based on state
    const stateCode = (req.body.state || "").trim().toUpperCase();

    // 1. Insert into Master table ALWAYS
    const insertMasterSql = `
        INSERT INTO registrations
          (user_id, shop_id, passcode, first_name, last_name, email, mobile, store_phone,
           address, city, state, zipcode, store_name, corporation,
           product, plan, scanner, shipping, payment_mode,
           bank_name, routing_no, account_no, account_type, account_name, card_no)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    // Calculate Shop ID (get count + 1)
    const count = (dbGet("SELECT count(*) as c FROM registrations") || { c: 0 }).c;
    const shop_id = String(count + 1).padStart(2, "0");

    const regParamsWithShopId = [
        userId, shop_id, password, first_name.trim(), last_name.trim(), email.trim(), mobile || "", store_phone || "",
        address || "", city || "", stateCode || "", zipcode || "",
        store_name.trim(), (corporation || "").trim(),
        product || "LAI V", plan || "Trial (30 Days)", scanner || "Not-Needed", shipping || "Standard",
        payment_mode || "Card",
        bank_name || "", routing_no || "", account_no || "", account_type || "", account_name || "",
        card_no ? `XXXX-XXXX-XXXX-${card_no.slice(-4)}` : ""
    ];

    dbRun(insertMasterSql, regParamsWithShopId);

    // Query registration ID explicitly
    const regRow = dbGet("SELECT id FROM registrations WHERE shop_id = ? LIMIT 1", [shop_id]);
    const registrationId = regRow ? regRow.id : 0;

    // Automate Purchase History Entry
    if (amountBreakdown) {
        dbRun(`
            INSERT INTO purchase_history (registration_id, amount, details)
            VALUES (?, ?, ?)
        `, [registrationId, amountBreakdown.grandTotal || 0.00, `${product || 'LAI V'} (${plan || 'Trial'})`]);
    }

    // 2. Insert into State-Specific table if valid
    if (STATES.includes(stateCode)) {
        const insertStateSql = insertMasterSql.replace("registrations", `registrations_${stateCode}`);
        dbRun(insertStateSql, regParamsWithShopId);
        console.log(`[STATE ROUTING ✅] Added to registrations_${stateCode} with Shop ID ${shop_id}`);
    }

    // Auto-login
    req.session.userId   = userId;
    req.session.username = username.trim();
    req.session.name     = `${first_name.trim()} ${last_name.trim()}`;

    console.log(`[REGISTER ✅] ${username} <${email}> in ${stateCode}`);

    // ─── EMAIL & INVOICE FLOW ───
    (async () => {
      try {
        const invoiceData = {
          ...req.body,
          ...amountBreakdown,
          shop_id: shop_id,
          invoiceNumber: 'RTN-' + Date.now().toString().slice(-6)
        };

        const pdfBuffer = await pdfService.generateInvoice(invoiceData);
        await mailer.sendRegistrationEmail(invoiceData, pdfBuffer);
        console.log(`[MAIL ✅] Registration email sent to ${email}`);
      } catch (mailErr) {
        console.error("[MAIL ERROR]", mailErr);
      }
    })();

    return res.status(201).json({
      success: true,
      message: `Welcome, ${first_name}! Your account has been created successfully. ${transaction_id ? "Transaction ID: " + transaction_id : ""}`,
      user: { id: userId, username: username.trim(), name: req.session.name, email: email.trim() }
    });

  } catch (err) {
    console.error("[REGISTER ERROR]", err);
    await mailer.sendFailureNotification(req.body, err);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  try {
    const identifier = (req.body.username || req.body['Login.UserName'] || '').trim();
    const password   = (req.body.password || req.body['Login.Password'] || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = dbGet(
      `SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1`,
      [identifier, identifier.toLowerCase()]
    );

    if (!user) {
      return res.status(401).json({ error: 'No account found with that username or email.' });
    }

    if (user.is_active === 0) {
      return res.status(403).json({ error: 'Your account is inactive. Please contact support.' });
    }

    let valid = await bcrypt.compare(password, user.password_hash);
    if (!valid && user.passcode && password === user.passcode) {
        valid = true;
        try {
            const salt = await bcrypt.genSalt(10);
            const newHash = await bcrypt.hash(password, salt);
            dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, user.id]);
            console.log(`[SECURITY UPGRADE] Upgraded password hash for legacy user ${user.username}`);
        } catch (e) {
            console.warn('[SECURITY UPGRADE ERROR] Fallback hashing failed:', e.message);
        }
    }

    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.name     = `${user.first_name} ${user.last_name}`;

    // Record Attendance Login
    if (user.role !== 'customer') {
        dbRun(`
            INSERT INTO attendance (user_id, login_time, date)
            VALUES (?, CURRENT_TIMESTAMP, date('now'))
            ON CONFLICT(user_id, date) DO UPDATE SET
            login_time = COALESCE(login_time, CURRENT_TIMESTAMP)
        `, [user.id]);
    }

    console.log(`[LOGIN ✅] ${user.username}`);

    return res.json({
      success: true,
      message: `Welcome back, ${user.first_name}!`,
      user: {
        id: user.id, username: user.username,
        name: req.session.name, email: user.email, role: user.role
      }
    });

  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/renew-plan
app.post("/api/renew-plan", async (req, res) => {
    const { username, password, product, plan, card_no } = req.body;
    if (!username || !password || !product || !plan) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const user = dbGet("SELECT * FROM users WHERE username = ? OR email = ?", [username.trim(), username.trim().toLowerCase()]);
        if (!user) return res.status(401).json({ error: "User not found." });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: "Incorrect password." });

        const reg = dbGet("SELECT * FROM registrations WHERE user_id = ?", [user.id]);
        if (!reg) return res.status(404).json({ error: "No registration associated with this account." });

        // Calculate amount
        let amount = 0;
        if (product === 'LAI V') amount = (plan === 'Monthly') ? 39.99 : 299.99;
        else if (product === 'RTN Display') amount = (plan === 'Monthly') ? 39.99 : 399.99;
        else if (product.includes('Display') && product.includes('LAI')) amount = (plan === 'Monthly') ? 59.99 : 599.99;
        else amount = (plan === 'Monthly') ? 39.99 : 299.99;

        if (plan === '2 Years') amount *= 2;
        else if (plan === '3 Years') amount *= 3;

        // Calculate new expiry date
        let daysToAdd = 30;
        if (plan === '1 Year') daysToAdd = 365;
        if (plan === '2 Years') daysToAdd = 365 * 2;
        if (plan === '3 Years') daysToAdd = 365 * 3;

        const currentExpiry = new Date(reg.expiry_date || Date.now());
        currentExpiry.setDate(currentExpiry.getDate() + daysToAdd);
        const newExpiryStr = currentExpiry.toISOString().slice(0, 10);

        // Update DB
        dbRun("UPDATE registrations SET expiry_date = ?, product = ?, plan = ? WHERE id = ?", [newExpiryStr, product, plan, reg.id]);
        
        // Record into purchase history
        dbRun(`
            INSERT INTO purchase_history (registration_id, amount, details)
            VALUES (?, ?, ?)
        `, [reg.id, amount, `Renewal: ${product} (${plan})`]);

        res.json({ success: true, message: "Subscription successfully renewed!" });

    } catch (err) {
        console.error('[RENEWAL ERROR]', err);
        res.status(500).json({ error: "Failed to process renewal." });
    }
});

// POST /api/buy-scanner
app.post("/api/buy-scanner", async (req, res) => {
    const { name, email, address, scanner_type, card_no } = req.body;
    if (!name || !email || !scanner_type) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    try {
        let reg = dbGet("SELECT * FROM registrations WHERE email = ? LIMIT 1", [email.trim().toLowerCase()]);
        
        let regId;
        if (!reg) {
            // Create a minimal registration record for this "Scanner-Only" customer
            const userId = dbRun(
              `INSERT INTO users (username, email, password_hash, first_name, last_name)
               VALUES (?, ?, ?, ?, ?)`,
              ['scan_' + Date.now(), email.trim().toLowerCase(), 'N/A', name.split(' ')[0], name.split(' ')[1] || '']
            );
            
            regId = dbRun(`
                INSERT INTO registrations (user_id, first_name, last_name, email, address, store_name, product, plan, scanner)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [userId, name.split(' ')[0], name.split(' ')[1] || '', email.trim(), address, "Scanner Customer", "None", "None", scanner_type]);
        } else {
            regId = reg.id;
        }

        let amount = 79.78;
        if (scanner_type === 'WiFi & Display Scanner') amount = 159.56;

        // Record Purchase History
        dbRun(`
            INSERT INTO purchase_history (registration_id, amount, details)
            VALUES (?, ?, ?)
        `, [regId, amount, `Scanner Only: ${scanner_type}`]);

        res.json({ success: true, message: "Scanner successfully ordered!" });

    } catch (err) {
        console.error('[BUY SCANNER ERROR]', err);
        res.status(500).json({ error: "Failed to order scanner." });
    }
});

// GET /api/me
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const user = dbGet(
    'SELECT id, username, first_name, last_name, email, role FROM users WHERE id = ?',
    [req.session.userId]
  );
  if (!user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, user });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  if (req.session.userId) {
      // Record Attendance Logout
      dbRun(`
          UPDATE attendance 
          SET logout_time = CURRENT_TIMESTAMP 
          WHERE user_id = ? AND date = date('now')
      `, [req.session.userId]);
  }
  req.session.destroy(() => res.json({ success: true }));
});


function adminOnly(req, res, next) {
  // Legacy support: if isAdmin is true but role is missing, treat as admin
  if (req.session.isAdmin) {
    if (!req.session.role) req.session.role = 'admin'; 
    if (['admin', 'manager', 'employee'].includes(req.session.role)) {
      return next();
    }
  }
  res.status(403).json({ error: 'Unauthorized. Admin login required.' });
}

// POST /api/admin/login (DB-backed)
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = dbGet(
      `SELECT * FROM users WHERE username = ? AND role IN ('admin', 'manager', 'employee') LIMIT 1`,
      [username.trim()]
    );

    if (!user) {
      return res.status(401).json({ error: 'No administrative account found.' });
    }

    if (user.is_active === 0) {
      return res.status(403).json({ error: 'Your staff account is inactive. Access denied.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    req.session.isAdmin  = true;
    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.role     = user.role;
    req.session.email    = user.email;
    req.session.name     = `${user.first_name} ${user.last_name}`;

    console.log(`[ADMIN LOGIN ✅] ${user.username} as ${user.role}`);
    return res.json({ success: true, message: 'Welcome to Admin Portal', role: user.role });

  } catch (err) {
    console.error('[ADMIN LOGIN ERROR]', err);
    res.status(500).json({ error: 'Server error during authentication.' });
  }
});

// GET /api/admin/me
app.get('/api/admin/me', (req, res) => {
  if (!req.session.isAdmin) return res.json({ loggedIn: false });
  
  // Legacy fallback for identification
  const role = req.session.role || 'admin';
  const name = req.session.name || 'Legacy Admin';
  const username = req.session.username || 'Admin@RTN';

  res.json({ 
    loggedIn: true, 
    userId: req.session.userId,
    role: role, 
    username: username,
    email: req.session.email || '',
    name: name
  });
});

// POST /api/admin/logout
app.post('/api/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ success: true });
});

// POST /api/admin/registrations (Create new customer by admin/manager)
app.post('/api/admin/registrations', adminOnly, async (req, res) => {
  if (req.session.role === 'employee') {
    return res.status(403).json({ error: 'Read-only access' });
  }

  try {
    const {
      first_name, last_name, email, username, password,
      mobile, store_phone, address, city, state, zipcode,
      store_name, corporation, product, plan, scanner, shipping,
      payment_mode, bank_name, routing_no, account_no, account_type, account_name,
      card_no, card_cvv, card_exp_month, card_exp_year
    } = req.body;

    // Validate required fields
    const missing = [];
    if (!first_name?.trim())  missing.push("first_name");
    if (!last_name?.trim())   missing.push("last_name");
    if (!email?.trim())       missing.push("email");
    if (!username?.trim())    missing.push("username");
    if (!password?.trim())    missing.push("password");
    if (!store_name?.trim())  missing.push("store_name");

    if (missing.length) {
      return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
    }

    // Check duplicate username
    const existingUser = dbGet("SELECT id FROM users WHERE username = ?", [username.trim()]);
    if (existingUser) {
      return res.status(409).json({ error: "That username is already taken. Please choose a different one." });
    }

    // Check duplicate email
    const existingEmail = dbGet("SELECT id FROM users WHERE email = ?", [email.trim().toLowerCase()]);
    if (existingEmail) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    // ─── PAYMENTS VAULT FLOW ───
    const normalizedPaymentMode = (payment_mode === "e-Cheque" || payment_mode === "ACH") ? "ACH" : "Card";
    const amountBreakdown = calculateRegAmount(req.body);
    const amount = amountBreakdown.grandTotal;
    let transaction_id = "";

    // TEST CARD & ACH BYPASS
    const isTestCard = (card_no || "").replace(/\s/g, '') === "4242424242424242";
    const isTestACH = (routing_no || "").trim() === "021000021" && (account_no || "").trim() === "123456789";
    const isTestBypass = isTestCard || isTestACH;

    if (amount > 0 && !isTestBypass) {
      console.log(`[ADMIN VAULT] Processing $${amount} for ${email} (${normalizedPaymentMode})`);
      
      // Get a TRULY unique customer ID for testing to avoid 409 conflicts
      const count = (dbGet("SELECT count(*) as c FROM registrations") || { c: 0 }).c;
      const nextId = Math.floor(Date.now() / 1000) + count; 

      // 1. Save to Vault
      const vaultSave = await vaultSaveInstrument(normalizedPaymentMode, {
        customerId: nextId,
        card_no: card_no,
        exp_month: card_exp_month,
        exp_year: card_exp_year,
        routing_no: routing_no,
        account_no: account_no,
        account_type: account_type,
        bank_name: bank_name,
        billingName: `${first_name} ${last_name}`,
        zipcode: zipcode
      });

      if (!vaultSave.success) {
        return res.status(400).json({ error: `Vault Error: ${vaultSave.message}` });
      }

      // 2. Charge
      const chargeRes = await vaultCharge(vaultSave.instrumentId, {
        customerId: nextId,
        payment_mode: normalizedPaymentMode,
        amount: amount,
        customerName: `${first_name} ${last_name}`,
        customerEmail: email,
        customerMobile: mobile,
        cvv: card_cvv,
        address: address,
        city: city,
        state: state === "Georgia" ? "GA" : (state.length > 2 ? state.slice(0,2).toUpperCase() : state),
        zipcode: zipcode
      });

      if (!chargeRes.success) {
        return res.status(400).json({ error: `Charge Error: ${chargeRes.message}` });
      }

      transaction_id = chargeRes.transaction_id;
      console.log(`[ADMIN VAULT ✅] TransID: ${transaction_id}`);
    } else if (isTestBypass) {
      transaction_id = isTestCard ? "TEST-CARD-TX-" + Date.now() : "TEST-ACH-TX-" + Date.now();
      console.log(`[ADMIN VAULT BYPASS] Test instruments used: Card=${isTestCard}, ACH=${isTestACH}. Skipping gateway charge.`);
    } else {
      console.log(`[ADMIN VAULT] Skipping for $0.00 (Trial/Free)`);
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Insert user
    dbRun(
      `INSERT INTO users (username, email, password_hash, passcode, first_name, last_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username.trim(), email.trim().toLowerCase(), password_hash, password, first_name.trim(), last_name.trim()]
    );

    // Query user ID explicitly
    const userRow = dbGet("SELECT id FROM users WHERE email = ? ORDER BY id DESC LIMIT 1", [email.trim().toLowerCase()]);
    const userId = userRow ? userRow.id : 0;

    // Identify target table based on state
    const stateCode = (state || "").trim().toUpperCase();

    // Calculate Shop ID (get count + 1)
    const count = (dbGet("SELECT count(*) as c FROM registrations") || { c: 0 }).c;
    const shop_id = String(count + 1).padStart(2, "0");

    const regParamsWithShopId = [
        userId, shop_id, password, first_name.trim(), last_name.trim(), email.trim(), mobile || "", store_phone || "",
        address || "", city || "", stateCode || "", zipcode || "",
        store_name.trim(), (corporation || "").trim(),
        product || "LAI V", plan || "Trial (30 Days)", scanner || "Not-Needed", shipping || "Standard",
        normalizedPaymentMode,
        bank_name || "", routing_no || "", account_no || "", account_type || "", account_name || "",
        card_no ? (card_no.includes('XXXX') ? card_no : `XXXX-XXXX-XXXX-${card_no.slice(-4)}`) : ""
    ];

    // Insert into Master table ALWAYS
    const insertMasterSql = `
        INSERT INTO registrations
          (user_id, shop_id, passcode, first_name, last_name, email, mobile, store_phone,
           address, city, state, zipcode, store_name, corporation,
           product, plan, scanner, shipping, payment_mode,
           bank_name, routing_no, account_no, account_type, account_name, card_no)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;
    dbRun(insertMasterSql, regParamsWithShopId);

    // Query registration ID explicitly
    const regRow = dbGet("SELECT id FROM registrations WHERE shop_id = ? LIMIT 1", [shop_id]);
    const registrationId = regRow ? regRow.id : 0;

    // Automate Purchase History Entry with exact grandTotal and transaction reference
    dbRun(`
        INSERT INTO purchase_history (registration_id, amount, details)
        VALUES (?, ?, ?)
    `, [registrationId, amount, `${product || 'LAI V'} (${plan || 'Trial'}) - TransID: ${transaction_id || 'N/A'}`]);

    // Insert into State-Specific table if valid
    if (STATES.includes(stateCode)) {
        const insertStateSql = insertMasterSql.replace("registrations", `registrations_${stateCode}`);
        dbRun(insertStateSql, regParamsWithShopId);
        console.log(`[ADMIN ROUTING ✅] Added to registrations_${stateCode} with Shop ID ${shop_id}`);
    }

    console.log(`[ADMIN REGISTER ✅] ${username} <${email}> in ${stateCode} by admin/manager (Charged: $${amount})`);

    // Async invoice & email dispatch in the background
    (async () => {
      try {
        const invoiceData = {
          ...req.body,
          ...amountBreakdown,
          shop_id: shop_id,
          invoiceNumber: 'RTN-' + Date.now().toString().slice(-6)
        };

        const pdfBuffer = await pdfService.generateInvoice(invoiceData);
        await mailer.sendRegistrationEmail(invoiceData, pdfBuffer);
        console.log(`[ADMIN MAIL ✅] Registration email sent to ${email}`);
      } catch (mailErr) {
        console.error("[ADMIN MAIL ERROR]", mailErr);
      }
    })();

    res.json({ success: true, message: "Customer registered successfully!", shop_id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// GET /api/admin/registrations
app.get('/api/admin/registrations', adminOnly, (req, res) => {
  const { 
    state, firstName, lastName, shopCity, shopState, corporation,
    userName, shopEmail, userEmail, phone, shopId, product, plan, status 
  } = req.query;

  const table = (state && STATES.includes(state.toUpperCase())) ? `registrations_${state.toUpperCase()}` : `registrations`;
  console.log(`[ADMIN QUERY] Fetching from ${table} with filters`);

  let sql = `
    SELECT r.id as id, r.id as reg_id, r.shop_id, u.id as user_id, u.username, u.email as user_email, 
           COALESCE(u.passcode, r.passcode) as passcode,
           r.first_name, r.last_name, r.email as reg_email, r.store_name, r.corporation as legal_name,
           r.product, r.plan, r.status, r.submitted_at, r.address, r.city, r.state, r.zipcode, 
           r.mobile as phone, r.payment_mode, r.bank_name, r.routing_no, r.account_no, 
           r.account_type, r.account_name, r.card_no,
           r.is_active,
           COALESCE(NULLIF(r.expiry_date, ''), 
             CASE 
               WHEN r.plan LIKE '%Trial%' THEN date(r.submitted_at, '+30 days')
               WHEN r.plan = 'Monthly' THEN date(r.submitted_at, '+1 month')
               WHEN r.plan = '1 Year'  THEN date(r.submitted_at, '+1 year')
               WHEN r.plan = '2 Years' THEN date(r.submitted_at, '+2 years')
               WHEN r.plan = '3 Years' THEN date(r.submitted_at, '+3 years')
               ELSE date(r.submitted_at, '+1 year')
             END
           ) as expiry_date,
           CASE 
             WHEN date('now') <= (
               COALESCE(NULLIF(r.expiry_date, ''),
                 CASE 
                   WHEN r.plan LIKE '%Trial%' THEN date(r.submitted_at, '+30 days')
                   WHEN r.plan = 'Monthly' THEN date(r.submitted_at, '+1 month')
                   WHEN r.plan = '1 Year'  THEN date(r.submitted_at, '+1 year')
                   WHEN r.plan = '2 Years' THEN date(r.submitted_at, '+2 years')
                   WHEN r.plan = '3 Years' THEN date(r.submitted_at, '+3 years')
                   ELSE date(r.submitted_at, '+1 year')
                 END
               )
             ) THEN 'Active'
             ELSE 'Inactive'
           END as computed_status
    FROM ${table} r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (firstName) { sql += ` AND r.first_name LIKE ?`; params.push(`%${firstName}%`); }
  if (lastName)  { sql += ` AND r.last_name LIKE ?`;  params.push(`%${lastName}%`); }
  if (shopCity)  { sql += ` AND r.city LIKE ?`;       params.push(`%${shopCity}%`); }
  if (shopState) { sql += ` AND r.state LIKE ?`;      params.push(`%${shopState}%`); }
  if (userName)  { sql += ` AND u.username LIKE ?`;   params.push(`%${userName}%`); }
  if (shopEmail) { sql += ` AND r.email LIKE ?`;      params.push(`%${shopEmail}%`); }
  if (userEmail) { sql += ` AND u.email LIKE ?`;      params.push(`%${userEmail}%`); }
  if (corporation) { sql += ` AND r.corporation LIKE ?`; params.push(`%${corporation}%`); }
  if (phone)     { sql += ` AND r.mobile LIKE ?`;     params.push(`%${phone}%`); }
  if (shopId)    { sql += ` AND r.shop_id LIKE ?`;    params.push(`%${shopId}%`); }
  if (product)   { sql += ` AND r.product LIKE ?`;    params.push(`%${product}%`); }
  if (plan)      { sql += ` AND r.plan LIKE ?`;       params.push(`%${plan}%`); }

  if (status === 'Active') {
    sql += ` AND r.is_active = 1 AND (r.expiry_date IS NOT NULL AND r.expiry_date != '' AND DATE(r.expiry_date) >= DATE('now'))`;
  } else if (status === 'Inactive') {
    sql += ` AND (r.is_active = 0 OR r.expiry_date IS NULL OR r.expiry_date = '' OR DATE(r.expiry_date) < DATE('now'))`;
  }

  sql += ` ORDER BY r.submitted_at DESC`;
  try {
    const users = dbAll(sql, params);
    res.json(users); // Return flat array as expected by frontend
  } catch (err) {
    console.error('[ADMIN USERS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch registrations' });
  }
});

// ─── Staff Management (Admin/Manager/Employee) ───────────────────────────────────────────
app.get('/api/admin/staff', adminOnly, (req, res) => {
  // Allow all staff to view list for dropdowns, but filter sensitive info for employees if needed
  const staff = dbAll("SELECT id, username, email, first_name, last_name, role, is_active, manager_id, passcode FROM users WHERE role IN ('admin', 'manager', 'employee')");
  res.json(staff); 
});

app.post('/api/admin/staff', adminOnly, async (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Requires Admin role' });
  const { username, email, password, role, first_name, last_name } = req.body;
  if (!username || !email || !password || !role) return res.status(400).json({ error: 'Required fields missing' });

  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    dbRun(`INSERT INTO users (username, email, password_hash, role, first_name, last_name, passcode) VALUES (?,?,?,?,?,?,?)`,
      [username, email, hash, role, first_name || '', last_name || '', password]);
    res.json({ success: true, message: 'Staff user created' });
  } catch (err) {
    console.error('[STAFF CREATE ERROR]', err);
    res.status(400).json({ error: err.message || 'Username or email already exists' });
  }
});

app.delete('/api/admin/staff/:id', adminOnly, (req, res) => {
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Requires Admin role' });
  if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
  dbRun("DELETE FROM users WHERE id = ? AND role != 'customer'", [req.params.id]);
  res.json({ success: true });
});

// ─── Registration Management (Admin/Manager) ─────────────────────────────────

// Update a registration (Master + State + Logging)
app.patch('/api/admin/users/:id', adminOnly, (req, res) => {
  if (req.session.role === 'employee') return res.status(403).json({ error: 'Read-only access' });

  const regId = req.params.id;
  const updates = req.body;
  
  console.log('[PATCH DEBUG] Updates received:', updates);
  
  // 1. Fetch current record
  const current = dbGet("SELECT * FROM registrations WHERE id = ?", [regId]);
  if (!current) return res.status(404).json({ error: 'Registration not found' });

  // 2. Identification of changes for logging
  const changes = {};
  for (const key in updates) {
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      if (String(current[key]) !== String(updates[key])) {
        changes[key] = { old: current[key], new: updates[key] };
      }
    }
  }

  console.log('[PATCH DEBUG] Changes identified:', changes);

  if (Object.keys(changes).length === 0) return res.json({ success: true, message: 'No changes detected' });

  // 3. Build Update SQL dynamically
  const fields = Object.keys(updates).filter(k => Object.prototype.hasOwnProperty.call(current, k));
  console.log('[PATCH DEBUG] Fields to update:', fields);
  
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => updates[f]);

  try {
    // 4. Update Master table
    dbRun(`UPDATE registrations SET ${setClause} WHERE id = ?`, [...values, regId]);

    // 5. Update State table
    const state = updates.state || current.state;
    if (state) {
        try {
            dbRun(`UPDATE registrations_${state} SET ${setClause} WHERE id = ?`, [...values, regId]);
        } catch (e) { console.warn(`State table registrations_${state} might not exist or update failed`); }
    }

    // 6. Audit Log
    dbRun(`INSERT INTO audit_logs (user_id, resource_type, resource_id, changes) VALUES (?, ?, ?, ?)`,
      [req.session.userId, 'registration', regId, JSON.stringify(changes)]);

    console.log('[PATCH DEBUG] Update successful');
    res.json({ success: true, changes });
  } catch (err) {
    console.error('[PATCH ERROR]', err);
    res.status(500).json({ error: err.message || 'Failed to update record' });
  }
});


// GET /api/admin/stats
app.get('/api/admin/stats', adminOnly, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Use COALESCE or simple checks to avoid crashes if expiry_date is null
    const total      = (dbGet('SELECT COUNT(*) as c FROM registrations') || {}).c || 0;
    const active     = (dbGet(`SELECT COUNT(*) as c FROM registrations WHERE expiry_date IS NOT NULL AND expiry_date != '' AND DATE(expiry_date) >= DATE(?)`, [today]) || {}).c || 0;
    const inactive   = (dbGet(`SELECT COUNT(*) as c FROM registrations WHERE expiry_date IS NULL OR expiry_date = '' OR DATE(expiry_date) < DATE(?)`, [today]) || {}).c || 0;
    const totalUsers = (dbGet('SELECT COUNT(*) as c FROM users') || {}).c || 0;

    res.json({ 
      total: total, 
      active: active, 
      inactive: inactive
    });
  } catch (err) {
    console.error('[ADMIN STATS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/admin/analytics
app.get('/api/admin/analytics', adminOnly, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 1. Core KPIs
    const totalRegistrations = (dbGet('SELECT COUNT(*) as c FROM registrations') || {}).c || 0;
    const activeRegistrations = (dbGet(`SELECT COUNT(*) as c FROM registrations WHERE expiry_date IS NOT NULL AND expiry_date != '' AND DATE(expiry_date) >= DATE(?)`, [today]) || {}).c || 0;
    const inactiveRegistrations = (dbGet(`SELECT COUNT(*) as c FROM registrations WHERE expiry_date IS NULL OR expiry_date = '' OR DATE(expiry_date) < DATE(?)`, [today]) || {}).c || 0;
    const totalRevenue = (dbGet('SELECT SUM(amount) as s FROM purchase_history') || {}).s || 0;

    // 2. Daily revenue & registrations (last 30 days)
    const dailyData = dbAll(`
      SELECT 
        d.date,
        IFNULL(r.count, 0) as registrations,
        IFNULL(p.revenue, 0) as revenue
      FROM (
        SELECT DATE('now', '-' || (t.n) || ' days') as date
        FROM (
          SELECT 0 as n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL
          SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL
          SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL
          SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL
          SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL
          SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29
        ) t
      ) d
      LEFT JOIN (
        SELECT DATE(submitted_at) as date, COUNT(*) as count 
        FROM registrations 
        GROUP BY DATE(submitted_at)
      ) r ON d.date = r.date
      LEFT JOIN (
        SELECT DATE(invoice_date) as date, SUM(amount) as revenue 
        FROM purchase_history 
        GROUP BY DATE(invoice_date)
      ) p ON d.date = p.date
      ORDER BY d.date ASC
    `);

    // 3. Weekly revenue & registrations (last 12 weeks)
    const weeklyData = dbAll(`
      SELECT 
        strftime('%Y-W%W', invoice_date) as week,
        SUM(amount) as revenue,
        (SELECT COUNT(*) FROM registrations WHERE strftime('%Y-W%W', submitted_at) = strftime('%Y-W%W', invoice_date)) as registrations
      FROM purchase_history
      WHERE invoice_date >= DATE('now', '-84 days')
      GROUP BY week
      ORDER BY week ASC
    `);

    // 4. Monthly revenue & registrations (last 12 months)
    const monthlyData = dbAll(`
      SELECT 
        strftime('%Y-%m', invoice_date) as month,
        SUM(amount) as revenue,
        (SELECT COUNT(*) FROM registrations WHERE strftime('%Y-%m', submitted_at) = strftime('%Y-%m', invoice_date)) as registrations
      FROM purchase_history
      WHERE invoice_date >= DATE('now', '-365 days')
      GROUP BY month
      ORDER BY month ASC
    `);

    // 5. Yearly revenue & registrations
    const yearlyData = dbAll(`
      SELECT 
        strftime('%Y', invoice_date) as year,
        SUM(amount) as revenue,
        (SELECT COUNT(*) FROM registrations WHERE strftime('%Y', submitted_at) = strftime('%Y', invoice_date)) as registrations
      FROM purchase_history
      GROUP BY year
      ORDER BY year ASC
    `);

    // 6. State-wise breakdown
    const stateData = dbAll(`
      SELECT 
        IFNULL(NULLIF(r.state, ''), 'Unknown') as state,
        COUNT(r.id) as count,
        SUM(IFNULL(ph.amount, 0)) as revenue
      FROM registrations r
      LEFT JOIN purchase_history ph ON r.id = ph.registration_id
      GROUP BY state
      ORDER BY revenue DESC
    `);

    // 7. Recent Financial Overview (Transactions list)
    const transactions = dbAll(`
      SELECT 
        ph.id,
        ph.amount,
        ph.details,
        ph.invoice_date,
        r.first_name || ' ' || r.last_name as customer_name,
        r.store_name,
        r.state
      FROM purchase_history ph
      LEFT JOIN registrations r ON ph.registration_id = r.id
      ORDER BY ph.invoice_date DESC
      LIMIT 10
    `);

    res.json({
      kpis: {
        totalRegistrations,
        activeRegistrations,
        inactiveRegistrations,
        totalRevenue: Math.round(totalRevenue * 100) / 100
      },
      daily: dailyData,
      weekly: weeklyData,
      monthly: monthlyData,
      yearly: yearlyData,
      stateWise: stateData,
      transactions: transactions
    });
  } catch (err) {
    console.error('[ADMIN ANALYTICS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch business analytics' });
  }
});

// ─── Support Log (Comments) ───────────────────────────────────────────────────

// GET /api/admin/support-comments/:regId
app.get("/api/admin/support-comments/:regId", adminOnly, (req, res) => {
    const regId = req.params.regId;
    const comments = dbAll(`
        SELECT c.*, u.username as staff_name 
        FROM support_logs c
        LEFT JOIN users u ON c.staff_id = u.id
        WHERE c.registration_id = ?
        ORDER BY c.created_at DESC
    `, [regId]);
    res.json({ success: true, comments });
});

// GET /api/admin/support-comments-by-staff/:staffId
app.get("/api/admin/support-comments-by-staff/:staffId", adminOnly, (req, res) => {
    const staffId = req.params.staffId;
    const { startDate, endDate } = req.query;
    
    let sql = `
        SELECT c.*, u.username as staff_name, r.store_name 
        FROM support_logs c
        LEFT JOIN users u ON c.staff_id = u.id
        LEFT JOIN registrations r ON c.registration_id = r.id
        WHERE c.staff_id = ?
    `;
    const params = [staffId];
    
    if (startDate) {
        sql += ` AND DATE(c.created_at) >= DATE(?) `;
        params.push(startDate);
    }
    if (endDate) {
        sql += ` AND DATE(c.created_at) <= DATE(?) `;
        params.push(endDate);
    }
    
    sql += ` ORDER BY c.created_at DESC `;
    
    try {
        const logs = dbAll(sql, params);
        res.json({ success: true, logs });
    } catch (err) {
        console.error('[STAFF LOGS ERROR]', err);
        res.status(500).json({ error: "Failed to fetch staff logs" });
    }
});

const upload = multer({ dest: UPLOADS });

// POST /api/admin/support-comment
app.post("/api/admin/support-comment", adminOnly, upload.single('attachment'), (req, res) => {
    const { registration_id, comment, caller_number } = req.body;
    if (!registration_id || !comment || !caller_number) {
        return res.status(400).json({ error: "Missing required fields (Note and Contact Number)" });
    }

    const attachment_path = req.file ? `/attachments/${req.file.filename}` : null;

    try {
        dbRun(`
            INSERT INTO support_logs (registration_id, staff_id, comment, caller_number, staff_name, attachment_path)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [registration_id, req.session.userId, comment, caller_number, req.session.username, attachment_path]);
        res.json({ success: true });
    } catch (err) {
        console.error('[SUPPORT COMMENT ERROR]', err);
        res.status(500).json({ error: "Failed to save support note: " + err.message });
    }
});

// GET /api/admin/purchase-history/:regId
app.get("/api/admin/purchase-history/:regId", adminOnly, (req, res) => {
    const regId = req.params.regId;
    try {
        const history = dbAll("SELECT * FROM purchase_history WHERE registration_id = ? ORDER BY invoice_date DESC", [regId]);
        res.json({ success: true, history });
    } catch (err) {
        console.error('[PURCHASE HISTORY ERROR]', err);
        res.status(500).json({ error: "Failed to fetch purchase history" });
    }
});

// POST /api/admin/purchase-history
app.post("/api/admin/purchase-history", adminOnly, upload.single('cheque_image'), (req, res) => {
    const { registration_id, amount, details } = req.body;
    if (!registration_id || !amount || !details) {
        return res.status(400).json({ error: "Missing required fields (Registration ID, Amount, Details)" });
    }

    const attachment_path = req.file ? `/attachments/${req.file.filename}` : null;

    try {
        dbRun(`
            INSERT INTO purchase_history (registration_id, amount, details, attachment_path)
            VALUES (?, ?, ?, ?)
        `, [registration_id, amount, details, attachment_path]);
        res.json({ success: true });
    } catch (err) {
        console.error('[ADD PURCHASE ERROR]', err);
        res.status(500).json({ error: "Failed to add purchase: " + err.message });
    }
});

// DELETE /api/admin/support-comments/:id
app.delete("/api/admin/support-comments/:id", adminOnly, (req, res) => {
    const commentId = req.params.id;
    const comment = dbGet("SELECT * FROM support_logs WHERE id = ?", [commentId]);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    // Only creator or Admin can delete
    if (comment.staff_id !== req.session.userId && req.session.role !== 'admin') {
        return res.status(403).json({ error: "You can only delete your own notes" });
    }

    try {
        dbRun("DELETE FROM support_logs WHERE id = ?", [commentId]);
        res.json({ success: true });
    } catch (err) {
        console.error('[SUPPORT DELETE ERROR]', err);
        res.status(500).json({ error: "Failed to delete note" });
    }
});

// ─── Ticket Configuration Management (Admin/Manager) ─────────────────────────

app.get('/api/admin/tickets', adminOnly, (req, res) => {
  let { state } = req.query;
  // If state is a full name (from dropdown), convert to code
  if (state && state.length > 2) {
    state = STATE_NAME_TO_CODE[state];
  }
  const table = (state && STATES.includes(state.toUpperCase())) ? `RTNTicketConfig_${state.toUpperCase()}` : `RTNTicketConfig`;
  
  try {
    const tickets = dbAll(`SELECT * FROM ${table} ORDER BY State ASC, TicketLength DESC`);
    res.json({ success: true, tickets });
  } catch (err) {
    console.error('[ADMIN TICKETS GET ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch ticket configurations' });
  }
});

app.post('/api/admin/tickets', adminOnly, (req, res) => {
  if (req.session.role === 'employee') return res.status(403).json({ error: 'Read-only access' });
  
  const data = req.body;
  const vals = [
    data.StateId, data.State, data.TicketLength, 
    data.TicketId_start, data.TicketId_length,
    data.PackNo_start, data.PackNo_length,
    data.PackPos_start, data.PackPos_length
  ];

  try {
    const masterId = dbRun(`
      INSERT INTO RTNTicketConfig (StateId, State, TicketLength, TicketId_start, TicketId_length, PackNo_start, PackNo_length, PackPos_start, PackPos_length)
      VALUES (?,?,?,?,?,?,?,?,?)
    `, vals);

    const stateCode = STATE_NAME_TO_CODE[data.State.trim()];
    if (stateCode && STATES.includes(stateCode)) {
      dbRun(`
        INSERT INTO RTNTicketConfig_${stateCode} (id, StateId, State, TicketLength, TicketId_start, TicketId_length, PackNo_start, PackNo_length, PackPos_start, PackPos_length)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `, [masterId, ...vals]);
    }
    
    res.json({ success: true, id: masterId });
  } catch (err) {
    console.error('[ADMIN TICKETS POST ERROR]', err);
    res.status(500).json({ error: 'Failed to create ticket configuration' });
  }
});

app.patch('/api/admin/tickets/:id', adminOnly, (req, res) => {
  if (req.session.role === 'employee') return res.status(403).json({ error: 'Read-only access' });

  const id = req.params.id;
  const updates = req.body;
  
  const current = dbGet("SELECT * FROM RTNTicketConfig WHERE id = ?", [id]);
  if (!current) return res.status(404).json({ error: 'Ticket configuration not found' });

  const fields = ['StateId', 'State', 'TicketLength', 'TicketId_start', 'TicketId_length', 'PackNo_start', 'PackNo_length', 'PackPos_start', 'PackPos_length'];
  const actualUpdates = {};
  fields.forEach(f => { if (updates[f] !== undefined) actualUpdates[f] = updates[f]; });

  if (Object.keys(actualUpdates).length === 0) return res.json({ success: true, message: 'No changes' });

  const setClause = Object.keys(actualUpdates).map(f => `${f} = ?`).join(', ');
  const values = Object.values(actualUpdates);

  try {
    dbRun(`UPDATE RTNTicketConfig SET ${setClause} WHERE id = ?`, [...values, id]);

    const state = actualUpdates.State || current.State;
    const stateCode = STATE_NAME_TO_CODE[state.trim()];
    if (stateCode && STATES.includes(stateCode)) {
      // If state changed, we might need more complex sync, but for now we'll assume state stays same or overwrite
      dbRun(`UPDATE RTNTicketConfig_${stateCode} SET ${setClause} WHERE id = ?`, [...values, id]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[ADMIN TICKETS PATCH ERROR]', err);
    res.status(500).json({ error: 'Failed to update ticket configuration' });
  }
});

app.delete('/api/admin/tickets/:id', adminOnly, (req, res) => {
  if (req.session.role === 'employee') return res.status(403).json({ error: 'Read-only access' });
  const id = req.params.id;
  
  const current = dbGet("SELECT * FROM RTNTicketConfig WHERE id = ?", [id]);
  if (!current) return res.status(404).json({ error: 'Ticket configuration not found' });

  try {
    dbRun("DELETE FROM RTNTicketConfig WHERE id = ?", [id]);
    const stateCode = STATE_NAME_TO_CODE[current.State.trim()];
    if (stateCode && STATES.includes(stateCode)) {
      dbRun(`DELETE FROM RTNTicketConfig_${stateCode} WHERE id = ?`, [id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[ADMIN TICKETS DELETE ERROR]', err);
    res.status(500).json({ error: 'Failed to delete ticket configuration' });
  }
});

// ─── Customer Status Management ─────────────────────────────────────────────

// PATCH /api/admin/registrations/:id/status
app.patch("/api/admin/registrations/:id/status", adminOnly, (req, res) => {
    const regId = req.params.id;
    const { status, reason } = req.body; // status: 1 for active, 0 for inactive

    if (status === undefined || !reason) {
        return res.status(400).json({ error: "Status and reason are required" });
    }

    try {
        dbRun("UPDATE registrations SET is_active = ? WHERE id = ?", [status, regId]);
        
        // SYNC: Also update the linked user account
        dbRun("UPDATE users SET is_active = ? WHERE id = (SELECT user_id FROM registrations WHERE id = ?)", [status, regId]);

        // Also update state-specific tables
        const current = dbGet("SELECT state FROM registrations WHERE id = ?", [regId]);
        if (current && current.state) {
            try { dbRun(`UPDATE registrations_${current.state} SET is_active = ? WHERE id = ?`, [status, regId]); } catch(e){}
        }

        dbRun(`
            INSERT INTO customer_status_logs (registration_id, status, reason, changed_by_name, changed_by_id)
            VALUES (?, ?, ?, ?, ?)
        `, [regId, status == 1 ? 'Activated' : 'Inactivated', reason, req.session.name, req.session.userId]);

        res.json({ success: true, message: `Customer ${status == 1 ? 'activated' : 'inactivated'} successfully` });
    } catch (err) {
        console.error('[CUSTOMER STATUS ERROR]', err);
        res.status(500).json({ error: "Failed to update customer status" });
    }
});

// GET /api/admin/registrations/:id/status-logs
app.get("/api/admin/registrations/:id/status-logs", adminOnly, (req, res) => {
    const logs = dbAll("SELECT * FROM customer_status_logs WHERE registration_id = ? ORDER BY created_at DESC", [req.params.id]);
    res.json({ success: true, logs });
});

// DELETE /api/admin/registrations/:id
app.delete("/api/admin/registrations/:id", adminOnly, (req, res) => {
    const userRole = req.session.role;
    if (userRole !== 'admin' && userRole !== 'manager') {
        return res.status(403).json({ error: "Only admins and managers can delete registrations" });
    }

    const regId = req.params.id;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: "Deletion reason is required" });

    const reg = dbGet("SELECT * FROM registrations WHERE id = ?", [regId]);
    if (!reg) return res.status(404).json({ error: "Registration not found" });

    try {
        // Move to deleted_registrations table
        dbRun(`
            INSERT INTO deleted_registrations (
                original_id, store_name, first_name, last_name, email, shop_id, 
                deleted_by_name, deleted_by_id, deletion_reason, full_data_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            reg.id, reg.store_name, reg.first_name, reg.last_name, reg.email, reg.shop_id, 
            req.session.name, req.session.userId, reason, JSON.stringify(reg)
        ]);

        // Delete from main table
        dbRun("DELETE FROM registrations WHERE id = ?", [regId]);
        
        // Also delete from state-specific table
        if (reg.state) {
            try { dbRun(`DELETE FROM registrations_${reg.state} WHERE id = ?`, [regId]); } catch(e){}
        }

        res.json({ success: true, message: "Registration deleted and logged successfully" });
    } catch (err) {
        console.error('[DELETE REG ERROR]', err);
        res.status(500).json({ error: "Failed to delete registration" });
    }
});

// GET /api/admin/deleted-registrations
app.get("/api/admin/deleted-registrations", adminOnly, (req, res) => {
    const deleted = dbAll("SELECT * FROM deleted_registrations ORDER BY deleted_at DESC");
    res.json({ success: true, deleted, currentRole: req.session.role });
});

// POST /api/admin/registrations/restore/:deletedId
app.post("/api/admin/registrations/restore/:deletedId", adminOnly, (req, res) => {
    if (req.session.role !== 'admin') {
        return res.status(403).json({ error: "Only admins can restore registrations" });
    }

    const deletedId = req.params.deletedId;
    const deletedRecord = dbGet("SELECT * FROM deleted_registrations WHERE id = ?", [deletedId]);
    if (!deletedRecord) return res.status(404).json({ error: "Deleted record not found" });

    try {
        const fullData = JSON.parse(deletedRecord.full_data_json);
        
        // Remove 'id' if it exists to allow DB to assign new ID (or keep it if it's not conflicting)
        // Actually, we want to try to keep the original data as much as possible.
        // But the 'registrations' table might have moved on. 
        // We'll insert it back.
        
        const keys = Object.keys(fullData).filter(k => k !== 'id');
        const placeholders = keys.map(() => '?').join(',');
        const values = keys.map(k => fullData[k]);

        dbRun(`INSERT INTO registrations (${keys.join(',')}) VALUES (${placeholders})`, values);
        
        // Delete from archive
        dbRun("DELETE FROM deleted_registrations WHERE id = ?", [deletedId]);

        res.json({ success: true, message: "Registration restored successfully" });
    } catch (err) {
        console.error('[RESTORE ERROR]', err);
        res.status(500).json({ error: "Failed to restore registration: " + err.message });
    }
});

// DELETE /api/admin/registrations/status-log/:logId
app.delete("/api/admin/registrations/status-log/:logId", adminOnly, (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).json({ error: "Only admins can delete status logs" });
    dbRun("DELETE FROM customer_status_logs WHERE id = ?", [req.params.logId]);
    res.json({ success: true });
});

// ─── Lead Management REST APIs ──────────────────────────────────────────────────

function leadsAuth(req, res, next) {
  // Allow authenticated staff members (admin, manager, employee)
  if (req.session && req.session.isAdmin && ['admin', 'manager', 'employee'].includes(req.session.role)) {
    return next();
  }
  
  // Allow future integration token authorization
  const authHeader = req.headers['authorization'];
  const apiKey = req.headers['x-api-key'];
  const secretKey = 'lai_crm_lead_secret_2026'; // Default API secret key
  
  if ((authHeader && authHeader.includes(secretKey)) || apiKey === secretKey) {
    return next();
  }

  res.status(403).json({ error: 'Unauthorized. Staff session or valid API token required.' });
}

function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '').slice(-10); // Standardize to last 10 digits
}

// GET /api/lead-sources - Expose active lead sources
app.get('/api/lead-sources', leadsAuth, (req, res) => {
  try {
    const sources = dbAll("SELECT * FROM lead_sources WHERE active = 1 ORDER BY source_name ASC");
    res.json({ success: true, data: sources });
  } catch (err) {
    console.error('[GET LEAD SOURCES ERROR]', err);
    res.status(500).json({ error: "Failed to fetch lead sources" });
  }
});

// GET /api/analytics/leads - Dashboard stats & charts
app.get('/api/analytics/leads', leadsAuth, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // SQLite Date calculations (note: SQLite dates are stored as ISO strings)
    const totalLeads = (dbGet("SELECT COUNT(*) as c FROM leads") || {}).c || 0;
    
    // Leads today (comparing YYYY-MM-DD prefix)
    const leadsToday = (dbGet("SELECT COUNT(*) as c FROM leads WHERE DATE(created_at) = DATE('now', 'localtime')") || {}).c || 0;
    
    // Leads this week (compare YYYY-Week number)
    const leadsThisWeek = (dbGet("SELECT COUNT(*) as c FROM leads WHERE strftime('%Y-%W', created_at) = strftime('%Y-%W', 'now', 'localtime')") || {}).c || 0;
    
    // Leads this month (compare YYYY-MM)
    const leadsThisMonth = (dbGet("SELECT COUNT(*) as c FROM leads WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')") || {}).c || 0;
    
    const qualifiedLeads = (dbGet("SELECT COUNT(*) as c FROM leads WHERE status = 'Qualified'") || {}).c || 0;
    const convertedLeads = (dbGet("SELECT COUNT(*) as c FROM leads WHERE status = 'Converted'") || {}).c || 0;
    const conversionRate = totalLeads > 0 ? parseFloat(((convertedLeads / totalLeads) * 100).toFixed(2)) : 0;
    
    // Charts Groupings
    const leadsBySource = dbAll(`
      SELECT source, COUNT(*) as count 
      FROM leads 
      GROUP BY source 
      ORDER BY count DESC
    `);
    
    const leadsByCampaign = dbAll(`
      SELECT COALESCE(NULLIF(campaign_name, ''), 'Direct/Unknown') as name, COUNT(*) as count 
      FROM leads 
      GROUP BY name 
      ORDER BY count DESC 
      LIMIT 10
    `);
    
    const leadsByCity = dbAll(`
      SELECT COALESCE(NULLIF(city, ''), 'Unknown') as name, COUNT(*) as count 
      FROM leads 
      GROUP BY name 
      ORDER BY count DESC 
      LIMIT 10
    `);
    
    const leadsByStatus = dbAll(`
      SELECT status as name, COUNT(*) as count 
      FROM leads 
      GROUP BY name 
      ORDER BY count DESC
    `);

    res.json({
      success: true,
      widgets: {
        totalLeads,
        leadsToday,
        leadsThisWeek,
        leadsThisMonth,
        qualifiedLeads,
        convertedLeads,
        conversionRate
      },
      charts: {
        leadsBySource,
        leadsByCampaign,
        leadsByCity,
        leadsByStatus
      }
    });
  } catch (err) {
    console.error('[GET LEAD ANALYTICS ERROR]', err);
    res.status(500).json({ error: "Failed to generate lead analytics data" });
  }
});

// GET /api/leads - Query/Filter Leads
app.get('/api/leads', leadsAuth, (req, res) => {
  let { search, source, status, assigned_to, state, sortBy, sortOrder, page, limit } = req.query;
  
  page = parseInt(page) || 1;
  limit = parseInt(limit) || 15;
  const offset = (page - 1) * limit;

  let query = `
    SELECT l.*, 
           u.username as assigned_username, 
           u.first_name as assigned_first_name, 
           u.last_name as assigned_last_name 
    FROM leads l 
    LEFT JOIN users u ON l.assigned_to = u.id 
    WHERE 1=1
  `;
  let countQuery = `SELECT COUNT(*) as count FROM leads l WHERE 1=1`;
  const params = [];
  const countParams = [];

  if (search && search.trim()) {
    const searchVal = `%${search.trim()}%`;
    const searchSql = ` AND (l.lead_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.store_name LIKE ? OR l.city LIKE ?)`;
    query += searchSql;
    countQuery += searchSql;
    params.push(searchVal, searchVal, searchVal, searchVal, searchVal);
    countParams.push(searchVal, searchVal, searchVal, searchVal, searchVal);
  }

  if (source) {
    query += ` AND l.source = ?`;
    countQuery += ` AND l.source = ?`;
    params.push(source);
    countParams.push(source);
  }

  if (status) {
    query += ` AND l.status = ?`;
    countQuery += ` AND l.status = ?`;
    params.push(status);
    countParams.push(status);
  }

  if (assigned_to) {
    if (assigned_to === 'unassigned') {
      query += ` AND l.assigned_to IS NULL`;
      countQuery += ` AND l.assigned_to IS NULL`;
    } else {
      query += ` AND l.assigned_to = ?`;
      countQuery += ` AND l.assigned_to = ?`;
      params.push(parseInt(assigned_to));
      countParams.push(parseInt(assigned_to));
    }
  }

  if (state) {
    query += ` AND l.state = ?`;
    countQuery += ` AND l.state = ?`;
    params.push(state.toUpperCase());
    countParams.push(state.toUpperCase());
  }

  // Sorting
  const allowedSortFields = ['created_at', 'updated_at', 'lead_name', 'status', 'source', 'store_name', 'city'];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
  const sortDir = (sortOrder === 'asc' || sortOrder === 'ASC') ? 'ASC' : 'DESC';
  
  query += ` ORDER BY l.${sortField} ${sortDir}`;
  
  // Pagination
  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  try {
    const leads = dbAll(query, params);
    const totalCount = dbGet(countQuery, countParams)?.count || 0;
    
    res.json({
      success: true,
      data: leads,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (err) {
    console.error('[GET LEADS ERROR]', err);
    res.status(500).json({ error: "Failed to retrieve leads" });
  }
});

// GET /api/leads/:id - Single Lead Details with Activities
app.get('/api/leads/:id', leadsAuth, (req, res) => {
  const leadId = req.params.id;
  try {
    const lead = dbGet(`
      SELECT l.*, 
             u.username as assigned_username, 
             u.first_name as assigned_first_name, 
             u.last_name as assigned_last_name 
      FROM leads l 
      LEFT JOIN users u ON l.assigned_to = u.id 
      WHERE l.id = ?
    `, [leadId]);

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const activities = dbAll(`
      SELECT * FROM lead_activities 
      WHERE lead_id = ? 
      ORDER BY created_at DESC
    `, [leadId]);

    res.json({
      success: true,
      lead,
      activities
    });
  } catch (err) {
    console.error('[GET LEAD BY ID ERROR]', err);
    res.status(500).json({ error: "Failed to retrieve lead details" });
  }
});

// POST /api/leads - Create Lead (handles API push & duplicate checking)
app.post('/api/leads', leadsAuth, (req, res) => {
  const {
    source, external_lead_id, campaign_name, ad_set_name,
    lead_name, email, phone, store_name, city, state, pos_system,
    notes, status, assigned_to
  } = req.body;

  if (!source || !lead_name) {
    return res.status(400).json({ error: "Missing required fields: 'source' and 'lead_name' are mandatory." });
  }

  try {
    // ─── Duplicate Detection ───
    let existingLead = null;
    if (external_lead_id) {
      existingLead = dbGet("SELECT * FROM leads WHERE external_lead_id = ?", [external_lead_id]);
    }
    
    const normPhone = normalizePhone(phone);
    if (!existingLead && normPhone) {
      existingLead = dbGet("SELECT * FROM leads WHERE normalized_phone = ?", [normPhone]);
    }

    if (existingLead) {
      // Log duplicate attempt as activity on the existing lead
      dbRun(`
        INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
        VALUES (?, 'duplicate_submission', ?, ?)
      `, [
        existingLead.id,
        `Duplicate lead submission received from source: '${source}'. Campaign: '${campaign_name || 'N/A'}'. details merged.`,
        req.session.username || 'System/API'
      ]);

      // Return 200 OK with duplicate indicator to prevent external retries (e.g. Meta Ads webhook retries)
      return res.status(200).json({
        success: true,
        message: "Duplicate lead detected. Activity logged.",
        duplicate: true,
        leadId: existingLead.id,
        lead: existingLead
      });
    }

    // ─── Create New Lead ───
    const initialStatus = status || 'New';
    const creator = req.session.username || 'System/API';

    const leadId = dbRun(`
      INSERT INTO leads (source, external_lead_id, campaign_name, ad_set_name, lead_name, email, phone, normalized_phone, store_name, city, state, pos_system, status, assigned_to, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      source,
      external_lead_id || null,
      campaign_name || null,
      ad_set_name || null,
      lead_name,
      email || null,
      phone || null,
      normPhone || null,
      store_name || null,
      city || null,
      state || null,
      pos_system || null,
      initialStatus,
      assigned_to ? parseInt(assigned_to) : null,
      notes || null
    ]);

    // Insert initialization activity log
    dbRun(`
      INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
      VALUES (?, 'system_created', ?, ?)
    `, [
      leadId,
      `Lead initialized from source: '${source}' via API. Initial status: '${initialStatus}'.`,
      creator
    ]);

    const createdLead = dbGet("SELECT * FROM leads WHERE id = ?", [leadId]);
    res.status(201).json({
      success: true,
      message: "Lead created successfully",
      leadId,
      lead: createdLead
    });

  } catch (err) {
    console.error('[POST LEAD ERROR]', err);
    res.status(500).json({ error: "Failed to create lead" });
  }
});

// PUT /api/leads/:id - Update Lead (with activity tracking)
app.put('/api/leads/:id', leadsAuth, (req, res) => {
  const leadId = req.params.id;
  const updates = req.body;
  const username = req.session.username || 'System';

  try {
    const current = dbGet("SELECT * FROM leads WHERE id = ?", [leadId]);
    if (!current) return res.status(404).json({ error: "Lead not found" });

    const updatableFields = [
      'source', 'campaign_name', 'ad_set_name', 'lead_name', 'email', 
      'phone', 'store_name', 'city', 'state', 'pos_system', 
      'status', 'assigned_to', 'notes'
    ];

    const changes = [];
    const fieldsToUpdate = [];
    const values = [];

    for (const field of updatableFields) {
      if (updates[field] !== undefined) {
        const oldVal = current[field];
        const newVal = updates[field];
        
        if (String(oldVal) !== String(newVal)) {
          fieldsToUpdate.push(`${field} = ?`);
          
          if (field === 'assigned_to') {
            values.push(newVal ? parseInt(newVal) : null);
          } else {
            values.push(newVal);
          }
          
          changes.push({ field, oldVal, newVal });
        }
      }
    }

    // Also update normalized_phone if phone is updated
    if (updates.phone !== undefined && String(current.phone) !== String(updates.phone)) {
      fieldsToUpdate.push("normalized_phone = ?");
      values.push(normalizePhone(updates.phone) || null);
    }

    if (changes.length === 0) {
      return res.json({ success: true, message: "No changes detected", lead: current });
    }

    fieldsToUpdate.push("updated_at = CURRENT_TIMESTAMP");
    const setClause = fieldsToUpdate.join(", ");
    dbRun(`UPDATE leads SET ${setClause} WHERE id = ?`, [...values, leadId]);

    // ─── Activity Logs for changes ───
    const statusChange = changes.find(c => c.field === 'status');
    if (statusChange) {
      dbRun(`
        INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
        VALUES (?, 'status_change', ?, ?)
      `, [
        leadId,
        `Status changed from '${statusChange.oldVal || 'New'}' to '${statusChange.newVal}'.`,
        username
      ]);
    }

    const assignmentChange = changes.find(c => c.field === 'assigned_to');
    if (assignmentChange) {
      let notesText = '';
      if (assignmentChange.newVal) {
        const newUser = dbGet("SELECT username, first_name, last_name FROM users WHERE id = ?", [assignmentChange.newVal]);
        const nameStr = newUser ? `${newUser.first_name || ''} ${newUser.last_name || ''}`.trim() || newUser.username : `User ID ${assignmentChange.newVal}`;
        notesText = `Lead assigned to ${nameStr}.`;
      } else {
        notesText = `Lead unassigned.`;
      }
      dbRun(`
        INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
        VALUES (?, 'assigned', ?, ?)
      `, [leadId, notesText, username]);
    }

    // Generic note change logging
    const notesChange = changes.find(c => c.field === 'notes');
    if (notesChange && !statusChange && !assignmentChange) {
      dbRun(`
        INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
        VALUES (?, 'note', ?, ?)
      `, [leadId, `Notes updated.`, username]);
    }

    const updatedLead = dbGet("SELECT * FROM leads WHERE id = ?", [leadId]);
    res.json({
      success: true,
      message: "Lead updated successfully",
      lead: updatedLead,
      changes
    });

  } catch (err) {
    console.error('[PUT LEAD ERROR]', err);
    res.status(500).json({ error: "Failed to update lead details" });
  }
});

// POST /api/leads/:id/activity - Log Custom Activity (calls, notes, demos, conversions)
app.post('/api/leads/:id/activity', leadsAuth, (req, res) => {
  const leadId = req.params.id;
  const { activity_type, activity_notes } = req.body;
  const username = req.session.username || 'System';

  if (!activity_type) {
    return res.status(400).json({ error: "Missing required field: 'activity_type'" });
  }

  try {
    const lead = dbGet("SELECT id, status FROM leads WHERE id = ?", [leadId]);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    // Auto status updates based on key workflow events
    let autoStatus = null;
    if (activity_type === 'demo_scheduled') autoStatus = 'Demo Scheduled';
    else if (activity_type === 'converted') autoStatus = 'Converted';
    else if (activity_type === 'lost') autoStatus = 'Lost';

    if (autoStatus && lead.status !== autoStatus) {
      dbRun("UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [autoStatus, leadId]);
      dbRun(`
        INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
        VALUES (?, 'status_change', ?, ?)
      `, [
        leadId,
        `Status auto-updated from '${lead.status}' to '${autoStatus}' via logged event '${activity_type.replace('_', ' ')}'.`,
        username
      ]);
    }

    // Log the custom activity
    dbRun(`
      INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
      VALUES (?, ?, ?, ?)
    `, [
      leadId,
      activity_type,
      activity_notes || '',
      username
    ]);

    res.json({
      success: true,
      message: "Activity logged successfully",
      statusUpdated: autoStatus || false
    });

  } catch (err) {
    console.error('[POST ACTIVITY ERROR]', err);
    res.status(500).json({ error: "Failed to log activity details" });
  }
});

// POST /api/leads/bulk-status - Bulk status update for list actions
app.post('/api/leads/bulk-status', leadsAuth, (req, res) => {
  const { ids, status } = req.body;
  const username = req.session.username || 'System';

  if (!ids || !Array.isArray(ids) || ids.length === 0 || !status) {
    return res.status(400).json({ error: "Invalid parameters. 'ids' (array) and 'status' (string) are required." });
  }

  const validStatuses = ['New', 'Contacted', 'Qualified', 'Demo Scheduled', 'Converted', 'Lost'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status value. Must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const placeholders = ids.map(() => '?').join(',');
    const oldLeads = dbAll(`SELECT id, status FROM leads WHERE id IN (${placeholders})`, ids);
    
    dbRun(`UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`, [status, ...ids]);

    for (const item of oldLeads) {
      if (item.status !== status) {
        dbRun(`
          INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
          VALUES (?, 'status_change', ?, ?)
        `, [
          item.id,
          `Status changed from '${item.status || 'New'}' to '${status}' via bulk update.`,
          username
        ]);
      }
    }

    res.json({
      success: true,
      message: `Successfully updated status of ${ids.length} leads to '${status}'`
    });

  } catch (err) {
    console.error('[BULK STATUS UPDATE ERROR]', err);
    res.status(500).json({ error: "Failed to perform bulk status update" });
  }
});

// DELETE /api/leads/:id - Delete Lead (Admin/Manager only)
app.delete('/api/leads/:id', leadsAuth, (req, res) => {
  const leadId = req.params.id;
  const role = req.session.role;

  if (role !== 'admin' && role !== 'manager') {
    return res.status(403).json({ error: "Access denied. Only Admins and Sales Managers can delete leads." });
  }

  try {
    const lead = dbGet("SELECT id FROM leads WHERE id = ?", [leadId]);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    dbRun("DELETE FROM leads WHERE id = ?", [leadId]);
    res.json({ success: true, message: "Lead permanently deleted." });

  } catch (err) {
    console.error('[DELETE LEAD ERROR]', err);
    res.status(500).json({ error: "Failed to delete lead" });
  }
});

// ─── API Gateway Ingestion Middleware ───
async function apiGatewayAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const apiSecret = req.headers['x-api-secret'] || req.query.api_secret;

  if (!apiKey || !apiSecret) {
    return res.status(401).json({ error: "Unauthorized. Missing 'X-API-Key' or 'X-API-Secret' credentials." });
  }

  try {
    const keyRecord = dbGet("SELECT * FROM lead_api_keys WHERE api_key = ? AND active = 1", [apiKey]);
    if (!keyRecord) {
      return res.status(401).json({ error: "Unauthorized. Invalid or inactive API key." });
    }

    if (keyRecord.api_secret !== apiSecret) {
      return res.status(401).json({ error: "Unauthorized. Invalid API secret credentials." });
    }

    // Record last used timestamp
    dbRun("UPDATE lead_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?", [keyRecord.id]);
    
    req.apiKeyRecord = keyRecord;
    next();
  } catch (err) {
    console.error('[API AUTH ERROR]', err);
    res.status(500).json({ error: "Authentication system failure." });
  }
}

// POST /api/leads/ingest - Unified Ingestion Endpoint for external tools (Zapier, Make, custom scripts, Facebook/Instagram webhooks)
app.post('/api/leads/ingest', apiGatewayAuth, async (req, res) => {
  const {
    source, external_lead_id, campaign_name, ad_set_name,
    lead_name, email, phone, store_name, city, state, pos_system,
    notes, status
  } = req.body;

  if (!source || !lead_name) {
    return res.status(400).json({ error: "Missing required fields: 'source' and 'lead_name' are mandatory." });
  }

  try {
    // 1. Verify lead source is registered and active
    const sourceRecord = dbGet("SELECT * FROM lead_sources WHERE source_name = ? AND active = 1", [source]);
    if (!sourceRecord) {
      return res.status(400).json({ error: `Lead source '${source}' is either not registered or inactive in CRM settings.` });
    }

    // 2. Duplicate Detection
    let existingLead = null;
    if (external_lead_id) {
      existingLead = dbGet("SELECT * FROM leads WHERE external_lead_id = ?", [external_lead_id]);
    }
    
    const normPhone = normalizePhone(phone);
    if (!existingLead && normPhone) {
      existingLead = dbGet("SELECT * FROM leads WHERE normalized_phone = ?", [normPhone]);
    }
    if (!existingLead && email) {
      existingLead = dbGet("SELECT * FROM leads WHERE email = ?", [email.trim().toLowerCase()]);
    }

    if (existingLead) {
      // Log duplicate attempt as activity
      dbRun(`
        INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
        VALUES (?, 'duplicate_submission', ?, ?)
      `, [
        existingLead.id,
        `Duplicate lead ingestion attempt. Source: '${source}'. Campaign: '${campaign_name || 'N/A'}'. Details merged into notes.`,
        `API Key: ${req.apiKeyRecord.key_name}`
      ]);

      // Merge notes if new notes provided
      if (notes) {
        const mergedNotes = `${existingLead.notes || ''}\n[Merged Note from duplicate submission]: ${notes}`.trim();
        dbRun("UPDATE leads SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [mergedNotes, existingLead.id]);
      }

      return res.status(200).json({
        success: true,
        message: "Duplicate lead detected. Submission merged.",
        duplicate: true,
        leadId: existingLead.id
      });
    }

    // 3. Auto-Assignment Rules
    let assignedTo = null;
    const assignmentModeRecord = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'lead_assignment_mode'");
    const assignmentMode = assignmentModeRecord ? assignmentModeRecord.setting_value : 'round_robin';

    if (assignmentMode === 'single_user') {
      const targetUserRecord = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'lead_assignment_user'");
      if (targetUserRecord && targetUserRecord.setting_value) {
        assignedTo = parseInt(targetUserRecord.setting_value) || null;
      }
    } else if (assignmentMode === 'round_robin') {
      // Get active sales agents
      const salesAgents = dbAll("SELECT id, email, username, first_name, last_name FROM users WHERE role IN ('admin', 'manager', 'employee') AND is_active = 1 ORDER BY id ASC");
      if (salesAgents.length > 0) {
        const indexRecord = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'lead_assignment_round_robin_index'");
        let index = indexRecord ? parseInt(indexRecord.setting_value) || 0 : 0;
        index = index % salesAgents.length;

        const selectedAgent = salesAgents[index];
        assignedTo = selectedAgent.id;

        // Save incremented index
        const nextIndex = (index + 1) % salesAgents.length;
        dbRun("UPDATE crm_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = 'lead_assignment_round_robin_index'", [nextIndex.toString()]);
      }
    }

    // 4. Save New Lead
    const initialStatus = status || 'New';
    const leadId = dbRun(`
      INSERT INTO leads (source, external_lead_id, campaign_name, ad_set_name, lead_name, email, phone, normalized_phone, store_name, city, state, pos_system, status, assigned_to, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      source,
      external_lead_id || null,
      campaign_name || null,
      ad_set_name || null,
      lead_name,
      email || null,
      phone || null,
      normPhone || null,
      store_name || null,
      city || null,
      state || null,
      pos_system || null,
      initialStatus,
      assignedTo,
      notes || null
    ]);

    // Insert initialization log
    dbRun(`
      INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
      VALUES (?, 'system_created', ?, ?)
    `, [
      leadId,
      `Lead automatically ingested via integration framework. Source: '${source}'. API Key: '${req.apiKeyRecord.key_name}'.`,
      'System/API'
    ]);

    // Log assignment activity
    let assignedUserRecord = null;
    if (assignedTo) {
      assignedUserRecord = dbGet("SELECT email, username, first_name, last_name FROM users WHERE id = ?", [assignedTo]);
      const nameStr = assignedUserRecord ? `${assignedUserRecord.first_name || ''} ${assignedUserRecord.last_name || ''}`.trim() || assignedUserRecord.username : `User #${assignedTo}`;
      dbRun(`
        INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
        VALUES (?, 'assigned', ?, ?)
      `, [
        leadId,
        `Lead automatically assigned to ${nameStr} (assignment mode: ${assignmentMode}).`,
        'System/API'
      ]);
    }

    // 5. Trigger Notifications
    const leadDetails = dbGet("SELECT * FROM leads WHERE id = ?", [leadId]);
    if (leadDetails) {
      leadDetails.assigned_name = assignedUserRecord 
        ? `${assignedUserRecord.first_name || ''} ${assignedUserRecord.last_name || ''}`.trim() || assignedUserRecord.username 
        : 'Unassigned';

      // Read manager notification emails
      const notifyRecord = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'lead_notification_emails'");
      const managerEmails = notifyRecord && notifyRecord.setting_value 
        ? notifyRecord.setting_value.split(',').map(e => e.trim()).filter(e => e)
        : [];

      const assigneeEmail = assignedUserRecord ? assignedUserRecord.email : null;

      // Send mailer alert
      mailer.sendLeadNotificationEmail(leadDetails, assigneeEmail, managerEmails).catch(e => {
        console.error('[INGEST NOTIFICATION ERROR]', e);
      });
    }

    res.status(201).json({
      success: true,
      message: "Lead ingested successfully.",
      leadId
    });

  } catch (err) {
    console.error('[INGEST ERROR]', err);
    res.status(500).json({ error: "Ingestion failed due to internal error." });
  }
});

// GET /api/admin/lead-api-keys - List API Keys
app.get('/api/admin/lead-api-keys', leadsAuth, (req, res) => {
  try {
    const keys = dbAll("SELECT id, key_name, api_key, active, created_by, created_at, last_used_at FROM lead_api_keys ORDER BY created_at DESC");
    res.json({ success: true, keys });
  } catch (e) {
    console.error('[GET KEYS ERROR]', e);
    res.status(500).json({ error: "Failed to fetch API keys" });
  }
});

// POST /api/admin/lead-api-keys - Create a new API Key/Secret pair
app.post('/api/admin/lead-api-keys', leadsAuth, (req, res) => {
  const { key_name } = req.body;
  if (!key_name) {
    return res.status(400).json({ error: "Key name is required." });
  }

  const username = req.session.username || 'Admin';

  try {
    const apiKey = 'lai_key_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const apiSecret = 'lai_sec_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    dbRun(`
      INSERT INTO lead_api_keys (key_name, api_key, api_secret, active, created_by)
      VALUES (?, ?, ?, 1, ?)
    `, [key_name, apiKey, apiSecret, username]);

    res.status(201).json({
      success: true,
      message: "API Key pair generated successfully. Copy the secret now, it cannot be recovered.",
      key: {
        key_name,
        api_key: apiKey,
        api_secret: apiSecret
      }
    });
  } catch (e) {
    console.error('[CREATE KEY ERROR]', e);
    res.status(500).json({ error: "Failed to generate API key" });
  }
});

// POST /api/admin/lead-api-keys/:id/toggle - Toggle API key active state
app.post('/api/admin/lead-api-keys/:id/toggle', leadsAuth, (req, res) => {
  const keyId = req.params.id;
  try {
    const key = dbGet("SELECT active FROM lead_api_keys WHERE id = ?", [keyId]);
    if (!key) return res.status(404).json({ error: "API Key not found" });

    const newActive = key.active === 1 ? 0 : 1;
    dbRun("UPDATE lead_api_keys SET active = ? WHERE id = ?", [newActive, keyId]);
    res.json({ success: true, active: newActive });
  } catch (e) {
    console.error('[TOGGLE KEY ERROR]', e);
    res.status(500).json({ error: "Failed to toggle key status" });
  }
});

// DELETE /api/admin/lead-api-keys/:id - Permanent delete API Key
app.delete('/api/admin/lead-api-keys/:id', leadsAuth, (req, res) => {
  const keyId = req.params.id;
  const role = req.session.role;
  if (role !== 'admin') {
    return res.status(403).json({ error: "Access denied. Only Admins can delete credentials." });
  }
  try {
    dbRun("DELETE FROM lead_api_keys WHERE id = ?", [keyId]);
    res.json({ success: true, message: "API key deleted permanently." });
  } catch (e) {
    console.error('[DELETE KEY ERROR]', e);
    res.status(500).json({ error: "Failed to delete API key" });
  }
});

// GET /api/admin/crm-settings - Get settings
app.get('/api/admin/crm-settings', leadsAuth, (req, res) => {
  try {
    const settingsList = dbAll("SELECT setting_key, setting_value FROM crm_settings");
    const settingsObj = {};
    settingsList.forEach(s => {
      settingsObj[s.setting_key] = s.setting_value;
    });
    res.json({ success: true, settings: settingsObj });
  } catch (e) {
    console.error('[GET SETTINGS ERROR]', e);
    res.status(500).json({ error: "Failed to fetch CRM settings" });
  }
});

// POST /api/admin/crm-settings - Update settings keys
app.post('/api/admin/crm-settings', leadsAuth, (req, res) => {
  const updates = req.body;
  try {
    Object.keys(updates).forEach(key => {
      dbRun(`
        INSERT OR REPLACE INTO crm_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `, [key, updates[key]]);
    });
    res.json({ success: true, message: "CRM Settings updated successfully." });
  } catch (e) {
    console.error('[POST SETTINGS ERROR]', e);
    res.status(500).json({ error: "Failed to update CRM settings" });
  }
});

// GET /api/admin/lead-sources - Get ALL lead sources (including inactive ones)
app.get('/api/admin/lead-sources', leadsAuth, (req, res) => {
  try {
    const sources = dbAll("SELECT * FROM lead_sources ORDER BY source_name ASC");
    res.json({ success: true, sources });
  } catch (e) {
    console.error('[GET SOURCES ERROR]', e);
    res.status(500).json({ error: "Failed to fetch all lead sources" });
  }
});

// POST /api/admin/lead-sources - Add new lead source
app.post('/api/admin/lead-sources', leadsAuth, (req, res) => {
  const { source_name, source_type } = req.body;
  if (!source_name || !source_type) {
    return res.status(400).json({ error: "Missing required fields: 'source_name' and 'source_type'." });
  }
  try {
    dbRun("INSERT INTO lead_sources (source_name, source_type, active) VALUES (?, ?, 1)", [source_name, source_type]);
    res.status(201).json({ success: true, message: "Lead source created successfully." });
  } catch (e) {
    console.error('[CREATE SOURCE ERROR]', e);
    res.status(500).json({ error: "Failed to create lead source" });
  }
});

// POST /api/admin/lead-sources/:id/toggle - Toggle source active status
app.post('/api/admin/lead-sources/:id/toggle', leadsAuth, (req, res) => {
  const srcId = req.params.id;
  try {
    const src = dbGet("SELECT active FROM lead_sources WHERE id = ?", [srcId]);
    if (!src) return res.status(404).json({ error: "Lead source not found" });

    const newActive = src.active === 1 ? 0 : 1;
    dbRun("UPDATE lead_sources SET active = ? WHERE id = ?", [newActive, srcId]);
    res.json({ success: true, active: newActive });
  } catch (e) {
    console.error('[TOGGLE SOURCE ERROR]', e);
    res.status(500).json({ error: "Failed to toggle lead source state" });
  }
});

// DELETE /api/admin/lead-sources/:id - Delete lead source
app.delete('/api/admin/lead-sources/:id', leadsAuth, (req, res) => {
  const srcId = req.params.id;
  const role = req.session.role;
  if (role !== 'admin') {
    return res.status(403).json({ error: "Access denied. Only Admins can delete lead sources." });
  }
  try {
    dbRun("DELETE FROM lead_sources WHERE id = ?", [srcId]);
    res.json({ success: true, message: "Lead source deleted successfully." });
  } catch (e) {
    console.error('[DELETE SOURCE ERROR]', e);
    res.status(500).json({ error: "Failed to delete lead source" });
  }
});

// ─── Meta (Facebook/Instagram) Lead Ads Integration Endpoints ────────────────

// GET /api/integrations/meta/webhook - Meta Webhook Verification
app.get('/api/integrations/meta/webhook', (req, res) => {
  try {
    const verifyTokenSetting = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_verify_token'");
    const expectedVerifyToken = verifyTokenSetting ? verifyTokenSetting.setting_value : "lai_meta_verify_token_2026";
    
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode && token) {
      if (mode === 'subscribe' && token === expectedVerifyToken) {
        console.log('[META WEBHOOK] Verification successful.');
        return res.status(200).send(challenge);
      } else {
        console.warn('[META WEBHOOK] Verification failed. Tokens do not match.');
        return res.sendStatus(403);
      }
    }
    return res.sendStatus(400);
  } catch (e) {
    console.error('[META VERIFY ERROR]', e);
    res.sendStatus(500);
  }
});

// POST /api/integrations/meta/webhook - Ingest incoming Meta Leadgen Event
app.post('/api/integrations/meta/webhook', async (req, res) => {
  const payloadStr = JSON.stringify(req.body);
  console.log('[META WEBHOOK] Received payload:', payloadStr);

  try {
    const crypto = require('crypto');
    
    // Signature Verification (HMAC-SHA256)
    const appSecretSetting = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_app_secret'");
    const appSecret = appSecretSetting ? appSecretSetting.setting_value : "";
    const isSimulated = req.headers['x-meta-simulation'] === 'true';
    if (appSecret && !isSimulated) {
      const signature = req.headers['x-hub-signature-256'];
      if (!signature) {
        console.warn('[META WEBHOOK] Missing x-hub-signature-256 header.');
        dbRun("INSERT INTO meta_sync_logs (status, error_message, payload) VALUES (?, ?, ?)", 
          ['failed', 'Missing signature header (x-hub-signature-256)', payloadStr]);
        return res.status(401).json({ error: "Missing signature verification header." });
      }
      
      const parts = signature.split('=');
      if (parts.length !== 2) {
        dbRun("INSERT INTO meta_sync_logs (status, error_message, payload) VALUES (?, ?, ?)", 
          ['failed', 'Invalid signature header format', payloadStr]);
        return res.status(401).json({ error: "Invalid signature format." });
      }
      
      const expectedSignature = crypto
        .createHmac('sha256', appSecret)
        .update(req.rawBody || payloadStr)
        .digest('hex');
        
      const bufferA = crypto.createHash('sha256').update(parts[1] || '').digest();
      const bufferB = crypto.createHash('sha256').update(expectedSignature || '').digest();
      const isMatch = crypto.timingSafeEqual(bufferA, bufferB);
      if (!isMatch) {
        console.warn('[META WEBHOOK] Signature verification mismatch.');
        dbRun("INSERT INTO meta_sync_logs (status, error_message, payload) VALUES (?, ?, ?)", 
          ['failed', 'Signature signature-256 mismatch', payloadStr]);
        return res.status(401).json({ error: "Signature verification failed." });
      }
    }

    const { object, entry } = req.body;
    if (object !== 'page' || !entry || !Array.isArray(entry)) {
      return res.status(200).json({ success: true, message: "Non-page object ignored." });
    }

    for (const ent of entry) {
      const changes = ent.changes;
      if (!changes || !Array.isArray(changes)) continue;

      for (const change of changes) {
        if (change.field !== 'leadgen') continue;

        const val = change.value;
        if (!val || !val.leadgen_id) continue;

        const leadgenId = val.leadgen_id;
        const formId = val.form_id;
        const pageId = val.page_id;

        // Duplicate Check (via external_lead_id)
        const processedLead = dbGet("SELECT id FROM leads WHERE external_lead_id = ?", [leadgenId]);
        if (processedLead) {
          console.log(`[META WEBHOOK] Lead ${leadgenId} has already been processed.`);
          dbRun("INSERT INTO meta_sync_logs (lead_id, facebook_lead_id, status, error_message, payload) VALUES (?, ?, ?, ?, ?)",
            [processedLead.id, leadgenId, 'duplicate', 'Lead already exists. Submission ignored.', payloadStr]);
          continue;
        }

        // Fetch lead details using Meta Graph API if access token is available
        const tokenSetting = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_access_token'");
        const accessToken = tokenSetting ? tokenSetting.setting_value : "";

        let leadData = null;
        let fetchError = null;

        if (accessToken) {
          try {
            console.log(`[META WEBHOOK] Requesting details for leadgen_id: ${leadgenId}`);
            const graphRes = await fetch(`https://graph.facebook.com/v20.0/${leadgenId}?access_token=${accessToken}`);
            if (graphRes.ok) {
              leadData = await graphRes.json();
            } else {
              const errJson = await graphRes.json().catch(() => ({}));
              fetchError = errJson.error?.message || `HTTP ${graphRes.status}`;
            }
          } catch (fetchErr) {
            fetchError = fetchErr.message;
          }
        } else {
          fetchError = "No Meta Access Token configured in CRM settings.";
        }

        let leadName = 'Meta Lead';
        let email = '';
        let phone = '';
        let storeName = '';
        let city = '';
        let campaignName = val.campaign_name || 'Meta Ad Campaign';
        let adSetName = val.adgroup_name || 'Meta Ad Set';
        let platformSource = 'Facebook Lead Ads';

        if (val.platform === 'ig' || (val.ad_id && val.platform === 'instagram')) {
          platformSource = 'Instagram Lead Ads';
        }

        // Apply Custom Mappings if lead values are retrieved from Graph API
        if (leadData && leadData.field_data) {
          const mappingsSetting = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_lead_mappings'");
          const mappings = JSON.parse(mappingsSetting ? mappingsSetting.setting_value : "{}");

          leadData.field_data.forEach(field => {
            const name = field.name;
            const value = field.values ? field.values[0] : "";
            const targetCrmField = mappings[name];

            if (targetCrmField === 'lead_name') leadName = value;
            else if (targetCrmField === 'email') email = value;
            else if (targetCrmField === 'phone') phone = value;
            else if (targetCrmField === 'store_name') storeName = value;
            else if (targetCrmField === 'city') city = value;
            else {
              // Direct matching fallback
              if (name === 'full_name' || name === 'name') leadName = value;
              else if (name === 'email') email = value;
              else if (name === 'phone' || name === 'phone_number') phone = value;
              else if (name === 'store_name') storeName = value;
              else if (name === 'city') city = value;
            }
          });

          if (leadData.campaign_name) campaignName = leadData.campaign_name;
          if (leadData.adset_name) adSetName = leadData.adset_name;
          if (leadData.platform === 'instagram') platformSource = 'Instagram Lead Ads';
        }

        // Support Simulation Tests
        if (fetchError && req.headers['x-meta-simulation'] === 'true') {
          console.log('[META WEBHOOK] Local test simulation mode.');
          leadName = req.body.simulated_lead_name || 'Simulated Jane Doe';
          email = req.body.simulated_email || 'simulated.jane@example.com';
          phone = req.body.simulated_phone || '202-555-0199';
          storeName = req.body.simulated_store_name || 'Simulated Store';
          city = req.body.simulated_city || 'Atlanta';
          campaignName = req.body.simulated_campaign_name || 'Simulated Campaign';
          adSetName = req.body.simulated_adset_name || 'Simulated Ad Set';
          platformSource = req.body.simulated_platform || 'Facebook Lead Ads';
          fetchError = null; // Clear error to allow insertion
        }

        if (fetchError) {
          console.warn('[META WEBHOOK] Lead ingest skipped due to fetch error:', fetchError);
          dbRun("INSERT INTO meta_sync_logs (facebook_lead_id, status, error_message, payload) VALUES (?, ?, ?, ?)",
            [leadgenId, 'failed', fetchError, payloadStr]);
          continue;
        }

        const normPhone = normalizePhone(phone);

        // Core Duplicate matching: normalized phone number or email match
        let existingLead = null;
        if (normPhone) {
          existingLead = dbGet("SELECT * FROM leads WHERE normalized_phone = ?", [normPhone]);
        }
        if (!existingLead && email) {
          existingLead = dbGet("SELECT * FROM leads WHERE email = ?", [email.trim().toLowerCase()]);
        }

        let savedLeadId = null;

        if (existingLead) {
          savedLeadId = existingLead.id;
          
          dbRun(`
            UPDATE leads 
            SET notes = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
          `, [
            `${existingLead.notes || ''}\n[Meta Lead Update] Ingested again from ${platformSource} under Campaign '${campaignName}'.`,
            savedLeadId
          ]);

          dbRun(`
            INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
            VALUES (?, 'duplicate_merged', ?, 'System')
          `, [
            savedLeadId,
            `Duplicate lead detected from ${platformSource} (${email || phone}). Lead merged and updated. Campaign: '${campaignName}'.`
          ]);

          dbRun("INSERT INTO meta_sync_logs (lead_id, facebook_lead_id, status, payload) VALUES (?, ?, ?, ?)",
            [savedLeadId, leadgenId, 'success', payloadStr]);
          
          console.log(`[META WEBHOOK] Lead duplicate matched and merged into Lead ID ${savedLeadId}.`);
        } else {
          // Assignment mode checks
          const assignmentModeSetting = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'lead_assignment_mode'") || { setting_value: 'round_robin' };
          const modeVal = assignmentModeSetting.setting_value;

          let assignedTo = null;
          const activeUsers = dbAll("SELECT id, username, email FROM users WHERE role IN ('admin', 'manager', 'employee') AND is_active = 1 ORDER BY id ASC");

          if (modeVal === 'single' && activeUsers.length > 0) {
            const singleUserSetting = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'lead_assignment_user'");
            const singleUserId = parseInt(singleUserSetting?.setting_value);
            const userExists = activeUsers.find(u => u.id === singleUserId);
            if (userExists) {
              assignedTo = singleUserId;
            } else {
              assignedTo = activeUsers[0].id;
            }
          } else if (modeVal === 'round_robin' && activeUsers.length > 0) {
            const rrIndexSetting = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'lead_assignment_round_robin_index'") || { setting_value: '0' };
            let rrIdx = parseInt(rrIndexSetting.setting_value) || 0;
            if (rrIdx >= activeUsers.length) rrIdx = 0;

            assignedTo = activeUsers[rrIdx].id;

            const nextIdx = (rrIdx + 1) % activeUsers.length;
            dbRun("UPDATE crm_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = 'lead_assignment_round_robin_index'", [String(nextIdx)]);
          }

          savedLeadId = dbRun(`
            INSERT INTO leads (source, external_lead_id, campaign_name, ad_set_name, lead_name, email, phone, normalized_phone, store_name, city, status, assigned_to, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New', ?, ?)
          `, [
            platformSource,
            leadgenId,
            campaignName,
            adSetName,
            leadName,
            email || null,
            phone || null,
            normPhone || null,
            storeName || null,
            city || null,
            assignedTo,
            `Ingested via Meta Lead Ads integration. Form ID: ${formId}.`
          ]);

          dbRun(`
            INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
            VALUES (?, 'system_created', ?, 'System')
          `, [
            savedLeadId,
            `Lead automatically ingested via Meta Lead Ads framework. Platform: ${platformSource}. Campaign: '${campaignName}'.`
          ]);

          if (assignedTo) {
            const assignedUser = activeUsers.find(u => u.id === assignedTo);
            dbRun(`
              INSERT INTO lead_activities (lead_id, activity_type, activity_notes, created_by)
              VALUES (?, 'assigned', ?, 'System')
            `, [
              savedLeadId,
              `Lead automatically routed to sales representative: ${assignedUser.username} (${assignedUser.email}).`
            ]);

            // Dispatch notification email
            try {
              const leadObj = {
                source: platformSource,
                lead_name: leadName,
                email: email,
                phone: phone,
                store_name: storeName,
                city: city,
                notes: `Form ID: ${formId}`
              };
              mailer.sendLeadNotificationEmail(leadObj, assignedUser.email).catch(mailErr => {
                console.error("[META WEBHOOK] Mail dispatch warning:", mailErr.message);
              });
            } catch (mailEx) {
              console.error("[META WEBHOOK] Mail exception:", mailEx);
            }
          }

          dbRun("UPDATE crm_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = 'meta_last_sync_timestamp'", [new Date().toISOString()]);

          dbRun("INSERT INTO meta_sync_logs (lead_id, facebook_lead_id, status, payload) VALUES (?, ?, ?, ?)",
            [savedLeadId, leadgenId, 'success', payloadStr]);
          
          console.log(`[META WEBHOOK] Lead ${leadgenId} ingested successfully. Lead ID: ${savedLeadId}`);
        }
      }
    }

    res.status(200).json({ success: true, message: "Webhook processed successfully." });
  } catch (err) {
    console.error('[META WEBHOOK PROCESSING ERROR]', err);
    dbRun("INSERT INTO meta_sync_logs (status, error_message, payload) VALUES (?, ?, ?)",
      ['failed', err.message, payloadStr]);
    res.status(500).json({ error: "Internal processing failure." });
  }
});

// GET /api/admin/meta/config - Retrieve Meta Integration Config
app.get('/api/admin/meta/config', leadsAuth, (req, res) => {
  try {
    const pageId = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_page_id'")?.setting_value || "";
    const formId = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_form_id'")?.setting_value || "";
    const accessToken = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_access_token'")?.setting_value || "";
    const appSecret = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_app_secret'")?.setting_value || "";
    const verifyToken = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_verify_token'")?.setting_value || "lai_meta_verify_token_2026";
    const connStatus = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_connection_status'")?.setting_value || "Disconnected";
    const lastSync = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_last_sync_timestamp'")?.setting_value || "";
    const mappings = dbGet("SELECT setting_value FROM crm_settings WHERE setting_key = 'meta_lead_mappings'")?.setting_value || "{}";

    res.json({
      success: true,
      config: {
        page_id: pageId,
        form_id: formId,
        access_token: accessToken ? `${accessToken.substring(0, 10)}...${accessToken.slice(-8)}` : "",
        app_secret: appSecret ? `${appSecret.substring(0, 4)}...${appSecret.slice(-4)}` : "",
        verify_token: verifyToken,
        connection_status: connStatus,
        last_sync_timestamp: lastSync,
        mappings: JSON.parse(mappings)
      }
    });
  } catch (err) {
    console.error('[GET META CONFIG ERROR]', err);
    res.status(500).json({ error: "Failed to load Meta configuration settings." });
  }
});

// POST /api/admin/meta/config - Update Meta Integration Config
app.post('/api/admin/meta/config', leadsAuth, (req, res) => {
  const { page_id, form_id, access_token, app_secret, mappings, connection_status } = req.body;
  try {
    if (page_id !== undefined) dbRun("UPDATE crm_settings SET setting_value = ? WHERE setting_key = 'meta_page_id'", [page_id]);
    if (form_id !== undefined) dbRun("UPDATE crm_settings SET setting_value = ? WHERE setting_key = 'meta_form_id'", [form_id]);
    
    if (access_token !== undefined && !access_token.includes('...')) {
      dbRun("UPDATE crm_settings SET setting_value = ? WHERE setting_key = 'meta_access_token'", [access_token]);
    }
    if (app_secret !== undefined && !app_secret.includes('...')) {
      dbRun("UPDATE crm_settings SET setting_value = ? WHERE setting_key = 'meta_app_secret'", [app_secret]);
    }
    if (connection_status !== undefined) {
      dbRun("UPDATE crm_settings SET setting_value = ? WHERE setting_key = 'meta_connection_status'", [connection_status]);
    }
    if (mappings !== undefined) {
      dbRun("UPDATE crm_settings SET setting_value = ? WHERE setting_key = 'meta_lead_mappings'", [JSON.stringify(mappings)]);
    }

    res.json({ success: true, message: "Meta Lead Ads Integration settings updated successfully." });
  } catch (err) {
    console.error('[POST META CONFIG ERROR]', err);
    res.status(500).json({ error: "Failed to save Meta configuration settings." });
  }
});

// GET /api/admin/meta/logs - Retrieve recent Meta sync/webhook logs
app.get('/api/admin/meta/logs', leadsAuth, (req, res) => {
  try {
    const logs = dbAll(`
      SELECT l.*, ld.lead_name, ld.email as lead_email 
      FROM meta_sync_logs l
      LEFT JOIN leads ld ON l.lead_id = ld.id
      ORDER BY l.created_at DESC
      LIMIT 100
    `);
    res.json({ success: true, logs });
  } catch (err) {
    console.error('[GET META LOGS ERROR]', err);
    res.status(500).json({ error: "Failed to fetch sync log history." });
  }
});

// GET /api/admin/meta/dashboard - Retrieve sync metrics & breakdown
app.get('/api/admin/meta/dashboard', leadsAuth, (req, res) => {
  try {
    const totalImported = (dbGet("SELECT COUNT(*) as c FROM leads WHERE source IN ('Facebook Lead Ads', 'Instagram Lead Ads')") || {}).c || 0;
    const failedImports = (dbGet("SELECT COUNT(*) as c FROM meta_sync_logs WHERE status = 'failed'") || {}).c || 0;
    const dupPrevented = (dbGet("SELECT COUNT(*) as c FROM meta_sync_logs WHERE status = 'duplicate'") || {}).c || 0;
    const lastSuccessRow = dbGet("SELECT created_at FROM meta_sync_logs WHERE status = 'success' ORDER BY created_at DESC LIMIT 1");
    const lastSync = lastSuccessRow ? lastSuccessRow.created_at : "Never";

    const fbCount = (dbGet("SELECT COUNT(*) as c FROM leads WHERE source = 'Facebook Lead Ads'") || {}).c || 0;
    const igCount = (dbGet("SELECT COUNT(*) as c FROM leads WHERE source = 'Instagram Lead Ads'") || {}).c || 0;

    res.json({
      success: true,
      metrics: {
        total_imported: totalImported,
        failed_imports: failedImports,
        duplicates_prevented: dupPrevented,
        last_successful_sync: lastSync,
        breakdown: {
          facebook: fbCount,
          instagram: igCount
        }
      }
    });
  } catch (err) {
    console.error('[GET META DASHBOARD ERROR]', err);
    res.status(500).json({ error: "Failed to fetch sync dashboard statistics." });
  }
});

// Catch-all → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND, 'index.html'));
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
initLocalDb().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log(`║  🚀  RTN LAI 5  –  Local Dev Server                  ║`);
    console.log(`║  Frontend:   http://localhost:${PORT}                   ║`);
    console.log(`║  Admin Panel: http://localhost:${PORT}/admin-login.html ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    // Trigger MS SQL connection and synchronization in the background!
    connectAndSyncMssql().catch(err => {
      console.error('⚠️ MS SQL connection/sync failed in background:', err);
    });
  });
}).catch(err => {
  console.error('💥 Failed to init local DB:', err);
  process.exit(1);
});
