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
app.use(express.json());
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
let db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
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

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('✅ Loaded existing database: lai5.db');
  } else {
    db = new SQL.Database();
    console.log('✅ Created new database: lai5.db');
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
                ['card_no', 'TEXT'], ['passcode', 'TEXT'], ['expiry_date', 'TEXT']
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

function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDb();
  return db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
}

// ─── Routes ───────────────────────────────────────────────────────────────────

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

    // TEST CARD BYPASS
    const isTestCard = (card_no || "").replace(/\s/g, '') === "4242424242424242";

    if (amount > 0 && !isTestCard) {
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
    } else if (isTestCard) {
      transaction_id = "TEST-TX-" + Date.now();
      console.log(`[VAULT BYPASS] Test card used. Skipping gateway charge.`);
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

    const valid = await bcrypt.compare(password, user.password_hash);
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
      card_no
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

    // Hash password
    const bcrypt = require('bcrypt');
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
        payment_mode || "Card",
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

    // Automate Purchase History Entry
    dbRun(`
        INSERT INTO purchase_history (registration_id, amount, details)
        VALUES (?, ?, ?)
    `, [registrationId, 0.00, `${product || 'LAI V'} (${plan || 'Trial'})`]);

    // Insert into State-Specific table if valid
    if (STATES.includes(stateCode)) {
        const insertStateSql = insertMasterSql.replace("registrations", `registrations_${stateCode}`);
        dbRun(insertStateSql, regParamsWithShopId);
        console.log(`[ADMIN ROUTING ✅] Added to registrations_${stateCode} with Shop ID ${shop_id}`);
    }

    console.log(`[ADMIN REGISTER ✅] ${username} <${email}> in ${stateCode} by admin/manager`);

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
           r.passcode,
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

// Catch-all → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND, 'index.html'));
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log(`║  🚀  RTN LAI 5  –  Local Dev Server                  ║`);
    console.log(`║  Frontend:   http://localhost:${PORT}                   ║`);
    console.log(`║  Admin Panel: http://localhost:${PORT}/admin-login.html ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
  });
}).catch(err => {
  console.error('💥 Failed to init DB:', err);
  process.exit(1);
});
