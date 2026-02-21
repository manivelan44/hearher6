import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

// ─── Cache Ethereal test account at module level (created once, reused forever) ──
let cachedTestAccount: { user: string; pass: string } | null = null;
let cachedTestTransporter: nodemailer.Transporter | null = null;

async function getTestTransporter(): Promise<{ transporter: nodemailer.Transporter; failed: boolean }> {
    if (cachedTestTransporter) return { transporter: cachedTestTransporter, failed: false };
    try {
        const testAccount = await nodemailer.createTestAccount();
        cachedTestAccount = { user: testAccount.user, pass: testAccount.pass };
        cachedTestTransporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: { user: testAccount.user, pass: testAccount.pass },
        });
        return { transporter: cachedTestTransporter, failed: false };
    } catch (err) {
        console.warn('⚠️ Ethereal rate limit hit — falling back to console-only logging');
        // Create a JSON transport that just logs (never fails)
        const fallback = nodemailer.createTransport({ jsonTransport: true });
        return { transporter: fallback, failed: true };
    }
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();

        const file = formData.get('recording') as File | null;
        const employeeName = formData.get('employeeName') as string || 'Unknown Employee';
        const employeeEmail = formData.get('employeeEmail') as string || 'N/A';
        const latitude = formData.get('latitude') as string || 'N/A';
        const longitude = formData.get('longitude') as string || 'N/A';
        const timestamp = formData.get('timestamp') as string || new Date().toISOString();

        // ─── Configure SMTP Transport ────────────────────────────────────────
        let transporter: nodemailer.Transporter;
        let recipientEmail: string;
        let isTestMode = false;
        let isConsoleFallback = false;

        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;
        const hrEmail = process.env.HR_EMAIL;

        if (smtpUser && smtpPass) {
            // Production mode — use real Gmail SMTP
            transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: smtpUser, pass: smtpPass },
            });
            recipientEmail = hrEmail || smtpUser;
            console.log('📧 Using real SMTP (Gmail) to send panic email');
        } else {
            // Test mode — use cached Ethereal account (or console fallback)
            const result = await getTestTransporter();
            transporter = result.transporter;
            recipientEmail = 'hr@company.com';
            isTestMode = true;
            isConsoleFallback = result.failed;
            console.log(isConsoleFallback
                ? '📋 Using console-only mode (Ethereal rate-limited)'
                : '🧪 Using Ethereal (test mode) — no real email will be sent');
        }

        // ─── Build the email ─────────────────────────────────────────────────
        const googleMapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
        const formattedTime = new Date(timestamp).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'full',
            timeStyle: 'medium',
        });

        const htmlBody = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1a1a2e; color: #e0e0e0; border-radius: 12px; overflow: hidden;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #dc2626, #991b1b); padding: 24px; text-align: center;">
                <h1 style="margin: 0; font-size: 24px; color: #fff;">🚨 PANIC ALERT — Immediate Action Required</h1>
            </div>

            <!-- Body -->
            <div style="padding: 24px;">
                <p style="font-size: 16px; line-height: 1.6;">
                    A <strong style="color: #ef4444;">panic alert</strong> was triggered by an employee. The recorded audio/video evidence is attached below.
                </p>

                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #333; color: #9ca3af;">Employee Name</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #333; font-weight: bold; color: #fff;">${employeeName}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #333; color: #9ca3af;">Employee Email</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #333; color: #60a5fa;">${employeeEmail}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #333; color: #9ca3af;">Timestamp</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #333; color: #fff;">${formattedTime}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #333; color: #9ca3af;">Last Known Location</td>
                        <td style="padding: 10px 0; border-bottom: 1px solid #333;">
                            <a href="${googleMapsLink}" style="color: #34d399; text-decoration: underline;" target="_blank">
                                📍 ${latitude}, ${longitude} — Open in Google Maps
                            </a>
                        </td>
                    </tr>
                </table>

                ${file ? `
                <div style="background: #16213e; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin-top: 16px;">
                    <p style="margin: 0; color: #60a5fa; font-weight: bold;">📎 Evidence Recording Attached</p>
                    <p style="margin: 4px 0 0; color: #9ca3af; font-size: 13px;">
                        File: ${file.name || 'panic-evidence.webm'} (${(file.size / (1024 * 1024)).toFixed(2)} MB)
                    </p>
                </div>
                ` : `
                <p style="color: #f59e0b; font-style: italic;">⚠️ No recording was attached to this alert.</p>
                `}

                <div style="margin-top: 24px; padding: 16px; background: #1e293b; border-left: 4px solid #ef4444; border-radius: 4px;">
                    <p style="margin: 0; font-size: 14px; color: #fca5a5;">
                        ⚡ This is an auto-generated alert from the HearHer POSH Safety Platform. Please take immediate action to ensure the employee's safety.
                    </p>
                </div>
            </div>

            <!-- Footer -->
            <div style="background: #111827; padding: 16px; text-align: center; font-size: 12px; color: #6b7280;">
                HearHer — POSH Safety Platform &bull; Confidential
            </div>
        </div>
        `;

        // ─── Prepare attachment ──────────────────────────────────────────────
        const attachments: nodemailer.SendMailOptions['attachments'] = [];
        if (file) {
            const buffer = Buffer.from(await file.arrayBuffer());
            attachments.push({
                filename: file.name || `panic-evidence-${Date.now()}.webm`,
                content: buffer,
                contentType: file.type || 'video/webm',
            });
        }

        // ─── Send ────────────────────────────────────────────────────────────
        const info = await transporter.sendMail({
            from: `"HearHer Safety Alert" <${smtpUser || 'noreply@hearher.app'}>`,
            to: recipientEmail,
            subject: `🚨 PANIC ALERT — ${employeeName} — Immediate Action Required`,
            html: htmlBody,
            priority: 'high',
            attachments,
        });

        console.log('✅ Panic email sent! Message ID:', info.messageId);

        if (isTestMode) {
            if (isConsoleFallback) {
                // JSON transport — log the email body for debugging
                console.log('');
                console.log('╔════════════════════════════════════════════════════════════════╗');
                console.log('║  📋  EMAIL LOGGED (Ethereal rate-limited, console fallback)    ║');
                console.log('║  To:', recipientEmail);
                console.log('║  Subject: 🚨 PANIC ALERT —', employeeName);
                console.log('║  Recording:', file ? `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)` : 'None');
                console.log('║  Location:', `${latitude}, ${longitude}`);
                console.log('╚════════════════════════════════════════════════════════════════╝');
                console.log('');
                return NextResponse.json({
                    success: true,
                    testMode: true,
                    consoleFallback: true,
                    message: 'Email logged to console (Ethereal rate-limited). Configure SMTP_USER/SMTP_PASS in .env.local for real emails.',
                });
            }

            const previewUrl = nodemailer.getTestMessageUrl(info);
            console.log('');
            console.log('╔════════════════════════════════════════════════════════════════╗');
            console.log('║  📬  TEST EMAIL PREVIEW (Ethereal):                           ║');
            console.log(`║  ${previewUrl}`);
            console.log('╚════════════════════════════════════════════════════════════════╝');
            console.log('');
            return NextResponse.json({
                success: true,
                testMode: true,
                previewUrl,
                messageId: info.messageId,
            });
        }

        return NextResponse.json({
            success: true,
            testMode: false,
            messageId: info.messageId,
        });

    } catch (error: any) {
        console.error('❌ Failed to send panic email:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to send email' },
            { status: 500 }
        );
    }
}
