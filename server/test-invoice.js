const pdfService = require('./services/pdfService');
const fs = require('fs');
const path = require('path');

/**
 * Mock data for QA Test Invoice
 */
const mockData = {
    first_name: 'John',
    last_name: 'Doe',
    email: 'john.doe@example.com',
    address: '123 Test Street',
    city: 'Atlanta',
    state: 'GA',
    zipcode: '30303',
    company: 'Doe Enterprises LLC',
    product: 'LAI Pro (LAI V + RTN Display)',
    plan: '1 Year',
    scanner: 'WiFi-Scanner',
    shop_id: 'RTN-99',
    invoiceNumber: 'RTN-QA-2025-001',
    softwareTotal: 599.99,
    scannerTotal: 59.99,
    shippingTotal: 14.99,
    taxTotal: 4.80,
    grandTotal: 679.77
};

async function runTest() {
    try {
        console.log('🚀 Generating QA Test Invoice...');
        const buffer = await pdfService.generateInvoice(mockData);
        
        const outputPath = path.join(__dirname, 'qa-test-invoice.pdf');
        fs.writeFileSync(outputPath, buffer);
        
        console.log(`✅ Success! Invoice saved to: ${outputPath}`);
    } catch (err) {
        console.error('❌ Error generating invoice:', err);
    }
}

runTest();
