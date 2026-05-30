const PDFDocument = require('pdfkit');
const PDFTable = require('pdfkit-table');
const path = require('path');
const fs = require('fs');

/**
 * Service to generate professional PDF invoices matching the legacy design
 */
const pdfService = {
    async generateInvoice(data) {
        return new Promise((resolve, reject) => {
            try {
                // Settings matching Document pdfDoc = new Document(PageSize.A4, 30, 30, 40, 25);
                const doc = new PDFTable({
                    size: 'A4',
                    margin: 30,
                    margins: { top: 40, bottom: 25, left: 30, right: 30 }
                });

                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));

                // ─── Colors ──────────────────────────────────────────────────
                const tanBG = '#E9BDA3';
                const faintGrey = '#B9B8B8';
                const darkGrey = '#5E6164';
                const lightGrey = '#D3D3D3';

                // ─── Logo ────────────────────────────────────────────────────
                const imagePath = path.join(__dirname, '..', 'assets', 'images', 'rtn_2.png');
                if (fs.existsSync(imagePath)) {
                    doc.image(imagePath, {
                        fit: [535, 50],
                        align: 'left'
                    });
                    doc.moveDown(0.5);
                } else {
                    doc.fontSize(20).fillColor('#000').text('RealTime Networking', { align: 'left' });
                    doc.moveDown();
                }

                // ─── Title Bar (SALES RECEIPT & Company Name) ───────────────
                // SALES RECEIPT
                doc.rect(30, doc.y, 535, 30).fill(tanBG);
                doc.fillColor('#000').font('Helvetica-Bold').fontSize(16).text('SALES RECEIPT', 30, doc.y + 8, { align: 'center', width: 535 });
                
                // Company Name
                doc.moveDown(0.8);
                const companyY = doc.y;
                doc.rect(30, companyY, 535, 25).stroke();
                doc.fillColor('#000').font('Helvetica-Oblique').fontSize(14).text('RealTime Networking LLC', 30, companyY + 6, { align: 'center', width: 535 });
                doc.moveDown(1.5);

                // ─── Company Info Table ──────────────────────────────────────
                const infoTable = {
                    title: { label: "Company Info:", fontSize: 12, font: "Helvetica-Bold", color: "#000" },
                    headers: [
                        { label: "", property: 'p1', width: 80 },
                        { label: "", property: 'v1', width: 187 },
                        { label: "", property: 'p2', width: 80 },
                        { label: "", property: 'v2', width: 188 }
                    ],
                    datas: [
                        { p1: "Phone:", v1: "1-478-396-1776", p2: "Support:", v2: "1-855-396-1776" },
                        { p1: "Website:", v1: "https://rtnlai.com/", p2: "Street:", v2: "844 W Montgomery St" },
                        { p1: "Email:", v1: "admin@realtnetworking.com", p2: "City/State/Zip:", v2: "Milledgeville, GA 31061" }
                    ],
                    options: {
                        hideHeader: true,
                        width: 535,
                        prepareRow: (row, indexColumn, indexRow, rectRow, rectCell) => {
                            doc.font("Helvetica").fontSize(10);
                            if (indexColumn % 2 === 0) doc.font("Helvetica-Bold");
                        }
                    }
                };
                doc.table(infoTable);
                doc.moveDown(0.5);

                // ─── Billing & Shipping Table ────────────────────────────────
                const billShipTable = {
                    headers: [
                        { label: "Bill To:", property: 'bill', width: 267 },
                        { label: "Ship To:", property: 'ship', width: 268 }
                    ],
                    datas: [
                        { bill: `Name: ${data.first_name} ${data.last_name}`, ship: `Name: ${data.first_name} ${data.last_name}` },
                        { bill: `Street: ${data.address}`, ship: `Street: ${data.address}` },
                        { bill: `City, State, Zip: ${data.city} ${data.state} ${data.zipcode}`, ship: `City, State, Zip: ${data.city} ${data.state} ${data.zipcode}` }
                    ],
                    options: {
                        width: 535,
                        prepareHeader: () => doc.rect(doc.x, doc.y, 535, 20).fill(lightGrey).font("Helvetica-Bold").fontSize(12).fillColor("#000"),
                        prepareRow: (row, i) => doc.font("Helvetica").fontSize(10).fillColor("#000")
                    }
                };
                doc.table(billShipTable);
                doc.moveDown(0.5);

                // ─── Invoice Number & Date ───────────────────────────────────
                const invDateTable = {
                    headers: [
                        { label: "Invoice Number", property: 'invNum', width: 133 },
                        { label: "Value", property: 'invVal', width: 133 },
                        { label: "Date", property: 'dateLabel', width: 133 },
                        { label: "DateValue", property: 'dateVal', width: 134 }
                    ],
                    datas: [
                        { 
                            invNum: "Invoice Number", 
                            invVal: data.invoiceNumber || "RTN-" + Date.now().toString().slice(-6),
                            dateLabel: "Date",
                            dateVal: new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
                        }
                    ],
                    options: {
                        hideHeader: true,
                        width: 535,
                        prepareRow: (row, indexColumn) => {
                            doc.rect(doc.x, doc.y, 133, 20).fill(lightGrey);
                            doc.fillColor("#000").font(indexColumn % 2 === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(10);
                        }
                    }
                };
                doc.table(invDateTable);
                doc.moveDown(1);

                // ─── Items Table ─────────────────────────────────────────────
                const itemsTable = {
                    headers: [
                        { label: "Item Name", property: 'name', width: 100 },
                        { label: "Quantity", property: 'qty', width: 60 },
                        { label: "Description", property: 'desc', width: 215 },
                        { label: "Unit Price", property: 'unit', width: 80 },
                        { label: "Amount", property: 'amt', width: 80 }
                    ],
                    datas: [
                        {
                            name: data.product,
                            qty: "1",
                            desc: `Registration of ${data.product} (${data.plan})`,
                            unit: `$${data.softwareTotal.toFixed(2)}`,
                            amt: `$${data.softwareTotal.toFixed(2)}`
                        }
                    ],
                    options: {
                        width: 535,
                        prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10).fillColor("#000"),
                    }
                };

                // Add Hardware if selected
                if (data.scanner && data.scanner !== 'Not-Needed') {
                    itemsTable.datas.push({
                        name: "Scanner",
                        qty: "1",
                        desc: data.scanner,
                        unit: `$${data.scannerTotal.toFixed(2)}`,
                        amt: `$${data.scannerTotal.toFixed(2)}`
                    });
                } else {
                    itemsTable.datas.push({ name: "Scanner", qty: "0", desc: " ", unit: "$0.00", amt: "$0.00" });
                }

                // Header BG for Items
                const tableHeaderY = doc.y;
                doc.rect(30, tableHeaderY, 535, 20).fill(tanBG);
                doc.table(itemsTable);

                // ─── Summary ─────────────────────────────────────────────────
                doc.moveDown();
                const rightAlignX = 400;
                doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
                
                const drawLine = (label, value) => {
                    doc.text(label, rightAlignX, doc.y, { width: 80 });
                    doc.font("Helvetica").text(value, rightAlignX + 80, doc.y - 12, { align: 'right', width: 55 });
                    doc.moveDown(0.2);
                };

                drawLine("Subtotal:", `$${(data.softwareTotal + data.scannerTotal).toFixed(2)}`);
                drawLine("Tax:", "$0.00");
                drawLine("Shipping:", `$${data.shippingTotal.toFixed(2)}`);
                
                doc.moveDown(0.5);
                doc.rect(rightAlignX - 10, doc.y, 145, 25).fill(tanBG);
                doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text("GRAND TOTAL", rightAlignX, doc.y + 7);
                doc.text(`$${data.grandTotal.toFixed(2)}`, rightAlignX + 80, doc.y - 14, { align: 'right', width: 55 });

                doc.end();
            } catch (err) {
                reject(err);
            }
        });
    }
};

module.exports = pdfService;
