// Email sending. Two options, configured via environment variables in Vercel:
//
//  A) Your own Gmail (recommended for personal use) — set:
//       GMAIL_USER          = your.address@gmail.com
//       GMAIL_APP_PASSWORD  = 16-char Google "App Password" (needs 2-Step Verification on)
//     Sends FROM your Gmail TO your recovery email. No third-party service.
//
//  B) Resend (https://resend.com) — set RESEND_API_KEY (and optionally RESEND_FROM).
//
// Gmail (option A) takes priority if both are set.

export function emailConfigured() {
  return Boolean((process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || process.env.RESEND_API_KEY);
}

export async function sendEmail({ to, subject, html, text }) {
  // Option A — send from the user's own Gmail via an App Password (SMTP).
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({ from: `Cost Manager <${process.env.GMAIL_USER}>`, to, subject, text, html });
    return true;
  }

  // Option B — Resend HTTP API.
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('Email is not set up on the server. Add GMAIL_USER + GMAIL_APP_PASSWORD (or RESEND_API_KEY) in Vercel.');
  }
  const from = process.env.RESEND_FROM || 'Cost Manager <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Email send failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return true;
}
