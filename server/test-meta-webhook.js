const crypto = require('crypto');

async function runMetaTest() {
    console.log('🏁 Starting Meta Lead Ads Webhook Integration Test...');
    const baseUrl = 'http://localhost:3001';

    const testId = Date.now();
    const leadgenId = `meta_lead_${testId}`;
    const verifyToken = `meta_verify_${testId}`;
    const appSecret = `secret_${testId}`;

    try {
        // 1. Admin login to configure Meta settings
        console.log('\n🔐 Step 1: Logging in as Admin to configure settings...');
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
        const sessionCookie = loginRes.headers.get('set-cookie').split(';')[0];
        console.log('✅ Admin Logged In.');

        // 2. Configure Meta Verify Token & App Secret in CRM settings
        console.log('\n⚙️  Step 2: Configuring Meta Webhook credentials via Admin Config endpoint...');
        
        // Update general crm settings for verify token first (seeded or settings)
        await fetch(`${baseUrl}/api/admin/crm-settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': sessionCookie
            },
            body: JSON.stringify({
                meta_verify_token: verifyToken,
                meta_app_secret: appSecret
            })
        });

        // Save Meta config mappings and settings
        const configRes = await fetch(`${baseUrl}/api/admin/meta/config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': sessionCookie
            },
            body: JSON.stringify({
                page_id: '123456789',
                form_id: '987654321',
                access_token: 'EAAG_dummy_token_value',
                app_secret: appSecret,
                mappings: {
                    "full_name": "lead_name",
                    "phone_number": "phone",
                    "email": "email",
                    "store_name": "store_name",
                    "city": "city"
                }
            })
        });
        const configResult = await configRes.json();
        if (!configRes.ok || !configResult.success) {
            throw new Error(`Failed to configure Meta connection: ${configResult.error}`);
        }
        console.log('✅ Meta Credentials and Mappings updated successfully.');

        // 3. Test Webhook Verification Handshake (GET /api/integrations/meta/webhook)
        console.log('\n🤝 Step 3: Simulating Meta Hub verification handshake (GET)...');
        
        // Let's get the verify token we updated in the settings
        const verifyRes = await fetch(`${baseUrl}/api/integrations/meta/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge_token_xyz`);
        const verifyText = await verifyRes.text();
        console.log(`GET Webhook status: ${verifyRes.status}, Response: ${verifyText}`);
        
        if (verifyRes.status !== 200 || verifyText !== 'challenge_token_xyz') {
            throw new Error('Meta Webhook verification handshake failed!');
        }
        console.log('✅ Webhook handshake verification succeeded.');

        // 4. Test Ingest Webhook (POST /api/integrations/meta/webhook) with simulation mode
        console.log('\n🧪 Step 4: Submitting simulated Meta Lead webhook with x-meta-simulation: true...');
        
        const simPayload = {
            object: "page",
            entry: [
                {
                    id: "123456789",
                    time: Math.floor(Date.now() / 1000),
                    changes: [
                        {
                            field: "leadgen",
                            value: {
                                leadgen_id: leadgenId,
                                page_id: "123456789",
                                form_id: "987654321",
                                platform: "fb",
                                adgroup_name: "Meta Adgroup",
                                campaign_name: "Meta Campaign"
                            }
                        }
                    ]
                }
            ],
            simulated_lead_name: "Simulation Doe",
            simulated_email: `meta.sim.${testId}@example.com`,
            simulated_phone: `305-555-${String(testId).slice(-4)}`,
            simulated_store_name: "Meta Ingestion Shop",
            simulated_city: "Miami",
            simulated_campaign_name: "Meta Promo Campaign",
            simulated_adset_name: "Meta Promo Adset",
            simulated_platform: "Facebook Lead Ads"
        };

        const ingestRes = await fetch(`${baseUrl}/api/integrations/meta/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-meta-simulation': 'true'
            },
            body: JSON.stringify(simPayload)
        });
        const ingestResult = await ingestRes.json();
        console.log(`Simulation Ingest Status: ${ingestRes.status}`);
        console.log('Simulation Ingest Result:', JSON.stringify(ingestResult, null, 2));

        if (ingestRes.status !== 200 || !ingestResult.success) {
            throw new Error('Simulation Webhook ingestion failed!');
        }
        console.log('✅ Simulation Webhook ingestion succeeded.');

        // 5. Test Signature Validation (POST /api/integrations/meta/webhook) with signature checking
        console.log('\n🔒 Step 5: Testing signature validation...');

        const signedPayload = {
            object: "page",
            entry: [
                {
                    id: "123456789",
                    time: Math.floor(Date.now() / 1000),
                    changes: [
                        {
                            field: "leadgen",
                            value: {
                                leadgen_id: `${leadgenId}_signed`,
                                page_id: "123456789",
                                form_id: "987654321",
                                platform: "ig",
                                adgroup_name: "Insta Adgroup",
                                campaign_name: "Insta Campaign"
                            }
                        }
                    ]
                }
            ],
            simulated_lead_name: "Signed Instagram Doe",
            simulated_email: `insta.sim.${testId}@example.com`,
            simulated_phone: `305-555-1212`,
            simulated_store_name: "Insta Shop",
            simulated_city: "Orlando",
            simulated_campaign_name: "Insta Promo Campaign",
            simulated_adset_name: "Insta Promo Adset",
            simulated_platform: "Instagram Lead Ads"
        };

        const payloadStr = JSON.stringify(signedPayload);
        const expectedSignature = crypto
            .createHmac('sha256', appSecret)
            .update(payloadStr)
            .digest('hex');

        // Test with invalid signature
        console.log('Submitting with invalid signature header...');
        const invalidSigRes = await fetch(`${baseUrl}/api/integrations/meta/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-hub-signature-256': 'sha256=invalid_signature_hex_value'
            },
            body: payloadStr
        });
        console.log(`Invalid signature Response Status: ${invalidSigRes.status}`);
        if (invalidSigRes.status !== 401) {
            throw new Error('Webhook accepted invalid signature! Expecting 401.');
        }
        console.log('✅ Invalid signature correctly rejected with 401.');

        // Test with valid signature
        console.log('Submitting with valid signature header...');
        const validSigRes = await fetch(`${baseUrl}/api/integrations/meta/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-hub-signature-256': `sha256=${expectedSignature}`
            },
            body: payloadStr
        });
        const validSigResult = await validSigRes.json();
        console.log(`Valid signature Response Status: ${validSigRes.status}`);
        if (validSigRes.status !== 200 || !validSigResult.success) {
            throw new Error('Webhook rejected valid signature!');
        }
        console.log('✅ Valid signature accepted and processed.');

        // 6. Test Webhook Duplicate Prevention
        console.log('\n🚀 Step 6: Submitting same payload again to test duplicate check...');
        const dupRes = await fetch(`${baseUrl}/api/integrations/meta/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-meta-simulation': 'true'
            },
            body: JSON.stringify(simPayload)
        });
        const dupResult = await dupRes.json();
        console.log(`Duplicate Submission Status: ${dupRes.status}`);
        if (dupRes.status !== 200 || !dupResult.success) {
            throw new Error('Duplicate submission rejected instead of ignored/merged!');
        }
        console.log('✅ Duplicate ingestion processed correctly (ignored/merged).');

        // 7. Verify Ingested Records & Log History
        console.log('\n📊 Step 7: Verifying sync log history and db records...');
        const logsRes = await fetch(`${baseUrl}/api/admin/meta/logs`, {
            method: 'GET',
            headers: { 'Cookie': sessionCookie }
        });
        const logsResult = await logsRes.json();
        if (!logsRes.ok || !logsResult.success) {
            throw new Error('Failed to fetch Meta sync logs.');
        }
        
        console.log(`- Total logs found: ${logsResult.logs.length}`);
        const testLogs = logsResult.logs.filter(log => log.facebook_lead_id === leadgenId || log.facebook_lead_id === `${leadgenId}_signed`);
        console.log(`- Test specific logs recorded: ${testLogs.length}`);
        
        if (testLogs.length === 0) {
            throw new Error('No webhook sync logs were recorded in database!');
        }
        console.log('✅ Sync logs verified.');

        // 8. Cleanup Database
        console.log('\n🧹 Step 8: Cleaning up test leads and logs...');
        
        // Find lead IDs
        const leadsRes = await fetch(`${baseUrl}/api/leads?limit=100`, {
            headers: { 'Cookie': sessionCookie }
        });
        const leadsResult = await leadsRes.json();
        const testLeads = (leadsResult.data || []).filter(l => l.external_lead_id === leadgenId || l.external_lead_id === `${leadgenId}_signed`);
        
        for (const l of testLeads) {
            const delRes = await fetch(`${baseUrl}/api/leads/${l.id}`, {
                method: 'DELETE',
                headers: { 'Cookie': sessionCookie }
            });
            console.log(`- Deleted test lead ID ${l.id}: status ${delRes.status}`);
        }

        console.log('\n🎉 Meta Webhook Integration Test Completed Successfully!');

    } catch (e) {
        console.error('\n❌ Meta Test execution failed:', e.message);
        process.exit(1);
    }
}

runMetaTest();
