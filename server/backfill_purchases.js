const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'lai5.db');

function calculateRegAmount(body) {
  let softwareTotal = 0;
  const plan_val = body.plan;
  const prod_val = body.product;
  
  if (plan_val && plan_val !== 'Trial' && !plan_val.includes('Trial')) {
    if (prod_val === 'LAI V') {
      softwareTotal = (plan_val === 'Monthly') ? 39.99 : 299.99;
    } else if (prod_val === 'RTN Display' || prod_val === 'Display') {
      softwareTotal = (plan_val === 'Monthly') ? 39.99 : 399.99;
    } else if (prod_val && prod_val.includes('Display') && prod_val.includes('LAI')) {
      softwareTotal = (plan_val === 'Monthly') ? 59.99 : 599.99;
    } else {
      // Fallback
      softwareTotal = (plan_val === 'Monthly') ? 39.99 : 299.99;
    }
    
    if (plan_val === '2 Years') softwareTotal *= 2;
    else if (plan_val === '3 Years') softwareTotal *= 3;
  }
  
  let scannerTotal = 0;
  if (body.scanner && body.scanner !== 'Not-Needed') {
    if (body.scanner === 'WiFi & Display Scanner') {
      scannerTotal = 159.56;
    } else {
      scannerTotal = 79.78; 
    }
  }
  
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
  
  const grandTotal = softwareTotal + scannerTotal + shippingTotal;
  return parseFloat(grandTotal.toFixed(2));
}

initSqlJs().then(SQL => {
    const fileBuffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(fileBuffer);
    
    // Clear existing to avoid duplication
    db.run("DELETE FROM purchase_history");
    
    const stmt = db.prepare("SELECT id, product, plan, scanner, submitted_at FROM registrations");
    const records = [];
    while (stmt.step()) {
        records.push(stmt.getAsObject());
    }
    stmt.free();
    
    console.log(`Found ${records.length} registrations to process.`);
    
    let backfilledCount = 0;
    records.forEach(r => {
        const amount = calculateRegAmount(r);
        const details = `${r.product || 'LAI V'} (${r.plan || 'Trial'})`;
        const date = r.submitted_at || new Date().toISOString();
        
        db.run(`
            INSERT INTO purchase_history (registration_id, amount, details, invoice_date)
            VALUES (?, ?, ?, ?)
        `, [r.id, amount, details, date]);
        backfilledCount++;
    });
    
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    console.log(`Successfully backfilled ${backfilledCount} purchase history records!`);
}).catch(err => {
    console.error('Error during backfill:', err);
});
