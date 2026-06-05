async function runTest() {
    console.log('🏁 Starting Integration Framework End-to-End Test (using API Endpoints)...');
    const baseUrl = 'http://localhost:3001';

    const testId = Date.now();
    const sourceName = `Test Source ${testId}`;
    const keyName = `Test Key ${testId}`;
    const leadEmail = `test.doe.${testId}@rtnlai.com`;
    const leadPhone = `202-555-${String(testId).slice(-4)}`;

    try {
        // 1. Login as Admin using /api/admin/login
        console.log('\n🔐 Step 1: Logging in as Admin via administrative route...');
        const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'Admin@RTN',
                password: 'RTN@LAI5'
            })
        });

        const loginResult = await loginRes.json();
        if (!loginRes.ok) {
            throw new Error(`Admin Login failed: ${loginResult.error}`);
        }
        console.log('✅ Admin Logged In Successfully!');

        // Extract session cookie
        const rawCookie = loginRes.headers.get('set-cookie');
        if (!rawCookie) {
            throw new Error('No session cookie returned from login!');
        }
        const sessionCookie = rawCookie.split(';')[0];
        console.log(`🔑 Session Cookie retrieved: ${sessionCookie.substring(0, 25)}...`);

        // 2. Register a new lead source
        console.log(`\n📥 Step 2: Registering new Lead Source '${sourceName}' via admin route...`);
        const sourceRes = await fetch(`${baseUrl}/api/admin/lead-sources`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': sessionCookie
            },
            body: JSON.stringify({
                source_name: sourceName,
                source_type: 'webhook'
            })
        });

        const sourceResult = await sourceRes.json();
        if (!sourceRes.ok) {
            throw new Error(`Failed to create lead source: ${sourceResult.error}`);
        }
        console.log('✅ Lead Source registered successfully.');

        // 3. Generate API Key
        console.log(`\n🔑 Step 3: Generating API Key pair '${keyName}' via admin route...`);
        const apiKeyRes = await fetch(`${baseUrl}/api/admin/lead-api-keys`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': sessionCookie
            },
            body: JSON.stringify({
                key_name: keyName
            })
        });

        const apiKeyResult = await apiKeyRes.json();
        if (!apiKeyRes.ok) {
            throw new Error(`Failed to generate API key: ${apiKeyResult.error}`);
        }
        const generatedKey = apiKeyResult.key;
        console.log('✅ API Credentials generated successfully:');
        console.log(`- API Key: ${generatedKey.api_key}`);
        console.log(`- API Secret: ${generatedKey.api_secret}`);

        // 4. Update CRM settings
        console.log('\n⚙️  Step 4: Updating CRM settings via admin route...');
        const settingsRes = await fetch(`${baseUrl}/api/admin/crm-settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': sessionCookie
            },
            body: JSON.stringify({
                lead_assignment_mode: 'round_robin',
                lead_notification_emails: 'notify-test@rtnlai.com'
            })
        });

        const settingsResult = await settingsRes.json();
        if (!settingsRes.ok) {
            throw new Error(`Failed to update CRM settings: ${settingsResult.error}`);
        }
        console.log('✅ CRM settings updated successfully.');

        // 5. Ingest lead using API Key & Secret
        const testLead = {
            source: sourceName,
            lead_name: 'Jane Ingested Doe',
            email: leadEmail,
            phone: leadPhone,
            store_name: 'Ingestion Test Shop',
            city: 'Austin',
            state: 'TX',
            pos_system: 'Clover',
            notes: 'This is a test lead ingested via API.'
        };

        console.log('\n🚀 Step 5: Submitting new lead via POST /api/leads/ingest...');
        const ingestRes = await fetch(`${baseUrl}/api/leads/ingest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': generatedKey.api_key,
                'x-api-secret': generatedKey.api_secret
            },
            body: JSON.stringify(testLead)
        });

        const ingestResult = await ingestRes.json();
        console.log(`Ingest Response Status: ${ingestRes.status}`);
        console.log('Ingest Result:', JSON.stringify(ingestResult, null, 2));

        if (ingestRes.status !== 201 || !ingestResult.success) {
            throw new Error('Lead Ingestion failed!');
        }
        const leadId = ingestResult.leadId;
        console.log(`✅ Ingested new lead successfully. ID: ${leadId}`);

        // 6. Test Duplicate Detection
        console.log('\n🚀 Step 6: Submitting duplicate lead (same email) to test duplicate detection...');
        const dupRes = await fetch(`${baseUrl}/api/leads/ingest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': generatedKey.api_key,
                'x-api-secret': generatedKey.api_secret
            },
            body: JSON.stringify({
                ...testLead,
                notes: 'Duplicate notes'
            })
        });

        const dupResult = await dupRes.json();
        console.log(`Duplicate Response Status: ${dupRes.status}`);
        console.log('Duplicate Result:', JSON.stringify(dupResult, null, 2));

        if (dupRes.status === 200 && dupResult.duplicate && dupResult.leadId === leadId) {
            console.log('✅ Duplicate detection succeeded: duplicate detected and merged into ID: ' + dupResult.leadId);
        } else {
            throw new Error('Duplicate detection failed!');
        }

        // 7. Cleanup
        console.log('\n🧹 Step 7: Cleaning up created test keys, sources, and leads...');
        
        // Fetch all sources to find ID
        const getSourcesRes = await fetch(`${baseUrl}/api/admin/lead-sources`, {
            method: 'GET',
            headers: { 'Cookie': sessionCookie }
        });
        const getSourcesResult = await getSourcesRes.json();
        const testSource = getSourcesResult.sources.find(s => s.source_name === sourceName);
        if (testSource) {
            const delSrc = await fetch(`${baseUrl}/api/admin/lead-sources/${testSource.id}`, {
                method: 'DELETE',
                headers: { 'Cookie': sessionCookie }
            });
            console.log(`Deleted test lead source ID ${testSource.id}: ${delSrc.status}`);
        }

        // Fetch all API keys to find ID
        const getKeysRes = await fetch(`${baseUrl}/api/admin/lead-api-keys`, {
            method: 'GET',
            headers: { 'Cookie': sessionCookie }
        });
        const getKeysResult = await getKeysRes.json();
        const testKeyRecord = getKeysResult.keys.find(k => k.api_key === generatedKey.api_key);
        if (testKeyRecord) {
            const delKey = await fetch(`${baseUrl}/api/admin/lead-api-keys/${testKeyRecord.id}`, {
                method: 'DELETE',
                headers: { 'Cookie': sessionCookie }
            });
            console.log(`Deleted test API key ID ${testKeyRecord.id}: ${delKey.status}`);
        }

        // Delete test lead (needs to use DELETE /api/leads/:id)
        const delLead = await fetch(`${baseUrl}/api/leads/${leadId}`, {
            method: 'DELETE',
            headers: { 'Cookie': sessionCookie }
        });
        console.log(`Deleted test lead ID ${leadId}: ${delLead.status}`);

        console.log('\n🎉 End-to-End Ingestion Flow Test Completed Successfully! All services validated.');

    } catch (e) {
        console.error('\n❌ Test execution failed:', e.message);
        process.exit(1);
    }
}

runTest();
