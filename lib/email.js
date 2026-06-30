// Email sending via the Resend HTTP API (https://resend.com).
// Configured with the RESEND_API_KEY environment variable in Vercel.
// No npm dependency — uses global fetch (Node 18+ on Vercel).

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('Email is not set up on the server (RESEND_API_KEY is missing).');
  // Resend lets you send from onboarding@resend.dev to your own account email
  // without verifying a domain. Override with RESEND_FROM once a domain is set up.
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
