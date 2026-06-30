import { ensureSchema } from '../lib/db.js';
import {
  isConfigured, isAuthed, setSession, clearSession, verifyPassword, setPassword,
  getSetting, setSetting, createResetCode, verifyResetCode, clearResetCode,
} from '../lib/auth.js';
import { emailConfigured, sendEmail } from '../lib/email.js';

function maskEmail(e) {
  if (!e || !e.includes('@')) return '';
  const [u, d] = e.split('@');
  const head = u.length <= 2 ? u[0] || '' : u.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

// /api/auth
//   GET                              → { configured, authed }
//   POST { action:'setup', password }     → set the first password + log in
//   POST { action:'login', password }     → log in
//   POST { action:'logout' }              → log out
//   POST { action:'change', currentPassword, newPassword } → change password
export default async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const email = await getSetting('recovery_email');
      return res.status(200).json({
        configured: await isConfigured(),
        authed: await isAuthed(req),
        emailEnabled: emailConfigured(),
        hasRecoveryEmail: Boolean(email),
        recoveryEmailMasked: maskEmail(email),
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const action = body.action;

      if (action === 'setup') {
        if (await isConfigured()) return res.status(409).json({ error: 'A password is already set. Please log in.' });
        const pw = String(body.password || '');
        if (pw.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
        const email = String(body.email || '').trim();
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid recovery email.' });
        await setPassword(pw);
        if (email) await setSetting('recovery_email', email);
        await setSession(res);
        return res.status(200).json({ ok: true, configured: true, authed: true });
      }

      if (action === 'forgot') {
        if (!(await isConfigured())) return res.status(400).json({ error: 'No password has been set yet.' });
        const email = await getSetting('recovery_email');
        if (!email) return res.status(400).json({ error: 'No recovery email is on file for this app.' });
        if (!emailConfigured()) return res.status(503).json({ error: 'Email recovery is not set up on the server yet. Add a RESEND_API_KEY in Vercel.' });
        const code = await createResetCode();
        await sendEmail({
          to: email,
          subject: 'Your Cost Manager password reset code',
          text: `Your password reset code is ${code}. It expires in 30 minutes. If you didn't request this, you can ignore this email.`,
          html: `<div style="font-family:sans-serif"><p>Your Cost Manager password reset code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:3px">${code}</p><p>It expires in 30 minutes. If you didn't request this, you can ignore this email.</p></div>`,
        });
        return res.status(200).json({ ok: true, sentTo: maskEmail(email) });
      }

      if (action === 'reset') {
        if (!(await isConfigured())) return res.status(400).json({ error: 'No password has been set yet.' });
        if (!(await verifyResetCode(String(body.code || '')))) return res.status(400).json({ error: 'That reset code is invalid or has expired.' });
        const np = String(body.newPassword || '');
        if (np.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters.' });
        await setPassword(np);
        await clearResetCode();
        await setSession(res);
        return res.status(200).json({ ok: true, authed: true });
      }

      if (action === 'set-email') {
        if (!(await isAuthed(req))) return res.status(401).json({ error: 'Not authenticated.' });
        const email = String(body.email || '').trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
        await setSetting('recovery_email', email);
        return res.status(200).json({ ok: true, recoveryEmailMasked: maskEmail(email) });
      }

      if (action === 'login') {
        if (!(await isConfigured())) return res.status(400).json({ error: 'No password has been set yet.' });
        if (!(await verifyPassword(String(body.password || '')))) return res.status(401).json({ error: 'Incorrect password.' });
        await setSession(res);
        return res.status(200).json({ ok: true, authed: true });
      }

      if (action === 'logout') {
        clearSession(res);
        return res.status(200).json({ ok: true, authed: false });
      }

      if (action === 'change') {
        if (!(await isAuthed(req))) return res.status(401).json({ error: 'Not authenticated.' });
        if (!(await verifyPassword(String(body.currentPassword || '')))) return res.status(401).json({ error: 'Current password is incorrect.' });
        const np = String(body.newPassword || '');
        if (np.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters.' });
        await setPassword(np);
        await setSession(res);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action.' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
