// Small, dependency-free backend for the Ilahia demo portal.
// Run from this folder with: node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'ai-knowledge.json');
const LEAVE_REQUESTS_FILE = path.join(DATA_DIR, 'leave-requests.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const TEACHER_ID = process.env.TEACHER_ID || 'FAC-CS-902';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'teacher123';
const HOD_ID = process.env.HOD_ID || 'FAC-HOD-001';
const HOD_PASSWORD = process.env.HOD_PASSWORD || 'hod123';
const STUDENT_ID = process.env.STUDENT_ID || 'ILH26CS042';
const STUDENT_PASSWORD = process.env.STUDENT_PASSWORD || 'student123';
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ilahia2026';
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const sessions = new Map();
const uploadTickets = new Map();

if (process.env.NODE_ENV === 'production' && ['TEACHER_PASSWORD', 'HOD_PASSWORD', 'STUDENT_PASSWORD', 'ADMIN_PASSWORD'].some(key => !process.env[key])) {
  throw new Error('Set TEACHER_PASSWORD, HOD_PASSWORD, STUDENT_PASSWORD, and ADMIN_PASSWORD in the host environment before production start.');
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]\n', 'utf8');
if (!fs.existsSync(LEAVE_REQUESTS_FILE)) fs.writeFileSync(LEAVE_REQUESTS_FILE, '[]\n', 'utf8');

function readLeaveRequests() {
  try {
    const requests = JSON.parse(fs.readFileSync(LEAVE_REQUESTS_FILE, 'utf8'));
    return Array.isArray(requests) ? requests : [];
  } catch { return []; }
}

function writeLeaveRequests(requests) {
  const temp = `${LEAVE_REQUESTS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(requests, null, 2), 'utf8');
  fs.renameSync(temp, LEAVE_REQUESTS_FILE);
}

function readEntries() {
  try {
    const entries = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function writeEntries(entries) {
  const temp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(temp, DB_FILE);
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(value === null ? '' : JSON.stringify(value));
}

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const token = cookie.match(/(?:^|;\s*)ilahia_teacher_session=([a-f0-9]+)/)?.[1];
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session;
}

function requireStaff(req, res, allowedRoles = ['teacher', 'hod', 'admin']) {
  const session = getSession(req);
  if (!session || !allowedRoles.includes(session.role)) {
    sendJson(res, 401, { error: 'Please sign in with an authorized staff account.' });
    return false;
  }
  return session.role;
}

function decodePdfString(value) {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') { result += value[i]; continue; }
    const next = value[++i];
    if (next === 'n') result += '\n';
    else if (next === 'r') result += '\n';
    else if (next === 't') result += '\t';
    else if (next === 'b') result += '\b';
    else if (next === 'f') result += '\f';
    else if (next === '\n') { /* PDF line continuation */ }
    else if (next === '\r') { if (value[i + 1] === '\n') i++; }
    else if (/[0-7]/.test(next || '')) {
      let octal = next;
      for (let j = 0; j < 2 && /[0-7]/.test(value[i + 1] || ''); j++) octal += value[++i];
      result += String.fromCharCode(parseInt(octal, 8));
    } else result += next || '';
  }
  return result;
}

function extractPdfText(buffer) {
  const pdf = buffer.toString('latin1');
  const streams = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n/gms;
  let match;
  while ((match = streamPattern.exec(pdf))) {
    const start = streamPattern.lastIndex;
    const end = pdf.indexOf('endstream', start);
    if (end < 0) break;
    const bytes = buffer.subarray(start, end);
    try {
      streams.push(match[1].includes('/FlateDecode') ? zlib.inflateSync(bytes).toString('latin1') : bytes.toString('latin1'));
    } catch { /* Ignore non-text or unsupported compressed streams. */ }
    streamPattern.lastIndex = end + 'endstream'.length;
  }
  if (!streams.length) streams.push(pdf);
  const texts = [];
  for (const stream of streams) {
    const textOps = /\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:.|\r|\n)*?)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*Tj/g;
    let op;
    while ((op = textOps.exec(stream))) {
      if (op[1] !== undefined) texts.push(decodePdfString(op[1]));
      else if (op[2] !== undefined) {
        const parts = op[2].match(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g) || [];
        texts.push(parts.map(part => part[0] === '(' ? decodePdfString(part.slice(1, -1)) : Buffer.from(part.slice(1, -1).replace(/\s/g, ''), 'hex').toString('utf8')).join(''));
      } else if (op[3] !== undefined) {
        const hex = op[3].replace(/\s/g, '');
        texts.push(Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex').toString('utf16le'));
      }
    }
  }
  return texts.join(' ').replace(/\s+/g, ' ').trim();
}

function safeUploadPath(objectPath) {
  if (typeof objectPath !== 'string' || !/^\/uploads\/[a-f0-9-]+\.pdf$/i.test(objectPath)) return null;
  return path.join(UPLOAD_DIR, path.basename(objectPath));
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/1 index.html' : decodeURIComponent(pathname);
  const publicFiles = new Set(['/1 index.html', '/index.html', '/!DOCTYPE html.txt', '/BACKEND-README.txt']);
  if (!publicFiles.has(requested)) {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }
  const file = path.resolve(ROOT, `.${requested}`);
  if (!file.startsWith(`${ROOT}${path.sep}`) || file.startsWith(`${DATA_DIR}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }
  const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  try {
    if (req.method === 'POST' && pathname === '/api/session/login') {
      const body = await readJson(req);
      const role = ['student', 'teacher', 'hod', 'admin'].includes(body.role) ? body.role : 'teacher';
      const accounts = {
        student: [STUDENT_ID, STUDENT_PASSWORD],
        teacher: [TEACHER_ID, TEACHER_PASSWORD],
        hod: [HOD_ID, HOD_PASSWORD],
        admin: [ADMIN_ID, ADMIN_PASSWORD]
      };
      const [accountId, accountPassword] = accounts[role];
      const valid = String(body.id || '').trim() === accountId && body.password === accountPassword;
      if (!valid) {
        sendJson(res, 401, { error: 'Invalid ID or passcode.' });
        return;
      }
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { role, userId: accountId, expires: Date.now() + 8 * 60 * 60 * 1000 });
      const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      sendJson(res, 200, { ok: true, role }, { 'Set-Cookie': `ilahia_teacher_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}` });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/session/logout') {
      const token = (req.headers.cookie || '').match(/(?:^|;\s*)ilahia_teacher_session=([a-f0-9]+)/)?.[1];
      if (token) sessions.delete(token);
      const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': `ilahia_teacher_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}` });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/leave-requests') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in as a student to submit a leave request.' }); return; }
      const body = await readJson(req);
      const reason = String(body.reason || '').trim();
      if (!reason || reason.length > 5000) { sendJson(res, 400, { error: 'Enter a reason (up to 5,000 characters).' }); return; }
      const now = new Date().toISOString();
      const request = {
        id: crypto.randomUUID(), requestType: 'Leave Application', studentId: session.userId,
        subject: String(body.subject || 'Student leave request').trim().slice(0, 180),
        reason, status: 'mentor_pending', statusLabel: 'Waiting for Mentor',
        createdAt: now, updatedAt: now,
        history: [{ stage: 'mentor_pending', label: 'Submitted to Mentor', actor: session.userId, at: now, note: '' }]
      };
      const requests = readLeaveRequests();
      requests.unshift(request);
      writeLeaveRequests(requests);
      sendJson(res, 201, request);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/leave-requests') {
      const session = getSession(req);
      if (!session) { sendJson(res, 401, { error: 'Sign in to view leave requests.' }); return; }
      let requests = readLeaveRequests();
      if (session.role === 'student') requests = requests.filter(item => item.studentId === session.userId);
      else if (session.role === 'teacher') requests = requests.filter(item => item.status === 'mentor_pending');
      else if (session.role === 'hod') requests = requests.filter(item => item.status === 'hod_pending');
      else if (session.role === 'admin') requests = requests.filter(item => item.status === 'office_pending');
      else requests = [];
      sendJson(res, 200, requests);
      return;
    }
    const leaveActionMatch = pathname.match(/^\/api\/leave-requests\/([a-f0-9-]+)\/action$/i);
    if (req.method === 'POST' && leaveActionMatch) {
      const session = getSession(req);
      if (!session || !['teacher', 'hod', 'admin'].includes(session.role)) { sendJson(res, 401, { error: 'Authorized staff sign-in is required.' }); return; }
      const body = await readJson(req);
      const requests = readLeaveRequests();
      const request = requests.find(item => item.id === leaveActionMatch[1]);
      if (!request) { sendJson(res, 404, { error: 'Leave request not found.' }); return; }
      const transitions = {
        teacher: { forward: ['mentor_pending', 'hod_pending', 'Forwarded to HOD'] },
        hod: { forward: ['hod_pending', 'office_pending', 'Forwarded to Office'] },
        admin: { approve: ['office_pending', 'approved', 'Approved by Office'], reject: ['office_pending', 'rejected', 'Rejected by Office'] }
      };
      const transition = transitions[session.role]?.[body.action];
      if (!transition || request.status !== transition[0]) { sendJson(res, 409, { error: 'This request is no longer available for that action.' }); return; }
      const now = new Date().toISOString();
      request.status = transition[1];
      request.statusLabel = transition[2];
      request.updatedAt = now;
      request.history.push({ stage: request.status, label: transition[2], actor: session.userId, at: now, note: String(body.note || '').trim().slice(0, 1000) });
      writeLeaveRequests(requests);
      sendJson(res, 200, request);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/ai-knowledge') {
      const audience = url.searchParams.get('audience');
      const entries = readEntries();
      const visibleEntries = audience === 'students'
        ? entries.filter(entry => entry.audience === 'students')
        : entries.filter(entry => entry.audience !== 'students');
      sendJson(res, 200, visibleEntries);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/ai-knowledge') {
      const role = requireStaff(req, res);
      if (!role) return;
      const body = await readJson(req);
      const title = String(body.title || '').trim();
      const content = String(body.content || '').trim();
      if (!title || !content) { sendJson(res, 400, { error: 'A title and text content are required.' }); return; }
      if (role !== 'admin' && body.audience !== 'students') {
        sendJson(res, 403, { error: 'Teacher notes must be shared with students.' }); return;
      }
      const audience = body.audience === 'students' ? 'students' : 'all';
      const entry = {
        id: crypto.randomUUID(), title: title.slice(0, 180), content: content.slice(0, 150000),
        category: String(body.category || 'general').slice(0, 80), audience,
        source: String(body.source || 'Faculty note').slice(0, 180),
        tags: Array.isArray(body.tags) ? body.tags.map(tag => String(tag).slice(0, 50)).slice(0, 30) : [],
        attachmentPath: safeUploadPath(body.attachmentPath) ? body.attachmentPath : null,
        attachmentName: String(body.attachmentName || '').slice(0, 180),
        createdAt: new Date().toISOString()
      };
      const entries = readEntries();
      entries.unshift(entry);
      writeEntries(entries);
      sendJson(res, 201, entry);
      return;
    }
    const deleteMatch = pathname.match(/^\/api\/ai-knowledge\/([a-f0-9-]+)$/i);
    if (req.method === 'DELETE' && deleteMatch) {
      const role = requireStaff(req, res);
      if (!role) return;
      const entries = readEntries();
      const entry = entries.find(item => String(item.id) === deleteMatch[1]);
      if (!entry) { sendJson(res, 404, { error: 'Knowledge entry not found.' }); return; }
      if (role !== 'admin' && entry.audience !== 'students') { sendJson(res, 403, { error: 'Staff can only delete student notes.' }); return; }
      writeEntries(entries.filter(item => String(item.id) !== deleteMatch[1]));
      sendJson(res, 204, null);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/storage/uploads/request-url') {
      const role = requireStaff(req, res, ['teacher']);
      if (!role) return;
      const body = await readJson(req);
      if (body.contentType !== 'application/pdf' || !Number.isFinite(body.size) || body.size <= 0 || body.size > MAX_UPLOAD_BYTES) {
        sendJson(res, 400, { error: 'Choose a PDF file smaller than 25 MB.' }); return;
      }
      const token = crypto.randomBytes(24).toString('hex');
      const objectPath = `/uploads/${crypto.randomUUID()}.pdf`;
      uploadTickets.set(token, { objectPath, expires: Date.now() + 10 * 60 * 1000, name: path.basename(String(body.name || 'handout.pdf')).slice(0, 180) });
      sendJson(res, 200, { uploadURL: `/api/storage/uploads/${token}`, objectPath });
      return;
    }
    const uploadMatch = pathname.match(/^\/api\/storage\/uploads\/([a-f0-9]{48})$/i);
    if (req.method === 'PUT' && uploadMatch) {
      const role = requireStaff(req, res, ['teacher']);
      if (!role) return;
      const ticket = uploadTickets.get(uploadMatch[1]);
      uploadTickets.delete(uploadMatch[1]);
      if (!ticket || ticket.expires < Date.now()) { sendJson(res, 410, { error: 'Upload link expired. Please try again.' }); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) { sendJson(res, 413, { error: 'PDF must be smaller than 25 MB.' }); return; }
        chunks.push(chunk);
      }
      const file = Buffer.concat(chunks);
      if (file.subarray(0, 5).toString('ascii') !== '%PDF-') { sendJson(res, 415, { error: 'Uploaded file is not a valid PDF.' }); return; }
      const storedPath = safeUploadPath(ticket.objectPath);
      fs.writeFileSync(storedPath, file, { flag: 'wx' });
      const extractedText = extractPdfText(file);
      sendJson(res, 201, { objectPath: ticket.objectPath, attachmentName: ticket.name, extractedText, hasExtractableText: extractedText.length > 0 });
      return;
    }
    const fileMatch = pathname.match(/^\/api\/storage(\/uploads\/[a-f0-9-]+\.pdf)$/i);
    if (req.method === 'GET' && fileMatch) {
      const file = safeUploadPath(fileMatch[1]);
      if (!file || !fs.existsSync(file)) { sendJson(res, 404, { error: 'File not found.' }); return; }
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/api/')) { sendJson(res, 404, { error: 'API route not found.' }); return; }
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed.' }); return; }
    serveStatic(req, res, pathname);
  } catch (error) {
    console.error('[backend]', error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete the request.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ilahia portal listening on ${HOST}:${PORT}`);
  console.log(`Teacher account ID: ${TEACHER_ID}`);
});

