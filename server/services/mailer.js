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
    },

    /**
     * Sends an alert email when a new lead is received and/or assigned
     */
    async sendLeadNotificationEmail(lead, assigneeEmail, managerEmails = []) {
        try {
            const recipients = [];
            if (assigneeEmail) recipients.push(assigneeEmail);
            if (managerEmails && managerEmails.length > 0) {
                recipients.push(...managerEmails);
            }

            if (recipients.length === 0) return;

            const mailOptions = {
                from: '"LAI CRM System" <yashdhattarwal@gmail.com>',
                to: recipients.join(', '),
                subject: `🎯 New Lead Alert: ${lead.lead_name} (${lead.source})`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
                        <h2 style="color: #6D28D9; border-bottom: 2px solid #6D28D9; padding-bottom: 10px; margin-top: 0;">New Sales Lead Received</h2>
                        
                        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                            <tr>
                                <td style="padding: 8px 0; font-weight: bold; width: 35%; color: #555;">Lead Name:</td>
                                <td style="padding: 8px 0; color: #111;">${lead.lead_name}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-weight: bold; color: #555;">Source:</td>
                                <td style="padding: 8px 0; color: #6D28D9; font-weight: bold;">🔌 ${lead.source}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-weight: bold; color: #555;">Email:</td>
                                <td style="padding: 8px 0; color: #111;"><a href="mailto:${lead.email}">${lead.email || 'N/A'}</a></td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-weight: bold; color: #555;">Phone:</td>
                                <td style="padding: 8px 0; color: #111;">${lead.phone || 'N/A'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-weight: bold; color: #555;">Store/Business:</td>
                                <td style="padding: 8px 0; color: #111;">${lead.store_name || 'N/A'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-weight: bold; color: #555;">Location:</td>
                                <td style="padding: 8px 0; color: #111;">${lead.city || ''}${lead.state ? ', ' + lead.state : ''}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-weight: bold; color: #555;">POS System:</td>
                                <td style="padding: 8px 0; color: #3B82F6; font-family: monospace;">${lead.pos_system || 'N/A'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-weight: bold; color: #555;">Campaign:</td>
                                <td style="padding: 8px 0; color: #111;">${lead.campaign_name || 'N/A'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-weight: bold; color: #555;">Status:</td>
                                <td style="padding: 8px 0; color: #111;"><span style="background: #E0E7FF; color: #4338CA; padding: 3px 8px; border-radius: 4px; font-size: 0.85em;">${lead.status || 'New'}</span></td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; font-weight: bold; color: #555;">Assigned To:</td>
                                <td style="padding: 8px 0; color: #059669; font-weight: bold;">${lead.assigned_name || 'Unassigned'}</td>
                            </tr>
                        </table>

                        <div style="margin-top: 20px; padding: 15px; background: #fff; border-left: 4px solid #6D28D9; border-radius: 4px;">
                            <strong style="color: #555;">Lead Notes:</strong>
                            <p style="margin: 5px 0 0 0; color: #333; line-height: 1.4; font-size: 0.9em;">${lead.notes || 'No notes provided.'}</p>
                        </div>
                        
                        <p style="margin-top: 25px; font-size: 0.8em; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 15px;">
                            This is an automated notification from your LAI CRM Lead Management System.
                        </p>
                    </div>
                `
            };

            const info = await transporter.sendMail(mailOptions);
            console.log('✅ Lead Notification Email sent: %s', info.messageId);
            return info;
        } catch (err) {
            console.error('❌ Lead Mailer Error:', err);
        }
    }
};

module.exports = mailer;
