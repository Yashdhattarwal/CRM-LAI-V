async function runFailureTest() {
    console.log('🚀 Triggering a deliberate failure (duplicate email)...');
    
    const testData = {
        first_name: 'Failure',
        last_name: 'Tester',
        email: 'yashdhattarwal@gmail.com', // This ALREADY exists in the DB from previous tests
        username: 'failtest',
        password: 'Password123!',
        mobile: '1234567890',
        address: '123 Failure St',
        city: 'Atlanta',
        state: 'GA',
        zipcode: '30303',
        product: 'LAI V',
        plan: 'Monthly',
        payment_mode: 'Card',
        card_no: '4242 4242 4242 4242'
    };

    try {
        const response = await fetch('http://localhost:3001/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        });

        const result = await response.json();
        
        if (!response.ok) {
            console.log('✅ Success: The registration failed as expected.');
            console.log('Reason:', result.error);
            console.log('\nCheck realtimenetworking1776@gmail.com for the failure alert!');
        } else {
            console.error('❌ Error: The registration unexpectedly succeeded.');
        }
    } catch (err) {
        console.error('❌ Error during test:', err.message);
    }
}

runFailureTest();
