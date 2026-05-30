// Using global fetch (Node 18+)

async function runTest() {
    console.log('🚀 Starting Full Flow Test (Mock Registration)...');
    
    const testData = {
        first_name: 'QA',
        last_name: 'Tester',
        email: 'qatest_' + Date.now() + '@gmail.com',
        username: 'qatest_' + Date.now(),
        password: 'Password123!',
        mobile: '1234567890',
        store_phone: '0987654321',
        address: '123 Innovation Way',
        city: 'Atlanta',
        state: 'GA',
        zipcode: '30303',
        store_name: 'QA Test Store',
        corporation: 'QA Corp LLC',
        product: 'LAI Pro (LAI V + RTN Display)',
        plan: 'Monthly',
        scanner: 'WiFi-Scanner',
        shipping: 'Standard',
        payment_mode: 'Card',
        card_no: '4242 4242 4242 4242', // This will trigger the BYPASS
        card_exp_month: '12',
        card_exp_year: '2028',
        card_cvv: '123'
    };

    try {
        const response = await fetch('http://localhost:3001/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        });

        const result = await response.json();
        
        if (response.ok) {
            console.log('✅ Registration Successful!');
            console.log('Result:', JSON.stringify(result, null, 2));
            console.log('\nCheck your inbox (yashdhattarwal@gmail.com) for the email and invoice PDF!');
        } else {
            console.error('❌ Registration Failed:', result.error);
        }
    } catch (err) {
        console.error('❌ Error during test:', err.message);
    }
}

runTest();
