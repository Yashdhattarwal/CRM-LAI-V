const nodemailer = require('nodemailer');

const SMTP_CONFIG = {
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    auth: {
        user: 'apikey',
        pass: 'SG.MOCK_KEY_FOR_TESTING_ONLY'
    }
};

const transporter = nodemailer.createTransport(SMTP_CONFIG);

async function testMail() {
    console.log('Sending standalone test email...');
    try {
        const info = await transporter.sendMail({
            from: 'yashdhattarwal@gmail.com',
            to: 'yashdhattarwal@gmail.com',
            subject: 'Standalone SMTP Test',
            text: 'If you see this, SMTP is working perfectly.'
        });
        console.log('✅ Success! Message ID:', info.messageId);
    } catch (err) {
        console.error('❌ Failed:', err.message);
    }
}

testMail();
