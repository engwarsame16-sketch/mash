import { ensureSchema } from '../lib/db.js';
import { isConfigured, isAuthed, setSession, clearSession, verifyPassword, setPassword } from '../lib/auth.js';

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
      return res.status(200).json({ configured: await isConfigured(), authed: await isAuthed(req) });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const action = body.action;

      if (action === 'setup') {
        if (await isConfigured()) return res.status(409).json({ error: 'A password is already set. Please log in.' });
        const pw = String(body.password || '');
        if (pw.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
        await setPassword(pw);
        await setSession(res);
        return res.status(200).json({ ok: true, configured: true, authed: true });
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
