const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// ─── SMTP CONFIG ─────────────────────────────────────────────────────────────
const SMTP_CONFIG = {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Use SSL for port 465
    auth: {
        user: 'yashdhattarwal@gmail.com',
        pass: 'axbzdhveectvqqpc' // Gmail App Password
    }
};

const transporter = nodemailer.createTransport(SMTP_CONFIG);

const mailer = {
    /**
     * Sends a registration confirmation email with an invoice PDF attachment
     */
    async sendRegistrationEmail(data, pdfBuffer) {
        try {
            // 1. Select Template
            let templatePath = '';
            let subject = 'Confirmation of Your LAI Registration';
            
            const prod = data.product || '';
            if (prod.includes('Pro')) {
                templatePath = 'registrationlaipro.html';
                subject = 'Confirmation of Your LAI Pro Registration';
            } else if (prod.includes('IV')) {
                templatePath = 'laiIvRegistration.html';
                subject = 'Confirmation of Your LAI IV Registration';
            } else if (prod.includes('Display')) {
                templatePath = 'rtndisplay.html';
                subject = 'Confirmation of Your RTN Display Registration';
            } else {
                templatePath = 'registrationlai.html';
            }

            const fullPath = path.join(__dirname, '..', 'templates', 'emails', templatePath);
            let html = fs.readFileSync(fullPath, 'utf8');

            // 2. Replace Placeholders
            const replacements = {
                '[CustomerName]': `${data.first_name} ${data.last_name}`,
                '[ProductName]': data.product,
                '[PaymentMode]': data.payment_mode || 'Card',
                '[planname]': data.plan,
                '[EffectiveFrom]': new Date().toLocaleDateString(),
                '[EffectiveTo]': data.expiry_date || 'N/A',
                '[Scanner]': data.scanner && data.scanner !== 'Not-Needed' 
                    ? `Your purchase includes the ${data.scanner}.` 
                    : 'Your purchase doesn’t include a scanner.',
                '[LoginName]': data.username,
                '[Password]': data.password || '********',
                '[ShopID]': data.shop_id || 'N/A'
            };

            for (const [key, value] of Object.entries(replacements)) {
                html = html.split(key).join(value);
            }

            // 3. Prepare Attachments
            const attachments = [
                {
                    filename: 'RTN-Product-Invoice.pdf',
                    content: pdfBuffer
                }
            ];

            const termsPath = path.join(__dirname, '..', 'attachments', 'Rtn_terms_conditions.pdf');
            if (fs.existsSync(termsPath)) {
                attachments.push({
                    filename: 'Rtn_terms_conditions.pdf',
                    path: termsPath
                });
            }

            // 4. Send Email
            const mailOptions = {
                from: '"RTN Admin" <yashdhattarwal@gmail.com>',
                to: data.email,
                cc: ['rtimenet@gmail.com', 'realtimenetworking1776@gmail.com'],
                bcc: ['rtimenet@gmail.com', 'maitry82@gmail.com', 'admin@realtnetworking.com'],
                subject: subject,
                html: html,
                attachments: attachments
            };

            const info = await transporter.sendMail(mailOptions);
            console.log('✅ Email sent: %s', info.messageId);
            return info;
        } catch (err) {
            console.error('❌ Mailer Error:', err);
            throw err;
        }
    },

    /**
     * Sends a renewal confirmation email with an invoice PDF attachment
     */
    async sendRenewalEmail(data, pdfBuffer) {
        try {
            // 1. Select Template
            let templatePath = '';
            let subject = 'Renewal Confirmation of Your LAI Subscription';
            
            const prod = data.product || '';
            if (prod.includes('Pro')) {
                templatePath = 'RenewalLaiPro.html';
                subject = 'Renewal Confirmation of Your LAI Pro Subscription';
            } else if (prod.includes('IV')) {
                templatePath = 'RenewalLaiIV.html';
                subject = 'Renewal Confirmation of Your LAI IV Subscription';
            } else if (prod.includes('Display')) {
                templatePath = 'RenewalDisplay.html';
                subject = 'Renewal Confirmation of Your RTN Display Subscription';
            } else {
                templatePath = 'RenewalLaiIV.html';
            }

            const fullPath = path.join(__dirname, '..', 'templates', 'emails', templatePath);
            let html = fs.readFileSync(fullPath, 'utf8');

            // 2. Replace Placeholders
            const replacements = {
                '[CustomerName]': `${data.first_name} ${data.last_name}`,
                '[PaymentMode]': data.payment_mode || 'By Card',
                '[MonthlyYearly]': data.plan,
                '[FromDateTime]': new Date().toLocaleDateString(),
                '[ToDateTime]': data.expiry_date || 'N/A',
                '[EffectiveTo]': data.expiry_date || 'N/A',
                '[LocationName]': data.store_name || '',
                '[LegalName]': data.corporation || '',
                '[LoginName]': data.username,
                '[ShopID]': data.shop_id || 'N/A'
            };

            for (const [key, value] of Object.entries(replacements)) {
                html = html.split(key).join(value);
            }

            // 3. Prepare Attachments
            const attachments = [
                {
                    filename: 'RTN-Product-Invoice.pdf',
                    content: pdfBuffer
                }
            ];

            const termsPath = path.join(__dirname, '..', 'attachments', 'Rtn_terms_conditions.pdf');
            if (fs.existsSync(termsPath)) {
                attachments.push({
                    filename: 'Rtn_terms_conditions.pdf',
                    path: termsPath
                });
            }

            // 4. Send Email
            const mailOptions = {
                from: '"RTN Admin" <yashdhattarwal@gmail.com>',
                to: data.email,
                cc: ['rtimenet@gmail.com', 'realtimenetworking1776@gmail.com'],
                bcc: ['rtimenet@gmail.com', 'maitry82@gmail.com', 'admin@realtnetworking.com'],
                subject: subject,
                html: html,
                attachments: attachments
            };

            const info = await transporter.sendMail(mailOptions);
            console.log('✅ Renewal Email sent: %s', info.messageId);
            return info;
        } catch (err) {
            console.error('❌ Renewal Mailer Error:', err);
            throw err;
        }
    },

    /**
     * Sends an alert email when a registration fails
     */
    async sendFailureNotification(data, error) {
        try {
            const mailOptions = {
                from: '"RTN System" <yashdhattarwal@gmail.com>',
                to: 'realtimenetworking1776@gmail.com',
                subject: '🚨 ALERT: Registration Failed',
                html: `
                    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee;">
                        <h2 style="color: #d32f2f;">Registration Attempt Failed</h2>
                        <p><strong>Customer:</strong> ${data.first_name} ${data.last_name}</p>
                        <p><strong>Email:</strong> ${data.email}</p>
                        <p><strong>Error Message:</strong> <span style="color: red;">${error.message || error}</span></p>
                        <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;"/>
                        <h3>Details:</h3>
                        <pre style="background: #f4f4f4; padding: 10px; overflow-x: auto;">${JSON.stringify(data, null, 2)}</pre>
                    </div>
                `
            };

            const info = await transporter.sendMail(mailOptions);
            console.log('🚨 Failure notification sent: %s', info.messageId);
            return info;
        } catch (err) {
            console.error('❌ Failed to send failure notification:', err);
        }
    }
};

module.exports = mailer;
