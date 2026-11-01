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
const AI_DELETED_IDS_FILE = path.join(DATA_DIR, 'ai-knowledge-deleted-ids.json');
const AI_SYNC_STATUS_FILE = path.join(DATA_DIR, 'ai-knowledge-sync-status.json');
const LEAVE_REQUESTS_FILE = path.join(DATA_DIR, 'leave-requests.json');
const GATEPASSES_FILE = path.join(DATA_DIR, 'gatepasses.json');
const GATEPASS_CODE_SECRET = process.env.GATEPASS_CODE_SECRET || crypto.randomBytes(32).toString('hex');
const SKILL_OFFERS_FILE = path.join(DATA_DIR, 'skill-offers.json');
const SKILL_REQUESTS_FILE = path.join(DATA_DIR, 'skill-learning-requests.json');
const SKILL_MESSAGES_FILE = path.join(DATA_DIR, 'skill-learning-messages.json');
const SKILL_PAYMENTS_FILE = path.join(DATA_DIR, 'skill-learning-payments.json');
const FEE_PAYMENTS_FILE = path.join(DATA_DIR, 'fee-payments.json');
const CAMPUS_LIFE_FILE = path.join(DATA_DIR, 'campus-life.json');
const CERTIFICATES_FILE = path.join(DATA_DIR, 'certificates.json');
const CANTEEN_ORDERS_FILE = path.join(DATA_DIR, 'canteen-orders.json');
const PORTAL_BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PORTAL_BACKUP_STORE_FILES = Object.freeze({
  'ai-knowledge.json': DB_FILE,
  'ai-knowledge-deleted-ids.json': AI_DELETED_IDS_FILE,
  'ai-knowledge-sync-status.json': AI_SYNC_STATUS_FILE,
  'leave-requests.json': LEAVE_REQUESTS_FILE,
  'gatepasses.json': GATEPASSES_FILE,
  'skill-offers.json': SKILL_OFFERS_FILE,
  'skill-learning-requests.json': SKILL_REQUESTS_FILE,
  'skill-learning-messages.json': SKILL_MESSAGES_FILE,
  'skill-learning-payments.json': SKILL_PAYMENTS_FILE,
  'fee-payments.json': FEE_PAYMENTS_FILE,
  'campus-life.json': CAMPUS_LIFE_FILE,
  'certificates.json': CERTIFICATES_FILE,
  'canteen-orders.json': CANTEEN_ORDERS_FILE
});
const MAX_BACKUP_BODY_BYTES = 120 * 1024 * 1024;
const MAX_BACKUP_UPLOAD_BYTES = 85 * 1024 * 1024;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const FEE_SCHEDULE = (() => {
  if (!process.env.FEE_SCHEDULE_JSON) return {};
  try { return JSON.parse(process.env.FEE_SCHEDULE_JSON); }
  catch { throw new Error('FEE_SCHEDULE_JSON must contain valid JSON.'); }
})();
const SKILL_ROUTE_ACCOUNTS = (() => {
  if (!process.env.SKILL_PAYMENT_LINKED_ACCOUNTS_JSON) return {};
  try { return JSON.parse(process.env.SKILL_PAYMENT_LINKED_ACCOUNTS_JSON); }
  catch { throw new Error('SKILL_PAYMENT_LINKED_ACCOUNTS_JSON must contain valid JSON.'); }
})();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const REQUIRE_CONFIGURED_ACCOUNTS = process.env.NODE_ENV === 'production' || HOST === '0.0.0.0';
const TEACHER_ID = process.env.TEACHER_ID || 'FAC-CS-902';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'teacher123';
const HOD_ID = process.env.HOD_ID || 'FAC-HOD-001';
const HOD_PASSWORD = process.env.HOD_PASSWORD || 'hod123';
const STUDENT_ID = process.env.STUDENT_ID || 'ILH26CS042';
const STUDENT_PASSWORD = process.env.STUDENT_PASSWORD || 'student123';
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ilahia2026'; // Local-only demo fallback; production startup requires an environment secret.
const CAMPUS_KEYS = ['icet', 'arts', 'poly', 'school', 'iti', 'law', 'pharmacy', 'kmlps'];
const CAMPUS_PREFIXES = { icet: 'ICET', arts: 'ARTS', poly: 'POLY', school: 'SCHOOL', iti: 'ITI', law: 'LAW', pharmacy: 'PHARM', kmlps: 'KMLPS' };
const suppliedCampusAccounts = (() => {
  if (!process.env.CAMPUS_ACCOUNTS_JSON) return null;
  try { return JSON.parse(process.env.CAMPUS_ACCOUNTS_JSON); }
  catch { throw new Error('CAMPUS_ACCOUNTS_JSON must contain valid JSON.'); }
})();
const CAMPUS_ACCOUNTS = Object.fromEntries(CAMPUS_KEYS.map(campusKey => {
  const prefix = CAMPUS_PREFIXES[campusKey];
  const defaults = {
    student: campusKey === 'icet' ? [STUDENT_ID, STUDENT_PASSWORD, 'Azmil'] : [`${prefix}-STU-001`, `${campusKey}Stu26!`, 'Azmil'],
    teacher: campusKey === 'icet' ? [TEACHER_ID, TEACHER_PASSWORD, 'Demo Teacher'] : [`${prefix}-FAC-001`, `${campusKey}Fac26!`, 'Demo Teacher'],
    hod: campusKey === 'icet' ? [HOD_ID, HOD_PASSWORD, 'Demo HOD'] : [`${prefix}-HOD-001`, `${campusKey}Hod26!`, 'Demo HOD']
  };
  const configured = suppliedCampusAccounts || {};
  for (const role of Object.keys(defaults)) {
    const account = configured[role]?.[campusKey];
    if (account && typeof account.id === 'string' && typeof account.password === 'string') {
      const configuredName = String(account.displayName || account.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
      defaults[role] = [account.id, account.password, configuredName || (role === 'student' ? 'Student' : role === 'hod' ? 'HOD' : 'Teacher')];
    }
  }
  return [campusKey, defaults];
}));
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const OFFICIAL_SITE_REFRESH_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();
const uploadTickets = new Map();
const loginAttemptBuckets = new Map();
const LOGIN_ATTEMPT_LIMIT = 10;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

if (REQUIRE_CONFIGURED_ACCOUNTS && (!suppliedCampusAccounts || ['ADMIN_ID', 'ADMIN_PASSWORD'].some(key => !process.env[key]))) {
  throw new Error('Production requires CAMPUS_ACCOUNTS_JSON with student, teacher, and hod credentials for every campus, plus ADMIN_ID and ADMIN_PASSWORD.');
}
if (REQUIRE_CONFIGURED_ACCOUNTS && CAMPUS_KEYS.some(campusKey => ['student', 'teacher', 'hod'].some(role => !suppliedCampusAccounts?.[role]?.[campusKey]?.id || !suppliedCampusAccounts?.[role]?.[campusKey]?.password))) {
  throw new Error('CAMPUS_ACCOUNTS_JSON must define an id and password for all three roles at every campus.');
}

function recordCampusKey(record) { return CAMPUS_KEYS.includes(record?.campusKey) ? record.campusKey : 'icet'; }
function isInSessionCampus(record, session) { return session.role === 'admin' || recordCampusKey(record) === session.campusKey; }

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]\n', 'utf8');
if (!fs.existsSync(AI_DELETED_IDS_FILE)) fs.writeFileSync(AI_DELETED_IDS_FILE, '[]\n', 'utf8');
if (!fs.existsSync(LEAVE_REQUESTS_FILE)) fs.writeFileSync(LEAVE_REQUESTS_FILE, '[]\n', 'utf8');
if (!fs.existsSync(GATEPASSES_FILE)) fs.writeFileSync(GATEPASSES_FILE, '[]\n', 'utf8');
for (const file of [SKILL_OFFERS_FILE, SKILL_REQUESTS_FILE, SKILL_MESSAGES_FILE, SKILL_PAYMENTS_FILE, FEE_PAYMENTS_FILE, CERTIFICATES_FILE, CANTEEN_ORDERS_FILE]) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]\n', 'utf8');
}
if (!fs.existsSync(CAMPUS_LIFE_FILE)) fs.writeFileSync(CAMPUS_LIFE_FILE, '{"appointments":[],"lostFound":[],"maintenance":[],"events":[],"alerts":[],"rsvps":[],"eventCheckins":[],"placements":[],"applications":[],"progress":[],"counselling":[],"alumniMentors":[],"mentorshipRequests":[],"busRoutes":[],"busTracking":[]}\n', 'utf8');

function readJsonArray(file) {
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

function writeJsonArray(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function normalizeMaintenanceText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function maintenanceReporterList(item) {
  const reporters = Array.isArray(item.reporters) ? item.reporters : [];
  const legacy = item.studentId ? [{ userId: item.studentId, displayName: item.studentName || 'Student', role: 'student' }] : [];
  const unique = new Map();
  [...legacy, ...reporters].forEach(person => {
    const userId = String(person.userId || person.studentId || '');
    if (userId) unique.set(userId, { userId, displayName: String(person.displayName || person.studentName || 'Student'), role: person.role === 'teacher' || person.role === 'hod' ? person.role : 'student' });
  });
  return [...unique.values()];
}

function maintenanceIssueKey(item) {
  return [item.campusKey, normalizeMaintenanceText(item.category), normalizeMaintenanceText(item.location), normalizeMaintenanceText(item.details)].join('|');
}

function normalizeMaintenancePriority(value) {
  return ['normal', 'high', 'urgent'].includes(String(value || '').toLowerCase()) ? String(value || '').toLowerCase() : 'normal';
}

function maintenancePriorityRank(value) {
  return ({ urgent: 3, high: 2, normal: 1 })[normalizeMaintenancePriority(value)];
}

const MAINTENANCE_RESPONSE_TARGET_HOURS = Object.freeze({ urgent: 4, high: 24, normal: 72 });

function maintenanceResponseMetrics(item, now = Date.now()) {
  const targetHours = Number(item.responseTargetHours) > 0 ? Number(item.responseTargetHours) : MAINTENANCE_RESPONSE_TARGET_HOURS[normalizeMaintenancePriority(item.priority)];
  const createdAt = Date.parse(item.createdAt || '');
  const responseDueAt = Number.isFinite(createdAt) ? new Date(createdAt + targetHours * 60 * 60 * 1000).toISOString() : null;
  const dueTime = responseDueAt ? Date.parse(responseDueAt) : NaN;
  const firstStaffResponseAt = item.firstStaffResponseAt || (item.status !== 'open' ? item.reviewedAt : '') || '';
  const responseTime = Date.parse(firstStaffResponseAt);
  let responseState = 'pending';
  if (Number.isFinite(responseTime)) responseState = responseTime > dueTime ? 'late' : 'responded';
  else if (Number.isFinite(dueTime) && now > dueTime) responseState = 'overdue';
  return { responseTargetHours: targetHours, responseDueAt, responseState, firstStaffResponseAt, firstStaffResponseByName: item.firstStaffResponseByName || (firstStaffResponseAt ? item.reviewedByName || '' : '') };
}

function collapseDuplicateMaintenanceReports(items) {
  const merged = new Map();
  for (const item of items || []) {
    const key = `${maintenanceIssueKey(item)}|${item.status === 'resolved' ? 'resolved' : 'active'}`;
    const existing = merged.get(key);
    if (!existing) {
      const reporters = maintenanceReporterList(item);
      merged.set(key, { ...item, priority: normalizeMaintenancePriority(item.priority), responseTargetHours: Number(item.responseTargetHours) > 0 ? Number(item.responseTargetHours) : MAINTENANCE_RESPONSE_TARGET_HOURS[normalizeMaintenancePriority(item.priority)], reporters, notes: Array.isArray(item.notes) ? item.notes : [], reportCount: reporters.length || 1 });
      continue;
    }
    const reporters = new Map(maintenanceReporterList(existing).map(person => [person.userId, person]));
    maintenanceReporterList(item).forEach(person => reporters.set(person.userId, person));
    existing.reporters = [...reporters.values()];
    existing.reportCount = existing.reporters.length || 1;
    existing.responseTargetHours = Math.min(Number(existing.responseTargetHours) || MAINTENANCE_RESPONSE_TARGET_HOURS[normalizeMaintenancePriority(existing.priority)], Number(item.responseTargetHours) || MAINTENANCE_RESPONSE_TARGET_HOURS[normalizeMaintenancePriority(item.priority)]);
    const notes = new Map([...(Array.isArray(existing.notes) ? existing.notes : []), ...(Array.isArray(item.notes) ? item.notes : [])].map(note => [note.id || `${note.createdAt}|${note.authorName}|${note.message}`, note]));
    existing.notes = [...notes.values()].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    existing.lastReportedAt = [existing.lastReportedAt, item.lastReportedAt, item.createdAt].filter(Boolean).sort().at(-1) || existing.createdAt;
    if (item.status === 'in-progress') existing.status = 'in-progress';
    if (maintenancePriorityRank(item.priority) > maintenancePriorityRank(existing.priority)) existing.priority = normalizeMaintenancePriority(item.priority);
  }
  return [...merged.values()];
}

function readCampusLife() {
  try {
    const value = JSON.parse(fs.readFileSync(CAMPUS_LIFE_FILE, 'utf8'));
    const data = { appointments: [], lostFound: [], maintenance: [], events: [], alerts: [], rsvps: [], eventCheckins: [], placements: [], applications: [], progress: [], counselling: [], alumniMentors: [], mentorshipRequests: [], busRoutes: [], busTracking: [], projects: [], ...value };
    data.maintenance = collapseDuplicateMaintenanceReports(data.maintenance);
    return data;
  } catch { return { appointments: [], lostFound: [], maintenance: [], events: [], alerts: [], rsvps: [], eventCheckins: [], placements: [], applications: [], progress: [], counselling: [], alumniMentors: [], mentorshipRequests: [], busRoutes: [], busTracking: [], projects: [] }; }
}

function writeCampusLife(value) {
  const temp = `${CAMPUS_LIFE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, CAMPUS_LIFE_FILE);
}

function isSkillEligibleStudent(session) {
  return Boolean(session && session.role === 'student' && CAMPUS_KEYS.includes(session.campusKey) && !['school', 'kmlps'].includes(session.campusKey));
}

function requireStudent(req, res, errorMessage = 'Sign in to an eligible college student portal first.') {
  const session = getSession(req);
  if (!session || session.role !== 'student') { sendJson(res, 401, { error: errorMessage }); return null; }
  if (['school', 'kmlps'].includes(session.campusKey)) { sendJson(res, 403, { error: 'Skill Learner is available to college and institute students; both school portals are excluded.' }); return null; }
  return session;
}

function safeText(value, maxLength) { return String(value || '').trim().replace(/[<>]/g, '').slice(0, maxLength); }
function campusLocalDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }

function razorpayConfigured() { return Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET); }

async function razorpayRequest(endpoint, method, data) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${endpoint}`, {
    method, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error?.description || 'The payment provider rejected the request.'), { status: 502 });
  return result;
}

async function getCapturedRazorpayPayment(paymentId, orderId, amountPaise) {
  let payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`, 'GET');
  if (payment.order_id !== orderId || payment.amount !== amountPaise || payment.currency !== 'INR') return null;
  if (payment.status === 'authorized') {
    payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, 'POST', { amount: amountPaise, currency: 'INR' });
  }
  return payment.status === 'captured' ? payment : null;
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
  if (!/^[a-f0-9]{64}$/i.test(String(signature || ''))) return false;
  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

const GATEPASS_CODE_WINDOW_MS = 30 * 1000;
function gatepassCodeForSlot(passId, slot) {
  const digest = crypto.createHmac('sha256', GATEPASS_CODE_SECRET).update(`${passId}|${slot}`).digest('hex');
  return String(parseInt(digest.slice(0, 8), 16) % 1000000).padStart(6, '0');
}
function constantTimeCodeMatch(expected, supplied) {
  const a = Buffer.from(String(expected)), b = Buffer.from(String(supplied || ''));
  return /^\d{6}$/.test(String(supplied || '')) && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function parseCampusDateTime(date, time) { return new Date(`${date}T${time}:00+05:30`); }

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

function readGatepasses() {
  try {
    const requests = JSON.parse(fs.readFileSync(GATEPASSES_FILE, 'utf8'));
    return Array.isArray(requests) ? requests : [];
  } catch { return []; }
}

function writeGatepasses(requests) {
  const temp = `${GATEPASSES_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(requests, null, 2), 'utf8');
  fs.renameSync(temp, GATEPASSES_FILE);
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

function readDeletedKnowledgeIds() {
  try {
    const values = JSON.parse(fs.readFileSync(AI_DELETED_IDS_FILE, 'utf8'));
    return Array.isArray(values) ? values.map(String) : [];
  } catch { return []; }
}

function writeDeletedKnowledgeIds(values) {
  const temp = `${AI_DELETED_IDS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify([...new Set(values.map(String))], null, 2), 'utf8');
  fs.renameSync(temp, AI_DELETED_IDS_FILE);
}

// Seed official institute reference material once while preserving teacher/admin entries.
const BUILTIN_INSTITUTION_KNOWLEDGE = [
  { id: 'academic-core-study-method', title: 'Study methods, revision and exam answers', category: 'study-skills', audience: 'students', source: 'Academic support knowledge base', tags: ['study plan', 'revision', 'exam preparation', 'memory', 'answer writing', 'notes'], content: 'An effective study cycle is: name one learning outcome; recall what you already know without notes; study a short section; explain it in your own words; solve or answer one example; check mistakes; and revisit the topic later using spaced practice. For a long-answer exam response, define the key term, organize the main points under headings, support each point with an example or evidence, and finish with a concise conclusion. For a problem, show the known values, method or formula, working, units, and a final check. These are general study strategies, not a substitute for the exact examination scheme.' },
  { id: 'academic-core-computing', title: 'Computing, programming and software fundamentals', category: 'study-skills', audience: 'students', source: 'Academic support knowledge base', tags: ['programming', 'python', 'java', 'c', 'algorithm', 'data structures', 'database', 'web development', 'debugging'], content: 'For a programming question, first state the input, expected output, and constraints; outline the algorithm; then write code and trace it with a small example. When debugging, reproduce the error, read the first relevant error message, isolate a small failing case, and check types, indexes, conditions, and input assumptions. Algorithms should explain correctness and time or space complexity when required. Database answers can be organized around entities, keys, relationships, constraints, queries, and transactions. Web development questions often separate structure (HTML), presentation (CSS), behavior (JavaScript), and server or storage responsibilities. Exact syntax depends on the language and course version.' },
  { id: 'academic-core-mathematics', title: 'Mathematics and quantitative problem-solving', category: 'study-skills', audience: 'students', source: 'Academic support knowledge base', tags: ['mathematics', 'maths', 'algebra', 'calculus', 'statistics', 'probability', 'formula', 'numerical'], content: 'For a mathematics or numerical problem, write the given information, identify what must be found, choose the relevant definition or formula, substitute values carefully, and preserve units. Show intermediate steps so an error can be located. For calculus, state the function and operation before differentiating or integrating; for statistics, distinguish the population from a sample and identify the measure being calculated; for probability, define the event and sample space. Check whether the result has the expected sign, scale, and units. Ask with the exact question or chapter for a worked solution.' },
  { id: 'academic-core-science-labs', title: 'Science explanations, practicals and lab reports', category: 'study-skills', audience: 'students', source: 'Academic support knowledge base', tags: ['physics', 'chemistry', 'biology', 'science', 'laboratory', 'lab report', 'practical', 'experiment'], content: 'A clear science explanation links an observation to a principle and then to evidence. For a practical, record the aim, apparatus or materials, variables, safe procedure, observations, calculations, and conclusion. A lab report normally includes aim, method, results with units, analysis, sources of error, and conclusion. Distinguish measured observations from interpretations; do not invent experimental readings. In physics show the equation and units, in chemistry balance equations and identify conditions, and in biology name the process or structure before describing its role. Follow the laboratory instructions and safety rules provided by the teacher.' },
  { id: 'academic-core-writing', title: 'Academic writing, presentations and communication', category: 'study-skills', audience: 'students', source: 'Academic support knowledge base', tags: ['essay', 'report', 'presentation', 'communication', 'english', 'writing', 'citation'], content: 'A focused academic paragraph makes one claim, supports it with a reason or evidence, and explains how it answers the question. For an essay or report, plan the introduction, ordered sections, evidence, and conclusion before drafting. Use reliable sources and the citation style required by the course; distinguish quotations from your own words. For a presentation, state the purpose, use one main idea per slide, explain visuals, and end with a summary or question. For language learning, practise the target form in a short example and then create a new sentence of your own.' },
  { id: 'academic-core-teaching', title: 'Teaching plans, assessments and feedback', category: 'study-skills', audience: 'students', source: 'Academic support knowledge base', tags: ['lesson plan', 'learning outcomes', 'assessment', 'rubric', 'worksheet', 'feedback', 'faculty'], content: 'A practical lesson plan connects measurable learning outcomes to teaching activities and checks for understanding. A useful sequence is a short prior-knowledge prompt, explicit explanation or demonstration, guided practice, independent application, and an exit check. Assessments should match the stated outcome and include clear criteria; a rubric can describe performance levels for each criterion. Feedback is most useful when it identifies a specific strength, a next step, and an opportunity to revise. Adapt examples and pacing to learners while keeping the intended outcome clear.' },
  { id: 'seed-ilahia-institutions', title: 'Ilahia Trust institutions directory', category: 'institutions', audience: 'all', scope: 'trust', source: 'Ilahia College of Engineering and Technology institutions page', tags: ['Ilahia Trust', 'institutions', 'campuses', 'all colleges'], content: 'The official ICET institutions page lists Ilahia College of Engineering and Technology, Ilahia College of Arts and Science, Ilahia Polytechnic College, Ilahia Public School, Ilahia Law College, Ilahia College of Pharmacy, and Kavumkara Muslim L.P. School (KMLP). Ilahia Private ITI appears in Ilahia management information. Ask about a specific institution for its own current programmes and admission details. Sources: https://icet.ac.in/ and https://www.icas.ac.in/about/history' },
  { id: 'seed-ilahia-law', title: 'Ilahia Law College programmes, eligibility and contact', category: 'institutions', audience: 'all', campusKey: 'law', source: 'Ilahia Law College official pages', tags: ['law', 'LLB', 'BA LLB', 'admissions', 'eligibility'], content: 'Ilahia Law College states it is affiliated with Mahatma Gandhi University and approved by the Bar Council of India. It lists a Three-Year Unitary LL.B and a Five-Year Integrated B.A. LL.B. (Hons.). Its admissions page lists 45% minimum aggregate for general-category applicants, 42% for OBC, and 40% for SC/ST; the integrated course requires recognised 10+2. Verify current rules before applying. The college describes a library, moot court hall, cyber facilities, auditoriums, hostels, sports and transport. Address: Pezhakkappilly P.O., Muvattupuzha, Ernakulam, Kerala 686673. Phone +91 94001 30499; ilahialaw@gmail.com. Sources: https://ilahialawcollege.com/aboutus, https://ilahialawcollege.com/courses, https://ilahialawcollege.com/admission_process, https://ilahialawcollege.com/contactpage' },
  { id: 'seed-ilahia-pharmacy', title: 'Ilahia College of Pharmacy B.Pharm and contact', category: 'institutions', audience: 'all', campusKey: 'pharmacy', source: 'Ilahia College of Pharmacy official pages', tags: ['pharmacy', 'B.Pharm', 'admissions', 'pharmaceutics', 'pharmacology'], content: 'Ilahia College of Pharmacy publishes a four-year Bachelor of Pharmacy (B.Pharm) programme. Its listed learning areas include pharmaceutics, pharmaceutical chemistry, pharmacology, pharmaceutical analysis, hospital and clinical pharmacy, and pharmacognosy. It lists careers such as hospital pharmacist, quality-control officer, medical representative, drug inspector and research assistant. Address: Near Ilahia Arts College, Pezhakkappilly P.O., Muvattupuzha, Ernakulam, Kerala 686673. Phone +91 94476 08456; ilahiapharmacy@gmail.com. Confirm current availability, intake, eligibility and regulatory approval with the college and regulator. Sources: https://ilahiacollegeofpharmacy.com/all-courses/ and https://ilahiacollegeofpharmacy.com/contact/' },
  { id: 'seed-campus-icet', title: 'Ilahia College of Engineering and Technology programmes', category: 'institution-profile', audience: 'all', campusKey: 'icet', source: 'ICET official course and admission pages', tags: ['ICET', 'engineering', 'BTech', 'MTech', 'MBA', 'MCA', 'courses'], content: 'ICET identifies itself as established in 2002, AICTE-approved and affiliated with APJ Abdul Kalam Technological University (KTU). Its official course list includes B.Tech programmes in Artificial Intelligence and Data Science, Civil, Computer Science, Computer Science (Cyber Security), Electrical and Electronics, Electronics and Communication, Mechanical, Food Technology, Agricultural Engineering and Biomedical Engineering; it also lists working-professional B.Tech options in Civil and CSE. Postgraduate listings include M.Tech in CSE and Computer-Aided Structural Engineering, MBA, MCA and Ph.D. in CSE. Intake, accreditation and current admission rules vary by programme and year; use the current official admission page. Sources: https://icet.ac.in/about-icet/, https://icet.ac.in/courses-offered/, https://icet.ac.in/under-graduate-admission/, https://icet.ac.in/post-graduate-admission/' },
  { id: 'seed-campus-arts', title: 'Ilahia College of Arts and Science programmes and admissions', category: 'institution-profile', audience: 'all', campusKey: 'arts', source: 'Ilahia College of Arts and Science official pages', tags: ['arts', 'science', 'ICAS', 'BBA', 'BCA', 'BCom', 'admissions'], content: 'Ilahia College of Arts and Science says it began in June 1995 and is affiliated with Mahatma Gandhi University. Its current homepage/admissions pages list undergraduate programmes including BBA (Hons.), BCA (Hons.), BA (Hons.) Economics and English, B.Com (Hons.) Accounting, Finance and Taxation, Logistics Management, and B.Sc. (Hons.) Psychology, Cyber Forensics and Computer Science. The admissions page advertises UG/PG admissions for 2026 and lists enquiry numbers +91 94009 25061, +91 94009 25716, 0485 2811607 and +91 96335 31607. Confirm course availability and eligibility with the college. Sources: https://www.icas.ac.in/home, https://www.icas.ac.in/admissions, https://www.icas.ac.in/about/history' },
  { id: 'seed-campus-poly', title: 'Ilahia Polytechnic College programmes and contact', category: 'institution-profile', audience: 'all', campusKey: 'poly', source: 'Ilahia Polytechnic College official website', tags: ['polytechnic', 'diploma', 'mechanical', 'automobile', 'electrical', 'admissions'], content: 'Ilahia Polytechnic College describes three six-semester diploma programmes: Mechanical Engineering, Electrical and Electronics Engineering, and Automobile Engineering. The college website says it is AICTE-approved and affiliated with the State Board of Technical Education, Kerala; it describes its institution as established in 2020. It lists SSLC/10th pass as the admissions starting qualification. Address: East Paipra Road, Pezhakkappilly P.O., Muvattupuzha, Ernakulam, Kerala 686673. Phone +91 90720 75311; ilahiapolytechnic@gmail.com. Confirm current intake, eligibility and admission dates with the college. Source: https://ilahiapoly.co.in/home/' },
  { id: 'seed-campus-school', title: 'Ilahia Public School profile and admissions', category: 'institution-profile', audience: 'all', campusKey: 'school', source: 'CBSE SARAS and Ilahia Public School official website', tags: ['public school', 'CBSE', 'admissions', 'school'], content: 'Ilahia Public School is at Market P.O., Muvattupuzha, Ernakulam, Kerala 686673. The current CBSE SARAS affiliation record lists affiliation number 930239, school number 75304, Senior Secondary level, and validity from 1 April 2027 through 31 March 2032. The school website lists +91 90726 31606 as a contact number. Confirm current grades, subjects, admission requirements, fees and contact details with the school. Sources: https://saras.cbse.gov.in/SARAS/AffiliatedList/AfflicationDetails/930239 and https://www.ilahiapublicschool.edu.in/' },
  { id: 'seed-campus-kmlps', title: 'Kavumkara Muslim L.P. School (KMLPS) profile', category: 'institution-profile', audience: 'all', campusKey: 'kmlps', source: 'KMLPS official website', tags: ['KMLPS', 'KMLP', 'Kavumkara', 'primary school', 'admissions'], content: 'KMLPS (Ilahia Junior School) lists Malayalam- and English-medium classes from LKG through Standard 4. Its website describes a Scout Unit, Health Club, Balasabha, Students’ Bank and student radio. The school lists Market P.O., Kavumkara, Muvattupuzha, Ernakulam, Kerala 686673; office hours 8:00 AM–4:30 PM and school hours 8:30 AM–3:30 PM Monday to Saturday; email mail@kmlps.in. Confirm present admissions, fees and details with the school. Source: https://www.kmlps.in/' },
  { id: 'seed-campus-iti', title: 'Ilahia Private ITI trades and current-status note', category: 'institution-profile', audience: 'all', campusKey: 'iti', source: 'Ilahia Trust and Government of India trade-affiliation records', tags: ['ITI', 'vocational training', 'Electrician', 'COPA', 'Draughtsman Civil'], content: 'Ilahia Private ITI is identified by Ilahia Trust management information as a Trust institution in Pezhakkappilly, Muvattupuzha. A Government of India DGT affiliation record from 2019 names Electrician, Draughtsman Civil and COPA trades for the institute. This is a historical affiliation record, not confirmation that these trades are currently offered; ask the ITI or Kerala ITI admissions portal for current trade availability, seats and admission dates. Sources: https://icet.ac.in/icet-management/ and https://ncvtmis.gov.in/Pages/FileDownload.aspx?fileId=880' }
];
const existingKnowledge = readEntries();
const knowledgeIds = new Set(existingKnowledge.map(entry => String(entry.id)));
const deletedKnowledgeIds = new Set(readDeletedKnowledgeIds());
const missingInstitutionKnowledge = BUILTIN_INSTITUTION_KNOWLEDGE.filter(entry => !knowledgeIds.has(entry.id) && !deletedKnowledgeIds.has(entry.id));
if (missingInstitutionKnowledge.length) writeEntries([...existingKnowledge, ...missingInstitutionKnowledge]);

// Only fetch pages from these fixed official Ilahia institution sites. Unavailable or
// robots-disallowed pages are skipped; the last successful knowledge entry is retained.
const OFFICIAL_INSTITUTION_SOURCES = [
  { slug: 'icet', name: 'Ilahia College of Engineering and Technology', campusKey: 'icet', urls: ['https://icet.ac.in/about-icet/', 'https://icet.ac.in/courses-offered/', 'https://icet.ac.in/under-graduate-admission/', 'https://icet.ac.in/post-graduate-admission/'] },
  { slug: 'icas', name: 'Ilahia College of Arts and Science', campusKey: 'arts', urls: ['https://www.icas.ac.in/home', 'https://www.icas.ac.in/admissions', 'https://www.icas.ac.in/about/history'] },
  { slug: 'polytechnic', name: 'Ilahia Polytechnic College', campusKey: 'poly', urls: ['https://ilahiapoly.co.in/'] },
  { slug: 'public-school', name: 'Ilahia Public School', campusKey: 'school', urls: ['https://www.ilahiapublicschool.edu.in/'] },
  { slug: 'law-college', name: 'Ilahia Law College', campusKey: 'law', urls: ['https://ilahialawcollege.com/aboutus', 'https://ilahialawcollege.com/courses', 'https://ilahialawcollege.com/admission_process', 'https://ilahialawcollege.com/contactpage'] },
  { slug: 'pharmacy', name: 'Ilahia College of Pharmacy', campusKey: 'pharmacy', urls: ['https://ilahiacollegeofpharmacy.com/', 'https://ilahiacollegeofpharmacy.com/all-courses/', 'https://ilahiacollegeofpharmacy.com/contact/'] },
  { slug: 'kmlps', name: 'Kavumkara Muslim L.P. School', campusKey: 'kmlps', urls: ['https://www.kmlps.in/'] },
  { slug: 'iti', name: 'Ilahia Private I.T.I.', campusKey: 'iti', urls: ['https://icet.ac.in/icet-management/'] }
];
const crawlerName = 'IlahiaCampusKnowledgeBot';
const robotsCache = new Map();
let officialSiteSyncInProgress = false;
let aiSyncStatus = (() => {
  try { return JSON.parse(fs.readFileSync(AI_SYNC_STATUS_FILE, 'utf8')); }
  catch { return { lastAttemptAt: null, lastSuccessAt: null, sourceResults: [], message: 'Initial automatic refresh is pending.' }; }
})();

function saveAISyncStatus() {
  const temp = `${AI_SYNC_STATUS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(aiSyncStatus, null, 2), 'utf8');
  fs.renameSync(temp, AI_SYNC_STATUS_FILE);
}

function decodeHtmlText(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function extractOfficialPageText(html) {
  const title = decodeHtmlText((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const description = decodeHtmlText(html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] || '').replace(/\s+/g, ' ').trim();
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript|iframe|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(h[1-4]|p|li|td|th|dt|dd|address)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_, tag, text) => `\n${text.replace(/<[^>]+>/g, ' ')}\n`)
    .replace(/<[^>]+>/g, ' ');
  const lines = decodeHtmlText(body).replace(/[\t\u00a0 ]+/g, ' ').split(/[\r\n]+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length >= 35 && line.length <= 700);
  const uniqueLines = [...new Set(lines)].slice(0, 45);
  return { title, description, text: [description, ...uniqueLines].filter(Boolean).join('\n').slice(0, 7000) };
}

function robotsAllowsPath(robotsText, userAgent, pathname) {
  const groups = [];
  let current = null;
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || current.hasRules) { current = { agents: [], rules: [], hasRules: false }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current && (key === 'allow' || key === 'disallow')) {
      current.hasRules = true;
      if (value) current.rules.push({ allow: key === 'allow', value });
    }
  }
  const matching = groups.filter(group => group.agents.some(agent => agent === '*' || userAgent.toLowerCase().includes(agent)));
  const rules = matching.flatMap(group => group.rules);
  const matches = rules.filter(rule => {
    const pattern = rule.value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\$$/, '$');
    try { return new RegExp(`^${pattern}`).test(pathname); } catch { return pathname.startsWith(rule.value); }
  }).sort((a, b) => b.value.length - a.value.length);
  return !matches.length || matches[0].allow;
}

async function fetchOfficialHtml(url) {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('Only HTTPS source pages are allowed.');
  const timeout = AbortSignal.timeout(12000);
  let robots = robotsCache.get(target.origin);
  if (!robots || robots.expiresAt < Date.now()) {
    try {
      const robotsResponse = await fetch(`${target.origin}/robots.txt`, { headers: { 'User-Agent': `${crawlerName}/1.0 (+official-site knowledge refresh)` }, signal: timeout, redirect: 'error' });
      if (robotsResponse.ok) robots = { text: (await robotsResponse.text()).slice(0, 200000), expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
      else if ([404, 410].includes(robotsResponse.status)) robots = { text: '', expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
      else throw new Error(`robots.txt returned ${robotsResponse.status}`);
      robotsCache.set(target.origin, robots);
    } catch (error) {
      throw new Error(`Could not check robots.txt: ${error.message}`);
    }
  }
  if (!robotsAllowsPath(robots.text, crawlerName, `${target.pathname}${target.search}`)) throw new Error('robots.txt disallows this page.');
  const response = await fetch(target.href, { headers: { 'User-Agent': `${crawlerName}/1.0 (+official-site knowledge refresh)`, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  const finalUrl = new URL(response.url);
  if (finalUrl.hostname.replace(/^www\./i, '') !== target.hostname.replace(/^www\./i, '')) throw new Error('The page redirected outside its official site.');
  if (!response.ok) throw new Error(`Page returned ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('The page is not HTML.');
  const html = await response.text();
  if (html.length > 3_000_000) throw new Error('The page is too large to index.');
  return extractOfficialPageText(html);
}

async function syncOfficialCollegeKnowledge() {
  if (officialSiteSyncInProgress) return { ok: false, message: 'An official-site refresh is already running.' };
  officialSiteSyncInProgress = true;
  aiSyncStatus = { ...aiSyncStatus, lastAttemptAt: new Date().toISOString(), message: 'Fetching official college website pages…' };
  saveAISyncStatus();
  const results = [];
  try {
    for (const institution of OFFICIAL_INSTITUTION_SOURCES) {
      const pages = [];
      const failures = [];
      for (const url of institution.urls) {
        try {
          const page = await fetchOfficialHtml(url);
          if (page.text.length < 60) throw new Error('No useful page text was extracted.');
          pages.push({ url, ...page });
        } catch (error) { failures.push(`${new URL(url).hostname}${new URL(url).pathname}: ${error.message}`); }
        await new Promise(resolve => setTimeout(resolve, 350));
      }
      if (!pages.length) {
        results.push({ institution: institution.name, ok: false, message: failures.join(' · ') || 'No pages were fetched.' });
        continue;
      }
      const content = pages.map(page => `${page.title || institution.name}\n${page.text}\nSource page: ${page.url}`).join('\n\n').slice(0, 18000);
      const entries = readEntries();
      const entryId = `official-site-${institution.slug}`;
      const record = {
        id: entryId, title: `${institution.name} · current official website information`, category: 'institution-web', audience: 'all', campusKey: institution.campusKey,
        source: pages.map(page => page.url).join(' | '), tags: [institution.slug, institution.name, 'official website', 'current information'],
        content, updatedAt: new Date().toISOString(), fetchedPages: pages.length
      };
      const existingIndex = entries.findIndex(entry => String(entry.id) === entryId);
      if (existingIndex >= 0) entries[existingIndex] = record; else entries.push(record);
      writeEntries(entries);
      results.push({ institution: institution.name, ok: true, pages: pages.length, failedPages: failures.length, message: failures.join(' · ') });
    }
    const successCount = results.filter(result => result.ok).length;
    aiSyncStatus = {
      ...aiSyncStatus, lastAttemptAt: aiSyncStatus.lastAttemptAt, lastSuccessAt: successCount ? new Date().toISOString() : aiSyncStatus.lastSuccessAt,
      nextRunAt: new Date(Date.now() + OFFICIAL_SITE_REFRESH_MS).toISOString(), sourceResults: results,
      message: `${successCount} of ${OFFICIAL_INSTITUTION_SOURCES.length} institution sources refreshed.`
    };
    saveAISyncStatus();
    console.log(`[AI knowledge] Official college website refresh: ${aiSyncStatus.message}`);
    return { ok: successCount > 0, message: aiSyncStatus.message, sourceResults: results };
  } catch (error) {
    aiSyncStatus = { ...aiSyncStatus, nextRunAt: new Date(Date.now() + OFFICIAL_SITE_REFRESH_MS).toISOString(), sourceResults: results, message: `Refresh failed: ${error.message}` };
    saveAISyncStatus();
    console.error('[AI knowledge] Official website refresh failed:', error);
    return { ok: false, message: aiSyncStatus.message, sourceResults: results };
  } finally {
    officialSiteSyncInProgress = false;
  }
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

function createPortalBackup() {
  const stores = {};
  for (const [name, file] of Object.entries(PORTAL_BACKUP_STORE_FILES)) stores[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const uploads = [];
  let uploadBytes = 0;
  for (const entry of fs.readdirSync(UPLOAD_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$/i.test(entry.name)) continue;
    const bytes = fs.readFileSync(path.join(UPLOAD_DIR, entry.name));
    uploadBytes += bytes.length;
    if (uploadBytes > MAX_BACKUP_UPLOAD_BYTES) throw Object.assign(new Error('Uploaded files total more than 85 MB. Remove older study files before creating a backup.'), { status: 413 });
    uploads.push({ name: entry.name, data: bytes.toString('base64') });
  }
  return { format: 'ilahia-campus-portal-backup', version: 1, createdAt: new Date().toISOString(), stores, uploads };
}

function validatePortalBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) || backup.format !== 'ilahia-campus-portal-backup' || backup.version !== 1 || !backup.stores || typeof backup.stores !== 'object' || Array.isArray(backup.stores) || !Array.isArray(backup.uploads)) {
    throw Object.assign(new Error('This is not a supported Ilahia portal backup.'), { status: 400 });
  }
  const expectedStores = Object.keys(PORTAL_BACKUP_STORE_FILES);
  const optionalStores = ['certificates.json'];
  if (expectedStores.some(name => !Object.hasOwn(backup.stores, name) && !optionalStores.includes(name)) || Object.keys(backup.stores).some(name => !expectedStores.includes(name))) {
    throw Object.assign(new Error('The backup is missing required data or contains an unsupported data file.'), { status: 400 });
  }
  const stores = { ...backup.stores, 'certificates.json': backup.stores['certificates.json'] || [] };
  for (const name of expectedStores) {
    const value = stores[name];
    const isArrayStore = name !== 'ai-knowledge-sync-status.json' && name !== 'campus-life.json';
    if (isArrayStore && !Array.isArray(value)) throw Object.assign(new Error(`Invalid data format for ${name}.`), { status: 400 });
    if (!isArrayStore && (!value || typeof value !== 'object' || Array.isArray(value))) throw Object.assign(new Error(`Invalid data format for ${name}.`), { status: 400 });
  }
  const campusLife = stores['campus-life.json'];
  for (const name of ['appointments', 'lostFound', 'maintenance', 'events', 'alerts', 'rsvps', 'eventCheckins', 'placements', 'applications', 'progress', 'counselling', 'alumniMentors', 'mentorshipRequests', 'busRoutes', 'busTracking', 'projects']) {
    if (campusLife[name] !== undefined && !Array.isArray(campusLife[name])) throw Object.assign(new Error(`Invalid campus support data in the backup (${name}).`), { status: 400 });
  }
  if (backup.uploads.length > 500) throw Object.assign(new Error('The backup contains too many uploaded files.'), { status: 413 });
  const seen = new Set();
  let uploadBytes = 0;
  const uploads = backup.uploads.map(item => {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$/i.test(item.name) || typeof item.data !== 'string' || seen.has(item.name.toLowerCase())) {
      throw Object.assign(new Error('The backup contains an invalid or duplicate uploaded file.'), { status: 400 });
    }
    seen.add(item.name.toLowerCase());
    const bytes = Buffer.from(item.data, 'base64');
    if (bytes.toString('base64') !== item.data || bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-' || bytes.length > MAX_UPLOAD_BYTES) {
      throw Object.assign(new Error(`An uploaded file in the backup is invalid or too large (${item.name}).`), { status: 400 });
    }
    uploadBytes += bytes.length;
    if (uploadBytes > MAX_BACKUP_UPLOAD_BYTES) throw Object.assign(new Error('The backup contains more than 85 MB of uploaded files.'), { status: 413 });
    return { name: item.name, bytes };
  });
  return { stores, uploads };
}

function applyPortalBackup(backup) {
  const includedUploads = new Set(backup.uploads.map(file => file.name.toLowerCase()));
  const suffix = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  for (const [name, file] of Object.entries(PORTAL_BACKUP_STORE_FILES)) {
    const temp = `${file}.${suffix}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(backup.stores[name], null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temp, file);
  }
  for (const { name, bytes } of backup.uploads) fs.writeFileSync(path.join(UPLOAD_DIR, name), bytes);
  for (const entry of fs.readdirSync(UPLOAD_DIR, { withFileTypes: true })) {
    if (entry.isFile() && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$/i.test(entry.name) && !includedUploads.has(entry.name.toLowerCase())) {
      fs.unlinkSync(path.join(UPLOAD_DIR, entry.name));
    }
  }
  aiSyncStatus = backup.stores['ai-knowledge-sync-status.json'];
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/1 index.html' : decodeURIComponent(pathname);
  const publicFiles = new Set(['/1 index.html', '/index.html', '/!DOCTYPE html.txt', '/BACKEND-README.txt', '/canteen.html', '/iti-campus.jpg', '/ilahia-ecosystem-logo.svg']);
  const isLeadershipImage = /^\/assets\/leadership\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/i.test(requested);
  if (!publicFiles.has(requested) && !isLeadershipImage) {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }
  const file = path.resolve(ROOT, `.${requested}`);
  if (!file.startsWith(`${ROOT}${path.sep}`) || file.startsWith(`${DATA_DIR}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }
  const extension = path.extname(file).toLowerCase();
  const type = extension === '.html' ? 'text/html; charset=utf-8' : extension === '.txt' ? 'text/plain; charset=utf-8' : ['.jpg', '.jpeg'].includes(extension) ? 'image/jpeg' : extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : extension === '.svg' ? 'image/svg+xml; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  if (req.method === 'GET' && pathname === '/api/health') {
    try {
      fs.accessSync(DATA_DIR, fs.constants.R_OK | fs.constants.W_OK);
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 503, { ok: false, error: 'Portal storage is unavailable.' });
    }
    return;
  }
  if (pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  try {
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.headers.origin) {
      let originHost = '';
      try { originHost = new URL(req.headers.origin).host; } catch { /* Reject malformed origins below. */ }
      if (!originHost || originHost !== req.headers.host) { sendJson(res, 403, { error: 'Cross-origin request rejected.' }); return; }
    }
    if (req.method === 'GET' && pathname === '/api/admin/backup') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to create a backup.' }); return; }
      const backup = createPortalBackup();
      const filename = `ilahia-portal-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const payload = JSON.stringify(backup);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(payload);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/admin/backup/restore') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to restore a backup.' }); return; }
      if (officialSiteSyncInProgress) { sendJson(res, 409, { error: 'Wait for the AI knowledge refresh to finish before restoring a backup.' }); return; }
      const backup = validatePortalBackup(await readJson(req, MAX_BACKUP_BODY_BYTES));
      const safetyBackup = createPortalBackup();
      fs.mkdirSync(PORTAL_BACKUP_DIR, { recursive: true });
      const safetyName = `safety-${Date.now()}-${crypto.randomUUID()}.json`;
      const safetyPath = path.join(PORTAL_BACKUP_DIR, safetyName);
      fs.writeFileSync(safetyPath, JSON.stringify(safetyBackup), { flag: 'wx' });
      try {
        applyPortalBackup(backup);
      } catch (error) {
        try { applyPortalBackup(validatePortalBackup(JSON.parse(fs.readFileSync(safetyPath, 'utf8')))); }
        catch (rollbackError) { console.error('[backup] Automatic rollback failed:', rollbackError); }
        console.error('[backup] Restore failed; safety backup saved:', safetyName, error);
        sendJson(res, 500, { error: `Restore failed. A safety copy was saved as ${safetyName}.` });
        return;
      }
      console.log(`[backup] Admin ${session.userId} restored portal data; safety copy ${safetyName}`);
      sendJson(res, 200, { ok: true, safetyBackup: safetyName, createdAt: backup.createdAt || null });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/campuses') {
      const names = { icet: 'Ilahia College of Engineering & Technology', arts: 'Ilahia College of Arts & Science', poly: 'Ilahia Polytechnic College', school: 'Ilahia Public School', iti: 'Ilahia Private ITI', law: 'Ilahia Law College', pharmacy: 'Ilahia College of Pharmacy', kmlps: 'Kavumkara Muslim L.P. School' };
      const localDemoMode = !REQUIRE_CONFIGURED_ACCOUNTS && !suppliedCampusAccounts;
      const localAdminDemo = localDemoMode && !process.env.ADMIN_ID && !process.env.ADMIN_PASSWORD
        ? { demoAdmin: { id: ADMIN_ID, password: ADMIN_PASSWORD } }
        : {};
      sendJson(res, 200, CAMPUS_KEYS.map(campusKey => ({ key: campusKey, name: names[campusKey], accounts: Object.fromEntries(['student', 'teacher', 'hod'].map(role => {
        const legacyPasswordEnv = { student: 'STUDENT_PASSWORD', teacher: 'TEACHER_PASSWORD', hod: 'HOD_PASSWORD' }[role];
        const allowDemoPassword = localDemoMode && !(campusKey === 'icet' && process.env[legacyPasswordEnv]);
        return [role, { id: CAMPUS_ACCOUNTS[campusKey][role][0], ...(allowDemoPassword ? { demoPassword: CAMPUS_ACCOUNTS[campusKey][role][1] } : {}) }];
      })), ...(campusKey === 'icet' ? localAdminDemo : {}) })));
      return;
    }
    if (req.method === 'POST' && pathname === '/api/session/login') {
      const ip = req.socket.remoteAddress || 'unknown';
      let attempts = loginAttemptBuckets.get(ip);
      if (!attempts || attempts.resetAt <= Date.now()) attempts = { count: 0, resetAt: Date.now() + LOGIN_ATTEMPT_WINDOW_MS };
      if (attempts.count >= LOGIN_ATTEMPT_LIMIT) {
        const waitSeconds = Math.max(1, Math.ceil((attempts.resetAt - Date.now()) / 1000));
        sendJson(res, 429, { error: 'Too many sign-in attempts. Wait 15 minutes before trying again.' }, { 'Retry-After': String(waitSeconds) });
        return;
      }
      loginAttemptBuckets.set(ip, attempts);
      if (loginAttemptBuckets.size > 5000) {
        for (const [key, bucket] of loginAttemptBuckets) if (bucket.resetAt <= Date.now()) loginAttemptBuckets.delete(key);
      }
      const body = await readJson(req);
      const role = ['student', 'teacher', 'hod', 'admin'].includes(body.role) ? body.role : 'teacher';
      const campusKey = String(body.campusKey || '');
      if (role !== 'admin' && !CAMPUS_KEYS.includes(campusKey)) {
        sendJson(res, 400, { error: 'Choose a valid college before signing in.' });
        return;
      }
      const accounts = {
        student: CAMPUS_ACCOUNTS[campusKey]?.student,
        teacher: CAMPUS_ACCOUNTS[campusKey]?.teacher,
        hod: CAMPUS_ACCOUNTS[campusKey]?.hod,
        admin: [ADMIN_ID, ADMIN_PASSWORD, 'Administrator']
      };
      const [accountId, accountPassword, accountDisplayName] = accounts[role] || [];
      const valid = String(body.id || '').trim() === accountId && body.password === accountPassword;
      if (!valid) {
        attempts.count++;
        loginAttemptBuckets.set(ip, attempts);
        sendJson(res, 401, { error: 'Invalid ID or passcode.' });
        return;
      }
      loginAttemptBuckets.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { role, userId: accountId, displayName: accountDisplayName || role, campusKey: role === 'admin' ? null : campusKey, expires: Date.now() + 8 * 60 * 60 * 1000 });
      const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      sendJson(res, 200, { ok: true, role, displayName: accountDisplayName || 'User' }, { 'Set-Cookie': `ilahia_teacher_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie}` });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/session/logout') {
      const token = (req.headers.cookie || '').match(/(?:^|;\s*)ilahia_teacher_session=([a-f0-9]+)/)?.[1];
      if (token) sessions.delete(token);
      const secureCookie = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': `ilahia_teacher_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}` });
      return;
    }
    if (pathname === '/api/campus-life' && req.method === 'GET') {
      const session = getSession(req);
      if (!session || !['student', 'teacher', 'hod', 'admin'].includes(session.role)) { sendJson(res, 401, { error: 'Sign in to view campus services.' }); return; }
      const campusKey = session.role === 'admin' ? String(url.searchParams.get('campusKey') || 'icet') : session.campusKey;
      if (campusKey !== 'all' && !CAMPUS_KEYS.includes(campusKey)) { sendJson(res, 400, { error: 'Choose a valid institute.' }); return; }
      const data = readCampusLife();
      const isStudent = session.role === 'student';
      const inCampus = item => campusKey === 'all' || item.campusKey === campusKey || item.campusKey === 'all';
      sendJson(res, 200, {
        appointments: data.appointments.filter(item => inCampus(item) && (!isStudent || item.studentId === session.userId)).map(({ studentId, ...item }) => ({ ...item, ...(isStudent ? {} : { studentId }) })),
        lostFound: data.lostFound.filter(item => inCampus(item) && item.status !== 'removed').map(({ ownerId, claims, ...item }) => ({ ...item, claimCount: Array.isArray(claims) ? claims.length : 0, isMine: ownerId === session.userId, ...(ownerId === session.userId ? { claims: (claims || []).map(({ studentId, ...claim }) => claim) } : {}) })),
        maintenance: data.maintenance.filter(item => inCampus(item) && (!isStudent || maintenanceReporterList(item).some(person => person.userId === session.userId))).map(item => {
          const { studentId, reporters, ...safeItem } = item;
          const safeReporters = maintenanceReporterList(item).map(({ displayName, role }) => ({ displayName, role }));
          const notes = (Array.isArray(item.notes) ? item.notes : []).map(note => ({ authorName: safeText(note.authorName, 60), authorRole: ['student', 'teacher', 'hod', 'admin'].includes(note.authorRole) ? note.authorRole : 'staff', message: safeText(note.message, 1000), createdAt: note.createdAt }));
          return { ...safeItem, ...maintenanceResponseMetrics(item), notes, reportCount: safeReporters.length || 1, reporterNames: safeReporters.map(person => person.displayName), ...(!isStudent ? { reporters: safeReporters } : {}) };
        }),
        events: data.events.filter(item => item.status === 'published' && inCampus(item)).map(({ checkinCodeHash, ...item }) => ({ ...item, checkinEnabled: Boolean(checkinCodeHash) })),
        alerts: data.alerts.filter(item => item.status === 'active' && inCampus(item)),
        myRsvps: data.rsvps.filter(item => item.studentId === session.userId && item.campusKey === campusKey).map(item => item.eventId),
        myEventCheckins: data.eventCheckins.filter(item => item.studentId === session.userId && item.campusKey === campusKey).map(item => item.eventId),
        eventAttendance: session.role === 'admin' ? data.events.filter(item => inCampus(item)).map(event => ({ eventId: event.id, attendees: data.eventCheckins.filter(item => item.eventId === event.id).map(({ studentId, ...attendee }) => attendee) })) : [],
        placements: data.placements.filter(item => item.status === 'published' && inCampus(item)),
        myApplications: data.applications.filter(item => item.studentId === session.userId && inCampus(item)).map(({ studentId, ...item }) => item),
        progress: data.progress.filter(item => inCampus(item) && (!isStudent || item.studentId === session.userId)).map(({ studentId, ...item }) => ({ ...item, ...(isStudent ? {} : { studentId }) })),
        counselling: data.counselling.filter(item => inCampus(item) && (session.role === 'admin' || item.studentId === session.userId)).map(({ studentId, ...item }) => ({ ...item, ...(session.role === 'admin' ? { studentId } : {}) })),
        alumniMentors: data.alumniMentors.filter(item => item.status === 'published' && inCampus(item)),
        myMentorshipRequests: data.mentorshipRequests.filter(item => item.studentId === session.userId && inCampus(item)).map(({ studentId, ...item }) => item),
        adminApplications: session.role === 'admin' ? data.applications.filter(inCampus) : [],
        adminMentorshipRequests: session.role === 'admin' ? data.mentorshipRequests.filter(inCampus) : [],
        busRoutes: data.busRoutes.filter(item => inCampus(item) && item.status === 'published'),
        busTracking: data.busTracking.filter(item => inCampus(item) && item.status !== 'archived'),
        projects: data.projects.filter(item => inCampus(item) && (['admin', 'teacher', 'hod'].includes(session.role) ? item.status !== 'removed' : item.status === 'published' || (item.ownerId === session.userId && ['pending', 'declined'].includes(item.status)))).map(({ ownerId, ...item }) => ({ ...item, ...(['teacher', 'hod', 'admin'].includes(session.role) ? { studentId: ownerId } : { isMine: ownerId === session.userId }) }))
      });
      return;
    }
    if (pathname === '/api/campus-life/projects' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in to a student portal to submit a project.' }); return; }
      const body = await readJson(req), title = safeText(body.title, 120), field = safeText(body.field, 80), summary = safeText(body.summary, 1200), collaborators = safeText(body.collaborators, 240), projectUrl = String(body.projectUrl || '').trim();
      if (title.length < 5 || field.length < 2 || summary.length < 20) { sendJson(res, 400, { error: 'Enter a project title, study area, and a summary of at least 20 characters.' }); return; }
      if (projectUrl) { try { const parsed = new URL(projectUrl); if (parsed.protocol !== 'https:') throw new Error(); } catch { sendJson(res, 400, { error: 'Project links must be valid HTTPS URLs.' }); return; } }
      const data = readCampusLife(), item = { id: crypto.randomUUID(), ownerId: session.userId, studentName: safeText(session.displayName, 60) || 'Student', campusKey: session.campusKey, title, field, summary, collaborators, projectUrl, status: 'pending', createdAt: new Date().toISOString() };
      data.projects.unshift(item); writeCampusLife(data); sendJson(res, 201, { id: item.id, status: item.status }); return;
    }
    const campusProjectAction = pathname.match(/^\/api\/campus-life\/projects\/([a-f0-9-]+)\/action$/i);
    if (campusProjectAction && req.method === 'POST') {
      const session = getSession(req);
      if (!session || !['teacher', 'hod', 'admin'].includes(session.role)) { sendJson(res, 401, { error: 'Teacher, HOD, or admin sign-in is required to review projects.' }); return; }
      const body = await readJson(req), action = String(body.action || ''), data = readCampusLife(), project = data.projects.find(item => item.id === campusProjectAction[1] && item.status !== 'removed');
      if (!project) { sendJson(res, 404, { error: 'Project submission not found.' }); return; }
      if (session.role !== 'admin' && project.campusKey !== session.campusKey) { sendJson(res, 403, { error: 'You can review projects from your institute only.' }); return; }
      if (project.ownerId === session.userId) { sendJson(res, 403, { error: 'You cannot review your own project submission.' }); return; }
      if (action === 'approve' || action === 'decline') {
        if (project.status !== 'pending') { sendJson(res, 409, { error: 'Only pending submissions can be approved or declined.' }); return; }
        project.status = action === 'approve' ? 'published' : 'declined';
      } else if (action === 'remove' && session.role === 'admin') {
        project.status = 'removed'; project.removedAt = new Date().toISOString();
      } else { sendJson(res, 400, { error: 'Choose approve, decline, or admin-only remove.' }); return; }
      project.reviewedAt = new Date().toISOString(); project.reviewedBy = safeText(session.displayName || session.userId, 60); writeCampusLife(data); sendJson(res, 200, { ok: true, status: project.status }); return;
    }
    if (pathname === '/api/campus-life/transport/routes' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to publish bus routes.' }); return; }
      const body = await readJson(req), campusKey = body.campusKey === 'all' ? 'all' : String(body.campusKey || ''), name = safeText(body.name, 100), routeCode = safeText(body.routeCode, 24), schedule = safeText(body.schedule, 300), stops = String(body.stops || '').split(/\r?\n/).map(stop => safeText(stop, 120)).filter(Boolean).slice(0, 20);
      if ((campusKey !== 'all' && !CAMPUS_KEYS.includes(campusKey)) || name.length < 3 || !schedule || stops.length < 2 || String(body.stops || '').split(/\r?\n/).filter(line => line.trim()).length > 20) { sendJson(res, 400, { error: 'Enter a valid institute, route name, schedule, and at least two stops (up to 20). Use one stop per line.' }); return; }
      const data = readCampusLife(), item = { id: crypto.randomUUID(), campusKey, name, routeCode, schedule, stops, status: 'published', createdAt: new Date().toISOString() };
      data.busRoutes.unshift(item); writeCampusLife(data); sendJson(res, 201, { id: item.id }); return;
    }
    if (pathname === '/api/campus-life/transport/tracking' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to publish bus tracking updates.' }); return; }
      const body = await readJson(req), data = readCampusLife(), route = data.busRoutes.find(item => item.id === String(body.routeId || '') && item.status === 'published');
      if (!route) { sendJson(res, 404, { error: 'Select an active bus route first.' }); return; }
      const status = ['on-time', 'delayed', 'cancelled', 'completed'].includes(body.status) ? body.status : '', currentStop = safeText(body.currentStop, 120), nextStop = safeText(body.nextStop, 120), eta = safeText(body.eta, 80), note = safeText(body.note, 300);
      if (!status || !currentStop || !route.stops.includes(currentStop) || (nextStop && !route.stops.includes(nextStop)) || (status !== 'cancelled' && status !== 'completed' && !nextStop)) { sendJson(res, 400, { error: 'Choose a valid status and current/next stops from this route. A next stop is required unless cancelled or completed.' }); return; }
      const item = { id: crypto.randomUUID(), routeId: route.id, routeName: route.name, routeCode: route.routeCode, campusKey: route.campusKey, status, currentStop, nextStop, eta, note, updatedAt: new Date().toISOString() };
      data.busTracking = data.busTracking.filter(entry => entry.routeId !== route.id || entry.status === 'archived');
      data.busTracking.unshift(item); writeCampusLife(data); sendJson(res, 201, { id: item.id }); return;
    }
    const busRouteArchive = pathname.match(/^\/api\/campus-life\/transport\/routes\/([a-f0-9-]+)\/archive$/i);
    if (busRouteArchive && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to archive bus routes.' }); return; }
      const data = readCampusLife(), route = data.busRoutes.find(item => item.id === busRouteArchive[1]);
      if (!route) { sendJson(res, 404, { error: 'Bus route not found.' }); return; }
      route.status = 'archived'; route.archivedAt = new Date().toISOString(); writeCampusLife(data); sendJson(res, 200, { ok: true }); return;
    }
    if (pathname === '/api/campus-life/placements' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to publish opportunities.' }); return; }
      const body = await readJson(req), title = safeText(body.title, 140), organization = safeText(body.organization, 120), details = safeText(body.details, 1200), campusKey = body.campusKey === 'all' ? 'all' : String(body.campusKey || ''), deadline = String(body.deadline || ''), link = safeText(body.link, 500);
      if (title.length < 3 || organization.length < 2 || details.length < 10 || (campusKey !== 'all' && !CAMPUS_KEYS.includes(campusKey)) || !/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !Number.isFinite(new Date(`${deadline}T12:00:00`).getTime()) || deadline < new Date().toISOString().slice(0, 10) || (link && !/^https:\/\//i.test(link))) { sendJson(res, 400, { error: 'Add a title, organization, details, a current or future deadline, institute, and secure https link if provided.' }); return; }
      const data = readCampusLife(), item = { id: crypto.randomUUID(), title, organization, details, campusKey, deadline, link, type: body.type === 'internship' ? 'internship' : 'placement', status: 'published', createdAt: new Date().toISOString() };
      data.placements.unshift(item); writeCampusLife(data); sendJson(res, 201, { id: item.id }); return;
    }
    const officeArchive = pathname.match(/^\/api\/campus-life\/(placements|alumni-mentors)\/([a-f0-9-]+)\/archive$/i);
    if (officeArchive && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to archive listings.' }); return; }
      const data = readCampusLife(), collection = officeArchive[1] === 'placements' ? data.placements : data.alumniMentors, item = collection.find(entry => entry.id === officeArchive[2]);
      if (!item) { sendJson(res, 404, { error: 'Listing not found.' }); return; }
      item.status = 'archived'; item.archivedAt = new Date().toISOString(); writeCampusLife(data); sendJson(res, 200, { ok: true }); return;
    }
    if (pathname === '/api/campus-life/applications' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in as a student to apply.' }); return; }
      const body = await readJson(req), data = readCampusLife(), item = data.placements.find(entry => entry.id === String(body.placementId || '') && entry.status === 'published' && (entry.campusKey === session.campusKey || entry.campusKey === 'all'));
      if (!item || item.deadline < new Date().toISOString().slice(0, 10)) { sendJson(res, 404, { error: 'This opportunity is unavailable or its deadline has passed.' }); return; }
      if (data.applications.some(entry => entry.placementId === item.id && entry.studentId === session.userId)) { sendJson(res, 409, { error: 'You already submitted interest in this opportunity.' }); return; }
      data.applications.unshift({ id: crypto.randomUUID(), placementId: item.id, title: item.title, organization: item.organization, studentId: session.userId, studentName: safeText(session.displayName, 60) || 'Student', campusKey: session.campusKey, status: 'received', createdAt: new Date().toISOString() }); writeCampusLife(data); sendJson(res, 201, { ok: true }); return;
    }
    if (pathname === '/api/campus-life/progress' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Only the office administrator can update official progress records.' }); return; }
      const body = await readJson(req), studentId = safeText(body.studentId, 80), subject = safeText(body.subject, 100), term = safeText(body.term, 80), campusKey = String(body.campusKey || ''), marks = Number(body.marks), attendance = Number(body.attendance);
      if (!studentId || subject.length < 2 || term.length < 2 || !CAMPUS_KEYS.includes(campusKey) || !Number.isFinite(marks) || marks < 0 || marks > 100 || !Number.isFinite(attendance) || attendance < 0 || attendance > 100) { sendJson(res, 400, { error: 'Enter a valid student login ID, institute, subject, term, marks (0–100), and attendance (0–100).'}); return; }
      const data = readCampusLife(), item = { id: crypto.randomUUID(), studentId, campusKey, subject, term, marks, attendance, note: safeText(body.note, 300), updatedAt: new Date().toISOString() };
      data.progress.unshift(item); writeCampusLife(data); sendJson(res, 201, { id: item.id }); return;
    }
    if (pathname === '/api/campus-life/counselling' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in as a student to contact student support.' }); return; }
      const body = await readJson(req), topic = safeText(body.topic, 100), note = safeText(body.note, 1200), preferred = safeText(body.preferred, 80);
      if (topic.length < 2 || note.length < 10) { sendJson(res, 400, { error: 'Choose a topic and briefly explain what support you need.' }); return; }
      const data = readCampusLife(); data.counselling.unshift({ id: crypto.randomUUID(), studentId: session.userId, studentName: safeText(session.displayName, 60) || 'Student', campusKey: session.campusKey, topic, note, preferred, status: 'received', officeNote: '', createdAt: new Date().toISOString() }); writeCampusLife(data); sendJson(res, 201, { ok: true }); return;
    }
    const counsellingAction = pathname.match(/^\/api\/campus-life\/counselling\/([a-f0-9-]+)\/action$/i);
    if (counsellingAction && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Only the student-support office can review confidential requests.' }); return; }
      const body = await readJson(req), data = readCampusLife(), item = data.counselling.find(entry => entry.id === counsellingAction[1]);
      if (!item) { sendJson(res, 404, { error: 'Counselling request not found.' }); return; }
      if (!['contacted', 'scheduled', 'closed'].includes(body.action)) { sendJson(res, 400, { error: 'Choose contacted, scheduled, or closed.' }); return; }
      item.status = body.action; if (body.officeNote !== undefined) item.officeNote = safeText(body.officeNote, 300); item.reviewedAt = new Date().toISOString(); writeCampusLife(data); sendJson(res, 200, { ok: true }); return;
    }
    const officeReview = pathname.match(/^\/api\/campus-life\/(applications|mentorship-requests)\/([a-f0-9-]+)\/action$/i);
    if (officeReview && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to review this request.' }); return; }
      const body = await readJson(req), status = ['reviewing', 'shortlisted', 'declined', 'contacted', 'closed'].includes(body.action) ? body.action : '', data = readCampusLife();
      if (!status) { sendJson(res, 400, { error: 'Choose a valid review status.' }); return; }
      const collection = officeReview[1] === 'applications' ? data.applications : data.mentorshipRequests, item = collection.find(entry => entry.id === officeReview[2]);
      if (!item) { sendJson(res, 404, { error: 'Request not found.' }); return; }
      item.status = status; item.reviewedAt = new Date().toISOString(); writeCampusLife(data); sendJson(res, 200, { ok: true }); return;
    }
    if (pathname === '/api/campus-life/alumni-mentors' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to publish verified alumni mentors.' }); return; }
      const body = await readJson(req), name = safeText(body.name, 80), course = safeText(body.course, 100), industry = safeText(body.industry, 100), bio = safeText(body.bio, 800), campusKey = body.campusKey === 'all' ? 'all' : String(body.campusKey || '');
      if (name.length < 2 || course.length < 2 || industry.length < 2 || bio.length < 10 || (campusKey !== 'all' && !CAMPUS_KEYS.includes(campusKey))) { sendJson(res, 400, { error: 'Add a verified mentor name, course, industry, bio, and institute.' }); return; }
      const data = readCampusLife(); data.alumniMentors.unshift({ id: crypto.randomUUID(), name, course, industry, bio, campusKey, status: 'published', createdAt: new Date().toISOString() }); writeCampusLife(data); sendJson(res, 201, { ok: true }); return;
    }
    if (pathname === '/api/campus-life/mentorship-requests' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in as a student to request alumni mentoring.' }); return; }
      const body = await readJson(req), data = readCampusLife(), mentor = data.alumniMentors.find(entry => entry.id === String(body.mentorId || '') && entry.status === 'published' && (entry.campusKey === session.campusKey || entry.campusKey === 'all')), note = safeText(body.note, 800);
      if (!mentor || note.length < 10) { sendJson(res, 400, { error: 'Choose a listed mentor and explain what guidance you are seeking.' }); return; }
      data.mentorshipRequests.unshift({ id: crypto.randomUUID(), mentorId: mentor.id, mentorName: mentor.name, studentId: session.userId, studentName: safeText(session.displayName, 60) || 'Student', campusKey: session.campusKey, note, status: 'received', createdAt: new Date().toISOString() }); writeCampusLife(data); sendJson(res, 201, { ok: true }); return;
    }
    if (pathname === '/api/campus-life/appointments' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in as a student to request a mentor appointment.' }); return; }
      const body = await readJson(req), topic = safeText(body.topic, 120), date = String(body.date || ''), time = String(body.time || ''), note = safeText(body.note, 800);
      const requestedAt = parseCampusDateTime(date, time);
      if (topic.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !Number.isFinite(requestedAt.getTime()) || requestedAt.getTime() < Date.now() || !note) { sendJson(res, 400, { error: 'Choose a future date and time, add a topic, and briefly explain what you need.' }); return; }
      const data = readCampusLife(), item = { id: crypto.randomUUID(), studentId: session.userId, studentName: safeText(session.displayName, 60) || 'Student', campusKey: session.campusKey, topic, date, time, note, status: 'pending', createdAt: new Date().toISOString() };
      data.appointments.unshift(item); writeCampusLife(data); sendJson(res, 201, { id: item.id, status: item.status, date, time }); return;
    }
    const appointmentAction = pathname.match(/^\/api\/campus-life\/appointments\/([a-f0-9-]+)\/action$/i);
    if (appointmentAction && req.method === 'POST') {
      const session = getSession(req);
      if (!session || !['teacher', 'hod', 'admin'].includes(session.role)) { sendJson(res, 401, { error: 'Sign in as faculty or administrator to review appointments.' }); return; }
      const body = await readJson(req), action = body.action;
      if (!['approve', 'decline'].includes(action)) { sendJson(res, 400, { error: 'Choose approve or decline.' }); return; }
      const data = readCampusLife(), item = data.appointments.find(entry => entry.id === appointmentAction[1] && (session.role === 'admin' || entry.campusKey === session.campusKey));
      if (!item) { sendJson(res, 404, { error: 'Appointment request not found for this institute.' }); return; }
      item.status = action === 'approve' ? 'approved' : 'declined'; item.reviewedAt = new Date().toISOString(); writeCampusLife(data); sendJson(res, 200, { ok: true, status: item.status }); return;
    }
    if (pathname === '/api/campus-life/lost-found' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in as a student to post a lost or found item.' }); return; }
      const body = await readJson(req), kind = ['lost', 'found'].includes(body.kind) ? body.kind : '', itemName = safeText(body.itemName, 100), location = safeText(body.location, 160), details = safeText(body.details, 600);
      if (!kind || itemName.length < 2 || location.length < 2 || details.length < 5) { sendJson(res, 400, { error: 'Add whether it is lost or found, the item name, location, and a short description.' }); return; }
      const data = readCampusLife(), item = { id: crypto.randomUUID(), ownerId: session.userId, postedBy: safeText(session.displayName, 60) || 'Student', campusKey: session.campusKey, kind, itemName, location, details, status: 'open', claims: [], createdAt: new Date().toISOString() };
      data.lostFound.unshift(item); writeCampusLife(data); sendJson(res, 201, { id: item.id, status: item.status }); return;
    }
    const lostFoundClaim = pathname.match(/^\/api\/campus-life\/lost-found\/([a-f0-9-]+)\/claim$/i);
    if (lostFoundClaim && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in as a student to contact the item poster.' }); return; }
      const body = await readJson(req), data = readCampusLife(), item = data.lostFound.find(entry => entry.id === lostFoundClaim[1] && entry.campusKey === session.campusKey && entry.status === 'open');
      if (!item) { sendJson(res, 404, { error: 'This item is no longer available.' }); return; }
      if (item.ownerId === session.userId) { sendJson(res, 400, { error: 'This is your own listing.' }); return; }
      item.claims ||= [];
      if (item.claims.some(claim => claim.studentId === session.userId)) { sendJson(res, 409, { error: 'You have already sent a message about this item.' }); return; }
      item.claims.push({ studentId: session.userId, displayName: safeText(session.displayName, 60) || 'Student', message: safeText(body.message, 300), createdAt: new Date().toISOString() });
      writeCampusLife(data); sendJson(res, 201, { ok: true }); return;
    }
    const lostFoundModeration = pathname.match(/^\/api\/campus-life\/lost-found\/([a-f0-9-]+)\/action$/i);
    if (lostFoundModeration && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to moderate lost-and-found listings.' }); return; }
      const data = readCampusLife(), item = data.lostFound.find(entry => entry.id === lostFoundModeration[1] && isInSessionCampus(entry, session));
      if (!item) { sendJson(res, 404, { error: 'Lost-and-found listing not found.' }); return; }
      if ((await readJson(req)).action !== 'remove') { sendJson(res, 400, { error: 'Choose remove to hide this listing.' }); return; }
      item.status = 'removed'; item.removedAt = new Date().toISOString(); writeCampusLife(data); sendJson(res, 200, { ok: true }); return;
    }
    if (pathname === '/api/campus-life/maintenance' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || !['student', 'teacher', 'hod'].includes(session.role)) { sendJson(res, 401, { error: 'Sign in to a student or faculty portal to report a campus issue.' }); return; }
      const body = await readJson(req), location = safeText(body.location, 160), details = safeText(body.details, 1000), category = safeText(body.category, 60), priority = String(body.priority || 'normal').toLowerCase();
      if (category.length < 2 || !location || details.length < 8 || !['normal', 'high', 'urgent'].includes(priority)) { sendJson(res, 400, { error: 'Choose a department, location, short description, and valid priority.' }); return; }
      const data = readCampusLife(), reporter = { userId: session.userId, displayName: safeText(session.displayName, 60) || (session.role === 'student' ? 'Student' : 'Faculty'), role: session.role };
      const issueKey = maintenanceIssueKey({ campusKey: session.campusKey, category, location, details });
      const existing = data.maintenance.find(entry => entry.campusKey === session.campusKey && entry.status !== 'resolved' && maintenanceIssueKey(entry) === issueKey);
      if (existing) {
        const reporters = new Map(maintenanceReporterList(existing).map(person => [person.userId, person]));
        const alreadyReported = reporters.has(reporter.userId);
        reporters.set(reporter.userId, reporter);
        existing.reporters = [...reporters.values()]; existing.reportCount = existing.reporters.length; existing.lastReportedAt = new Date().toISOString();
        if (maintenancePriorityRank(priority) > maintenancePriorityRank(existing.priority)) existing.priority = priority;
        existing.responseTargetHours = Math.min(Number(existing.responseTargetHours) || MAINTENANCE_RESPONSE_TARGET_HOURS[normalizeMaintenancePriority(existing.priority)], MAINTENANCE_RESPONSE_TARGET_HOURS[priority]);
        writeCampusLife(data); sendJson(res, 200, { id: existing.id, status: existing.status, priority: existing.priority, grouped: true, alreadyReported, reportCount: existing.reportCount, ...maintenanceResponseMetrics(existing) }); return;
      }
      const item = { id: crypto.randomUUID(), studentId: reporter.userId, studentName: reporter.displayName, reporters: [reporter], reportCount: 1, notes: [], campusKey: session.campusKey, category, location, details, priority, responseTargetHours: MAINTENANCE_RESPONSE_TARGET_HOURS[priority], status: 'open', createdAt: new Date().toISOString() };
      data.maintenance.unshift(item); writeCampusLife(data); sendJson(res, 201, { id: item.id, status: item.status, priority: item.priority, grouped: false, reportCount: 1, ...maintenanceResponseMetrics(item) }); return;
    }
    const maintenanceNotes = pathname.match(/^\/api\/campus-life\/maintenance\/([a-f0-9-]+)\/notes$/i);
    if (maintenanceNotes && req.method === 'POST') {
      const session = getSession(req);
      if (!session || !['student', 'teacher', 'hod', 'admin'].includes(session.role)) { sendJson(res, 401, { error: 'Sign in to view or post a private issue follow-up.' }); return; }
      const data = readCampusLife(), item = data.maintenance.find(entry => entry.id === maintenanceNotes[1]);
      if (!item) { sendJson(res, 404, { error: 'Issue request not found.' }); return; }
      const isReporter = maintenanceReporterList(item).some(person => person.userId === session.userId);
      const isStaff = ['teacher', 'hod', 'admin'].includes(session.role) && (session.role === 'admin' || item.campusKey === session.campusKey);
      if (!isReporter && !isStaff) { sendJson(res, 403, { error: 'Only reporters and authorized campus staff can access this private follow-up.' }); return; }
      const body = await readJson(req), message = safeText(body.message, 1000);
      if (message.length < 2) { sendJson(res, 400, { error: 'Write a short follow-up before sending.' }); return; }
      item.notes ||= [];
      if (item.notes.length >= 100) { sendJson(res, 409, { error: 'This request has reached its follow-up limit. Contact the office directly.' }); return; }
      const authorName = safeText(session.displayName, 60) || (session.role === 'student' ? 'Student' : session.role === 'hod' ? 'HOD' : session.role === 'admin' ? 'Administrator' : 'Faculty');
      const note = { id: crypto.randomUUID(), authorName, authorRole: session.role, message, createdAt: new Date().toISOString() };
      if (session.role !== 'student') {
        item.firstStaffResponseAt ||= item.reviewedAt || note.createdAt;
        item.firstStaffResponseByName ||= item.reviewedByName || authorName;
      }
      item.notes.push(note); writeCampusLife(data); sendJson(res, 201, { id: note.id, createdAt: note.createdAt }); return;
    }
    const maintenanceAction = pathname.match(/^\/api\/campus-life\/maintenance\/([a-f0-9-]+)\/action$/i);
    if (maintenanceAction && req.method === 'POST') {
      const session = getSession(req);
      if (!session || !['teacher', 'hod', 'admin'].includes(session.role)) { sendJson(res, 401, { error: 'Sign in as faculty or administrator to review campus reports.' }); return; }
      const body = await readJson(req);
      if (!['in-progress', 'resolved', 'set-priority'].includes(body.action)) { sendJson(res, 400, { error: 'Choose an available status or priority update.' }); return; }
      const data = readCampusLife(), item = data.maintenance.find(entry => entry.id === maintenanceAction[1] && (session.role === 'admin' || entry.campusKey === session.campusKey));
      if (!item) { sendJson(res, 404, { error: 'Campus issue report not found.' }); return; }
      if (body.action === 'set-priority') {
        if (!['normal', 'high', 'urgent'].includes(String(body.priority || '').toLowerCase())) { sendJson(res, 400, { error: 'Choose normal, high, or urgent priority.' }); return; }
        item.priority = String(body.priority).toLowerCase();
        item.responseTargetHours = Math.min(Number(item.responseTargetHours) || MAINTENANCE_RESPONSE_TARGET_HOURS[normalizeMaintenancePriority(item.priority)], MAINTENANCE_RESPONSE_TARGET_HOURS[item.priority]);
        item.priorityUpdatedAt = new Date().toISOString(); item.priorityUpdatedByName = safeText(session.displayName, 60) || (session.role === 'hod' ? 'HOD' : session.role === 'admin' ? 'Administrator' : 'Faculty');
      } else {
        const reviewerName = safeText(session.displayName, 60) || (session.role === 'hod' ? 'HOD' : session.role === 'admin' ? 'Administrator' : 'Faculty');
        const now = new Date().toISOString();
        item.firstStaffResponseAt ||= item.reviewedAt || now;
        item.firstStaffResponseByName ||= item.reviewedByName || reviewerName;
        item.status = body.action; item.reviewedAt = now; item.reviewedByName = reviewerName;
      }
      writeCampusLife(data); sendJson(res, 200, { ok: true, status: item.status, priority: item.priority }); return;
    }
    if (pathname === '/api/campus-life/events/rsvp' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in as a student to register for an event.' }); return; }
      const body = await readJson(req), data = readCampusLife(), event = data.events.find(item => item.id === String(body.eventId || '') && item.status === 'published' && (item.campusKey === session.campusKey || item.campusKey === 'all'));
      if (!event) { sendJson(res, 404, { error: 'This event is no longer available.' }); return; }
      if (event.date < campusLocalDate()) { sendJson(res, 400, { error: 'Registration for this event has closed.' }); return; }
      const existing = data.rsvps.findIndex(item => item.eventId === event.id && item.studentId === session.userId);
      if (existing >= 0 && data.eventCheckins.some(item => item.eventId === event.id && item.studentId === session.userId)) { sendJson(res, 409, { error: 'You already checked in; your event registration is locked.' }); return; }
      if (existing >= 0) data.rsvps.splice(existing, 1); else data.rsvps.push({ eventId: event.id, studentId: session.userId, campusKey: session.campusKey, createdAt: new Date().toISOString() });
      writeCampusLife(data); sendJson(res, 200, { registered: existing < 0 }); return;
    }
    if (pathname === '/api/campus-life/events/checkin' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in as a student to check in.' }); return; }
      const body = await readJson(req), data = readCampusLife(), event = data.events.find(item => item.id === String(body.eventId || '') && item.status === 'published' && item.date === campusLocalDate() && (item.campusKey === session.campusKey || item.campusKey === 'all'));
      if (!event) { sendJson(res, 400, { error: 'Check-in is available only on the published event date for your institute.' }); return; }
      const submittedCode = String(body.code || '').trim().toUpperCase(), submittedHash = crypto.createHash('sha256').update(submittedCode).digest('hex');
      const hashMatches = Boolean(event.checkinCodeHash && submittedHash.length === event.checkinCodeHash.length && crypto.timingSafeEqual(Buffer.from(submittedHash), Buffer.from(event.checkinCodeHash)));
      if (!hashMatches) { sendJson(res, 403, { error: 'Enter the current check-in code provided by the event organizer at the venue.' }); return; }
      if (!data.rsvps.some(item => item.eventId === event.id && item.studentId === session.userId && item.campusKey === session.campusKey)) { sendJson(res, 403, { error: 'Register for this event before checking in.' }); return; }
      if (data.eventCheckins.some(item => item.eventId === event.id && item.studentId === session.userId)) { sendJson(res, 409, { error: 'You have already checked in to this event.' }); return; }
      data.eventCheckins.unshift({ eventId: event.id, studentId: session.userId, studentName: safeText(session.displayName, 60) || 'Student', campusKey: session.campusKey, checkedInAt: new Date().toISOString() });
      writeCampusLife(data); sendJson(res, 201, { ok: true, checkedInAt: campusLocalDate() }); return;
    }
    if (pathname === '/api/campus-life/notices' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to publish campus notices.' }); return; }
      const body = await readJson(req), type = ['event', 'workshop', 'club', 'alert'].includes(body.type) ? body.type : '', title = safeText(body.title, 120), details = safeText(body.details, 1000), benefits = safeText(body.benefits, 600), checkinCode = String(body.checkinCode || '').trim().toUpperCase(), campusKey = body.campusKey === 'all' ? 'all' : String(body.campusKey || '');
      if (!type || title.length < 3 || details.length < 8 || (campusKey !== 'all' && !CAMPUS_KEYS.includes(campusKey))) { sendJson(res, 400, { error: 'Add a valid notice type, title, details, and campus.' }); return; }
      const date = String(body.date || '');
      if (type !== 'alert' && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(`${date}T12:00:00`).getTime()) || date < campusLocalDate())) { sendJson(res, 400, { error: 'Choose a valid event date today or later.' }); return; }
      if (type !== 'alert' && !/^[A-Z0-9-]{4,12}$/.test(checkinCode)) { sendJson(res, 400, { error: 'Set a 4–12 character onsite check-in code and share it with attendees at the venue.' }); return; }
      const data = readCampusLife(), collection = type === 'alert' ? data.alerts : data.events;
      const item = { id: crypto.randomUUID(), type, title, details, benefits, ...(type === 'alert' ? {} : { checkinCodeHash: crypto.createHash('sha256').update(checkinCode).digest('hex') }), campusKey, date: type === 'alert' ? '' : date, location: safeText(body.location, 160), status: type === 'alert' ? 'active' : 'published', createdAt: new Date().toISOString() };
      collection.unshift(item); writeCampusLife(data); sendJson(res, 201, { id: item.id, status: item.status }); return;
    }
    const noticeArchive = pathname.match(/^\/api\/campus-life\/notices\/([a-f0-9-]+)\/archive$/i);
    if (noticeArchive && req.method === 'POST') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') { sendJson(res, 401, { error: 'Administrator sign-in is required to close a campus notice.' }); return; }
      const data = readCampusLife(), notice = [...data.events, ...data.alerts].find(item => item.id === noticeArchive[1]);
      if (!notice) { sendJson(res, 404, { error: 'Campus notice was not found.' }); return; }
      notice.status = 'archived'; notice.archivedAt = new Date().toISOString(); writeCampusLife(data); sendJson(res, 200, { ok: true }); return;
    }
    if (req.method === 'GET' && pathname === '/api/fees/catalog') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in to view your fee schedule.' }); return; }
      const schedule = FEE_SCHEDULE[session.campusKey] || {};
      sendJson(res, 200, { fees: ['Tuition Fee', 'University Examination Fee', 'Bus Transport Fee'].map(category => ({ category, amount: Number.isInteger(schedule[category]) && schedule[category] > 0 ? schedule[category] : null })) });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/fees/payments/order') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in to the student portal before paying fees.' }); return; }
      if (!razorpayConfigured()) { sendJson(res, 503, { error: 'Fee gateway is not configured. The institute must set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the backend.' }); return; }
      const body = await readJson(req);
      const categories = ['Tuition Fee', 'University Examination Fee', 'Bus Transport Fee'];
      const category = safeText(body.category, 80);
      const amount = Number(body.amount);
      const scheduledAmount = Number(FEE_SCHEDULE[session.campusKey]?.[category]);
      if (!categories.includes(category)) { sendJson(res, 400, { error: 'Choose a valid fee category.' }); return; }
      if (!Number.isInteger(scheduledAmount) || scheduledAmount < 1 || scheduledAmount > 1000000) { sendJson(res, 503, { error: 'This fee amount has not been configured by the institute finance office yet.' }); return; }
      if (amount !== scheduledAmount) { sendJson(res, 400, { error: 'The amount does not match the institute fee schedule. Refresh your fees.' }); return; }
      const order = await razorpayRequest('/orders', 'POST', {
        amount: amount * 100, currency: 'INR', receipt: `fee_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
        notes: { category, campusKey: session.campusKey, studentId: session.userId }
      });
      const payments = readJsonArray(FEE_PAYMENTS_FILE);
      payments.unshift({ orderId: order.id, receipt: order.receipt, category, amountPaise: order.amount, currency: order.currency, campusKey: session.campusKey, studentId: session.userId, status: 'created', createdAt: new Date().toISOString() });
      writeJsonArray(FEE_PAYMENTS_FILE, payments);
      sendJson(res, 201, { orderId: order.id, receipt: order.receipt, amount: order.amount, currency: order.currency, keyId: RAZORPAY_KEY_ID });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/fees/payments/verify') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in to verify fee payment.' }); return; }
      if (!razorpayConfigured()) { sendJson(res, 503, { error: 'The fee gateway is not configured.' }); return; }
      const body = await readJson(req);
      const orderId = String(body.razorpay_order_id || '');
      const paymentId = String(body.razorpay_payment_id || '');
      const signature = String(body.razorpay_signature || '');
      const payments = readJsonArray(FEE_PAYMENTS_FILE);
      const record = payments.find(item => item.orderId === orderId && item.studentId === session.userId && item.campusKey === session.campusKey);
      if (!record) { sendJson(res, 404, { error: 'Fee order not found for this student.' }); return; }
      if (record.status === 'paid') { sendJson(res, 200, { receipt: record.receipt, amountPaise: record.amountPaise }); return; }
      if (!verifyRazorpaySignature(orderId, paymentId, signature)) { sendJson(res, 400, { error: 'Payment signature verification failed.' }); return; }
      const payment = await getCapturedRazorpayPayment(paymentId, orderId, record.amountPaise);
      if (!payment) {
        sendJson(res, 409, { error: 'Payment is not captured for the expected fee amount.' }); return;
      }
      record.status = 'paid'; record.paymentId = paymentId; record.paidAt = new Date().toISOString();
      writeJsonArray(FEE_PAYMENTS_FILE, payments);
      sendJson(res, 200, { receipt: record.receipt, amountPaise: record.amountPaise, category: record.category, paidAt: record.paidAt });
      return;
    }
    const canteenOrderRoute = pathname.match(/^\/api\/canteen\/orders\/([a-f0-9-]+)(?:\/(status))?$/i);
    if (pathname === '/api/canteen/orders' && req.method === 'GET') {
      const session = getSession(req);
      if (!session) { sendJson(res, 401, { error: 'Sign in through your campus portal to place or view food orders.' }); return; }
      if (['school', 'kmlps'].includes(session.campusKey)) { sendJson(res, 403, { error: 'Canteen booking is not available for school portals.' }); return; }
      const allOrders = readJsonArray(CANTEEN_ORDERS_FILE);
      const canManage = ['teacher', 'hod', 'admin'].includes(session.role);
      const orders = allOrders.filter(order => session.role === 'admin' || (order.campusKey === session.campusKey && (canManage || order.userId === session.userId)));
      sendJson(res, 200, { orders, canManage, user: { displayName: session.displayName, campusKey: session.campusKey, role: session.role } });
      return;
    }
    if (pathname === '/api/canteen/orders' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || !['student', 'teacher', 'hod'].includes(session.role)) { sendJson(res, 401, { error: 'Sign in through a college student or teacher portal before placing an order.' }); return; }
      if (['school', 'kmlps'].includes(session.campusKey)) { sendJson(res, 403, { error: 'Canteen booking is not available for school portals.' }); return; }
      const body = await readJson(req, 20 * 1024);
      const menu = {
        'veg-sandwich': ['Veg Sandwich', 90], 'masala-dosa': ['Masala Dosa', 70], 'veg-puff': ['Vegetable Puff', 25],
        'fruit-bowl': ['Fresh Fruit Bowl', 60], 'paneer-roll': ['Paneer Kathi Roll', 95], 'lemon-rice': ['Lemon Rice', 65],
        'chicken-wrap': ['Chicken Wrap', 120], 'egg-puff': ['Egg Puff', 35], 'tea': ['Tea', 15],
        'coffee': ['Coffee', 25], 'lime-juice': ['Fresh Lime Juice', 30], 'buttermilk': ['Spiced Buttermilk', 20]
      };
      const incoming = Array.isArray(body.items) ? body.items : [];
      if (!incoming.length || incoming.length > 12) { sendJson(res, 400, { error: 'Add at least one menu item before placing the order.' }); return; }
      const quantities = new Map();
      for (const row of incoming) {
        const id = String(row?.id || ''), quantity = Number(row?.quantity);
        if (!menu[id] || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) { sendJson(res, 400, { error: 'One or more menu items or quantities are invalid.' }); return; }
        quantities.set(id, (quantities.get(id) || 0) + quantity);
      }
      const itemCount = [...quantities.values()].reduce((sum, quantity) => sum + quantity, 0);
      if (itemCount > 20) { sendJson(res, 400, { error: 'An order can contain up to 20 items.' }); return; }
      const pickupTime = Date.parse(String(body.pickupAt || ''));
      if (!Number.isFinite(pickupTime) || pickupTime < Date.now() + 5 * 60 * 1000 || pickupTime > Date.now() + 7 * 24 * 60 * 60 * 1000) {
        sendJson(res, 400, { error: 'Choose a pickup time at least five minutes from now and within the next seven days.' }); return;
      }
      const items = [...quantities].map(([id, quantity]) => ({ id, name: menu[id][0], quantity, unitPrice: menu[id][1], lineTotal: quantity * menu[id][1] }));
      const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
      const orders = readJsonArray(CANTEEN_ORDERS_FILE);
      const idempotencyKey = safeText(body.idempotencyKey, 80);
      const duplicate = idempotencyKey && orders.find(order => order.userId === session.userId && order.idempotencyKey === idempotencyKey);
      if (duplicate) { sendJson(res, 200, duplicate); return; }
      const order = {
        id: crypto.randomUUID(), code: `FC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        campusKey: session.campusKey, userId: session.userId, customerName: safeText(session.displayName, 60) || 'Portal user',
        role: session.role, items, itemCount, total, pickupAt: new Date(pickupTime).toISOString(),
        pickupPoint: safeText(body.pickupPoint, 80) || 'Main Canteen Counter',
        note: safeText(body.note, 240), paymentMethod: 'pay-at-counter', status: 'ordered',
        idempotencyKey, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      orders.unshift(order); writeJsonArray(CANTEEN_ORDERS_FILE, orders);
      sendJson(res, 201, order); return;
    }
    if (canteenOrderRoute && canteenOrderRoute[2] === 'status' && req.method === 'POST') {
      const session = getSession(req);
      if (!session || !['teacher', 'hod', 'admin'].includes(session.role)) { sendJson(res, 401, { error: 'Staff sign-in is required to update kitchen order status.' }); return; }
      const body = await readJson(req, 4 * 1024), nextStatus = String(body.status || '');
      if (!['accepted', 'preparing', 'ready', 'collected'].includes(nextStatus)) { sendJson(res, 400, { error: 'Choose a valid kitchen status.' }); return; }
      const orders = readJsonArray(CANTEEN_ORDERS_FILE), order = orders.find(item => item.id === canteenOrderRoute[1]);
      if (!order || (session.role !== 'admin' && order.campusKey !== session.campusKey)) { sendJson(res, 404, { error: 'Kitchen order was not found for this campus.' }); return; }
      const allowed = { ordered: ['accepted'], accepted: ['preparing'], preparing: ['ready'], ready: ['collected'] };
      if (!allowed[order.status]?.includes(nextStatus)) { sendJson(res, 409, { error: 'This order can no longer move to that status.' }); return; }
      order.status = nextStatus; order.updatedAt = new Date().toISOString(); order.updatedBy = session.userId;
      writeJsonArray(CANTEEN_ORDERS_FILE, orders); sendJson(res, 200, order); return;
    }
    if (canteenOrderRoute && !canteenOrderRoute[2] && req.method === 'DELETE') {
      const session = getSession(req);
      if (!session) { sendJson(res, 401, { error: 'Sign in to cancel this order.' }); return; }
      const orders = readJsonArray(CANTEEN_ORDERS_FILE), order = orders.find(item => item.id === canteenOrderRoute[1]);
      if (!order || order.userId !== session.userId || order.campusKey !== session.campusKey) { sendJson(res, 404, { error: 'Your food order was not found.' }); return; }
      if (order.status !== 'ordered') { sendJson(res, 409, { error: 'An order can only be cancelled before the kitchen accepts it.' }); return; }
      order.status = 'cancelled'; order.updatedAt = new Date().toISOString();
      writeJsonArray(CANTEEN_ORDERS_FILE, orders); sendJson(res, 200, order); return;
    }

    if (pathname === '/api/skill-learning/offers' && req.method === 'GET') {
      const session = requireStudent(req, res); if (!session) return;
      const offers = readJsonArray(SKILL_OFFERS_FILE).filter(item => item.campusKey !== 'school' && item.campusKey !== 'kmlps' && item.status === 'active');
      sendJson(res, 200, offers.map(({ id, skill, description, mode, exchangeSkill, cashPrice, campusKey, displayName, createdAt, ownerId }) => ({ id, skill, description, mode, exchangeSkill, cashPrice, campusKey, displayName, createdAt, isMine: ownerId === session.userId })));
      return;
    }
    if (pathname === '/api/skill-learning/offers' && req.method === 'POST') {
      const session = requireStudent(req, res); if (!session) return;
      const body = await readJson(req);
      const skill = safeText(body.skill, 100), description = safeText(body.description, 800);
      const mode = body.mode === 'cash' ? 'cash' : body.mode === 'exchange' ? 'exchange' : '';
      const displayName = safeText(body.displayName, 60);
      const cashPrice = Number(body.cashPrice);
      const exchangeSkill = safeText(body.exchangeSkill, 100);
      if (skill.length < 2 || description.length < 5 || !displayName || !mode || (mode === 'exchange' && !exchangeSkill) || (mode === 'cash' && (!Number.isInteger(cashPrice) || cashPrice < 1 || cashPrice > 100000))) {
        sendJson(res, 400, { error: 'Add your name, skill, details, and valid exchange or cash terms.' }); return;
      }
      const offers = readJsonArray(SKILL_OFFERS_FILE);
      const offer = { id: crypto.randomUUID(), ownerId: session.userId, campusKey: session.campusKey, displayName, skill, description, mode, exchangeSkill: mode === 'exchange' ? exchangeSkill : '', cashPrice: mode === 'cash' ? cashPrice : null, status: 'active', createdAt: new Date().toISOString() };
      offers.unshift(offer); writeJsonArray(SKILL_OFFERS_FILE, offers);
      sendJson(res, 201, { id: offer.id, skill, description, mode, exchangeSkill: offer.exchangeSkill, cashPrice: offer.cashPrice, campusKey: offer.campusKey, displayName, createdAt: offer.createdAt });
      return;
    }
    const skillRequestMatch = pathname.match(/^\/api\/skill-learning\/offers\/([a-f0-9-]+)\/requests$/i);
    if (skillRequestMatch && req.method === 'POST') {
      const session = requireStudent(req, res); if (!session) return;
      const offers = readJsonArray(SKILL_OFFERS_FILE), offer = offers.find(item => item.id === skillRequestMatch[1] && item.status === 'active');
      if (!offer) { sendJson(res, 404, { error: 'Skill offer not found.' }); return; }
      if (offer.ownerId === session.userId) { sendJson(res, 400, { error: 'You cannot request your own skill offer.' }); return; }
      const requests = readJsonArray(SKILL_REQUESTS_FILE);
      if (requests.some(item => item.offerId === offer.id && item.learnerId === session.userId && !['declined', 'completed'].includes(item.status))) { sendJson(res, 409, { error: 'You already have an open request for this offer.' }); return; }
      const body = await readJson(req);
      const request = { id: crypto.randomUUID(), offerId: offer.id, learnerId: session.userId, learnerDisplayName: safeText(body.displayName, 60) || 'Student', ownerId: offer.ownerId, campusKey: offer.campusKey, learnerCampusKey: session.campusKey, message: safeText(body.message, 500), status: 'pending', paymentStatus: 'unpaid', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      requests.unshift(request); writeJsonArray(SKILL_REQUESTS_FILE, requests);
      sendJson(res, 201, { id: request.id, status: request.status }); return;
    }
    if (pathname === '/api/skill-learning/requests' && req.method === 'GET') {
      const session = requireStudent(req, res); if (!session) return;
      const offers = readJsonArray(SKILL_OFFERS_FILE), requests = readJsonArray(SKILL_REQUESTS_FILE);
      const incoming = requests.filter(item => item.ownerId === session.userId).map(({ learnerId, ownerId, ...item }) => ({ ...item, offer: offers.find(offer => offer.id === item.offerId) ? (({ ownerId, ...safe }) => safe)(offers.find(offer => offer.id === item.offerId)) : null }));
      const outgoing = requests.filter(item => item.learnerId === session.userId).map(({ learnerId, ownerId, ...item }) => ({ ...item, offer: offers.find(offer => offer.id === item.offerId) ? (({ ownerId, ...safe }) => safe)(offers.find(offer => offer.id === item.offerId)) : null }));
      sendJson(res, 200, { incoming, outgoing }); return;
    }
    const skillActionMatch = pathname.match(/^\/api\/skill-learning\/requests\/([a-f0-9-]+)\/action$/i);
    if (skillActionMatch && req.method === 'POST') {
      const session = requireStudent(req, res); if (!session) return;
      const body = await readJson(req);
      if (!['accept', 'decline'].includes(body.action)) { sendJson(res, 400, { error: 'Choose accept or decline.' }); return; }
      const requests = readJsonArray(SKILL_REQUESTS_FILE), request = requests.find(item => item.id === skillActionMatch[1] && item.ownerId === session.userId);
      if (!request) { sendJson(res, 404, { error: 'Incoming learning request not found.' }); return; }
      if (request.status !== 'pending') { sendJson(res, 409, { error: 'This request already has a decision.' }); return; }
      request.status = body.action === 'accept' ? 'accepted' : 'declined'; request.updatedAt = new Date().toISOString();
      writeJsonArray(SKILL_REQUESTS_FILE, requests); sendJson(res, 200, { ok: true, status: request.status }); return;
    }
    const skillMessagesMatch = pathname.match(/^\/api\/skill-learning\/requests\/([a-f0-9-]+)\/messages$/i);
    if (skillMessagesMatch && ['GET', 'POST'].includes(req.method)) {
      const session = requireStudent(req, res); if (!session) return;
      const request = readJsonArray(SKILL_REQUESTS_FILE).find(item => item.id === skillMessagesMatch[1] && [item.ownerId, item.learnerId].includes(session.userId));
      if (!request) { sendJson(res, 404, { error: 'Private skill chat not found.' }); return; }
      if (request.status !== 'accepted') { sendJson(res, 409, { error: 'The skill provider must accept before private chat opens.' }); return; }
      const messages = readJsonArray(SKILL_MESSAGES_FILE);
      if (req.method === 'GET') { sendJson(res, 200, messages.filter(item => item.requestId === request.id).map(({ id, requestId, senderId, body, createdAt }) => ({ id, requestId, isMine: senderId === session.userId, body, createdAt }))); return; }
      const body = await readJson(req), message = safeText(body.body, 1000);
      if (!message) { sendJson(res, 400, { error: 'Enter a message.' }); return; }
      const item = { id: crypto.randomUUID(), requestId: request.id, senderId: session.userId, body: message, createdAt: new Date().toISOString() };
      messages.push(item); writeJsonArray(SKILL_MESSAGES_FILE, messages); sendJson(res, 201, { id: item.id, isMine: true, body: item.body, createdAt: item.createdAt }); return;
    }
    const skillPayOrderMatch = pathname.match(/^\/api\/skill-learning\/requests\/([a-f0-9-]+)\/payments\/order$/i);
    if (skillPayOrderMatch && req.method === 'POST') {
      const session = requireStudent(req, res); if (!session) return;
      if (!razorpayConfigured()) { sendJson(res, 503, { error: 'Skill payment gateway needs institute Razorpay credentials and provider-linked payout accounts.' }); return; }
      const requests = readJsonArray(SKILL_REQUESTS_FILE), request = requests.find(item => item.id === skillPayOrderMatch[1] && item.learnerId === session.userId && item.status === 'accepted');
      if (!request) { sendJson(res, 404, { error: 'Accepted paid skill request not found.' }); return; }
      const offer = readJsonArray(SKILL_OFFERS_FILE).find(item => item.id === request.offerId);
      const linkedAccount = SKILL_ROUTE_ACCOUNTS[request.ownerId];
      if (!offer || offer.mode !== 'cash' || !linkedAccount || !/^acc_[A-Za-z0-9]+$/.test(linkedAccount)) { sendJson(res, 503, { error: 'This provider has no configured Razorpay Route linked account. Use the private chat to agree on cash terms instead.' }); return; }
      const order = await razorpayRequest('/orders', 'POST', { amount: offer.cashPrice * 100, currency: 'INR', receipt: `skill_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`, notes: { requestId: request.id, offerId: offer.id } });
      const payments = readJsonArray(SKILL_PAYMENTS_FILE); payments.unshift({ orderId: order.id, requestId: request.id, learnerId: session.userId, providerId: request.ownerId, linkedAccount, amountPaise: order.amount, currency: order.currency, status: 'created', createdAt: new Date().toISOString() }); writeJsonArray(SKILL_PAYMENTS_FILE, payments);
      sendJson(res, 201, { orderId: order.id, amount: order.amount, currency: order.currency, keyId: RAZORPAY_KEY_ID, skill: offer.skill }); return;
    }
    const skillPayVerifyMatch = pathname.match(/^\/api\/skill-learning\/requests\/([a-f0-9-]+)\/payments\/verify$/i);
    if (skillPayVerifyMatch && req.method === 'POST') {
      const session = requireStudent(req, res); if (!session) return;
      const body = await readJson(req), orderId = String(body.razorpay_order_id || ''), paymentId = String(body.razorpay_payment_id || ''), signature = String(body.razorpay_signature || '');
      const payments = readJsonArray(SKILL_PAYMENTS_FILE), record = payments.find(item => item.orderId === orderId && item.requestId === skillPayVerifyMatch[1] && item.learnerId === session.userId);
      if (!record) { sendJson(res, 404, { error: 'Skill payment order not found.' }); return; }
      if (record.status === 'paid') { sendJson(res, 200, { ok: true, paymentId: record.paymentId, status: record.status }); return; }
      if (record.status === 'transferring') { sendJson(res, 409, { error: 'The provider payout is being reconciled. Do not retry this payment; contact the portal office if it remains pending.' }); return; }
      if (!verifyRazorpaySignature(orderId, paymentId, signature)) { sendJson(res, 400, { error: 'Payment signature verification failed.' }); return; }
      const payment = await getCapturedRazorpayPayment(paymentId, orderId, record.amountPaise);
      if (!payment) { sendJson(res, 409, { error: 'Skill payment is not captured for the expected amount.' }); return; }
      record.status = 'transferring'; record.paymentId = paymentId; writeJsonArray(SKILL_PAYMENTS_FILE, payments);
      const transferResult = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/transfers`, 'POST', { transfers: [{ account: record.linkedAccount, amount: record.amountPaise, currency: 'INR', notes: { requestId: record.requestId } }] });
      record.status = 'paid'; record.paymentId = paymentId; record.transfers = transferResult.items || []; record.paidAt = new Date().toISOString(); writeJsonArray(SKILL_PAYMENTS_FILE, payments);
      const requests = readJsonArray(SKILL_REQUESTS_FILE), request = requests.find(item => item.id === record.requestId); if (request) { request.paymentStatus = 'paid'; writeJsonArray(SKILL_REQUESTS_FILE, requests); }
      sendJson(res, 200, { ok: true, paymentId, status: record.status }); return;
    }
    if (req.method === 'POST' && pathname === '/api/leave-requests') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in as a student to submit a leave request.' }); return; }
      const body = await readJson(req);
      const reason = String(body.reason || '').trim();
      if (!reason || reason.length > 5000) { sendJson(res, 400, { error: 'Enter a reason (up to 5,000 characters).' }); return; }
      const now = new Date().toISOString();
      const request = {
        id: crypto.randomUUID(), requestType: 'Leave Application', studentId: session.userId, campusKey: session.campusKey,
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
    if (req.method === 'POST' && pathname === '/api/gatepasses') {
      const session = getSession(req);
      if (!session || !['student', 'teacher'].includes(session.role)) { sendJson(res, 401, { error: 'Sign in to a student or teacher portal to request a gate pass.' }); return; }
      const body = await readJson(req);
      const destination = String(body.destination || '').trim().slice(0, 180);
      const mentorName = String(body.mentorName || '').trim().slice(0, 120);
      const reason = String(body.reason || '').trim().slice(0, 2000);
      const departureDate = String(body.departureDate || '').trim();
      const departureTime = String(body.departureTime || '').trim();
      const returnDate = String(body.returnDate || '').trim();
      const returnTime = String(body.returnTime || '').trim();
      const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
      const departure = parseCampusDateTime(departureDate, departureTime);
      const expectedReturn = parseCampusDateTime(returnDate, returnTime);
      if (!destination || !reason || !dateTimePattern.test(`${departureDate}T${departureTime}`) || !dateTimePattern.test(`${returnDate}T${returnTime}`) || Number.isNaN(departure.getTime()) || Number.isNaN(expectedReturn.getTime()) || expectedReturn <= departure) {
        sendJson(res, 400, { error: 'Enter a destination, purpose, departure time, and a return time later than departure.' }); return;
      }
      const now = new Date().toISOString();
      const request = {
        id: crypto.randomUUID(), passCode: `ILH-GP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        requesterRole: session.role, requesterId: session.userId, campusKey: session.campusKey,
        destination, mentorName, reason, departureDate, departureTime, returnDate, returnTime,
        status: 'pending', statusLabel: 'Waiting for HOD Approval',
        createdAt: now, updatedAt: now, approvedAt: null, approvedBy: null,
        history: [{ label: 'Submitted for HOD Approval', actor: session.userId, at: now }]
      };
      const requests = readGatepasses();
      requests.unshift(request);
      writeGatepasses(requests);
      sendJson(res, 201, request);
      return;
    }
    const virtualGatepassCodeMatch = pathname.match(/^\/api\/gatepasses\/([a-f0-9-]+)\/virtual-code$/i);
    if (req.method === 'GET' && virtualGatepassCodeMatch) {
      const session = getSession(req);
      if (!session || !['student', 'teacher', 'hod'].includes(session.role)) { sendJson(res, 401, { error: 'Sign in to view your virtual gate pass.' }); return; }
      const pass = readGatepasses().find(item => item.id === virtualGatepassCodeMatch[1] && item.requesterRole === session.role && item.requesterId === session.userId && item.campusKey === session.campusKey);
      if (!pass || pass.status !== 'approved') { sendJson(res, 404, { error: 'Approved gate pass not found.' }); return; }
      const slot = Math.floor(Date.now() / GATEPASS_CODE_WINDOW_MS);
      sendJson(res, 200, { passId: pass.id, code: gatepassCodeForSlot(pass.id, slot), expiresAt: new Date((slot + 1) * GATEPASS_CODE_WINDOW_MS).toISOString(), refreshSeconds: GATEPASS_CODE_WINDOW_MS / 1000 });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/gatepasses/verify-code') {
      const session = getSession(req);
      if (!session || session.role !== 'hod') { sendJson(res, 401, { error: 'Sign in to the HOD portal to verify a gate pass.' }); return; }
      const body = await readJson(req), passId = String(body.passId || ''), suppliedCode = String(body.code || '').trim();
      const passes = readGatepasses(), pass = passes.find(item => (item.id === passId || item.passCode === passId) && isInSessionCampus(item, session));
      if (!pass || pass.status !== 'approved') { sendJson(res, 404, { error: 'Approved gate pass not found for this campus.' }); return; }
      const now = Date.now(), slot = Math.floor(now / GATEPASS_CODE_WINDOW_MS);
      const departure = parseCampusDateTime(pass.departureDate, pass.departureTime).getTime();
      const expectedReturn = parseCampusDateTime(pass.returnDate, pass.returnTime).getTime();
      if (now < departure || now > expectedReturn) { sendJson(res, 409, { error: 'This pass is outside its approved departure and return time window.' }); return; }
      if (pass.lastVerifiedSlot === slot) { sendJson(res, 409, { error: 'This rotating code was already used. Ask the pass holder to refresh their live pass.' }); return; }
      if (!constantTimeCodeMatch(gatepassCodeForSlot(pass.id, slot), suppliedCode)) { sendJson(res, 400, { error: 'Code is invalid or expired. Ask the pass holder to show the current live code.' }); return; }
      pass.lastVerifiedSlot = slot; pass.lastVerifiedAt = new Date(now).toISOString(); pass.lastVerifiedBy = session.userId;
      pass.history.push({ label: 'Live virtual pass verified at gate', actor: session.userId, at: pass.lastVerifiedAt });
      writeGatepasses(passes);
      sendJson(res, 200, { ok: true, passCode: pass.passCode, requesterRole: pass.requesterRole, requesterId: pass.requesterId, destination: pass.destination, verifiedAt: pass.lastVerifiedAt });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/gatepasses') {
      const session = getSession(req);
      if (!session) { sendJson(res, 401, { error: 'Sign in to view gate pass requests.' }); return; }
      if (session.role === 'admin') { sendJson(res, 403, { error: 'Gate passes are reviewed in the HOD portal.' }); return; }
      let requests = readGatepasses();
      if (['student', 'teacher'].includes(session.role)) requests = requests.filter(item => item.requesterRole === session.role && item.requesterId === session.userId && isInSessionCampus(item, session));
      else requests = [];
      sendJson(res, 200, requests);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/gatepasses/inbox') {
      const session = getSession(req);
      if (!session || session.role !== 'hod') { sendJson(res, 401, { error: 'Sign in as HOD to review campus gate-pass requests.' }); return; }
      const requests = readGatepasses().filter(item => item.status === 'pending' && item.campusKey === session.campusKey && !(item.requesterRole === 'hod' && item.requesterId === session.userId)).map(item => ({ ...item, statusLabel: 'Waiting for HOD Approval' }));
      sendJson(res, 200, requests); return;
    }
    const gatepassActionMatch = pathname.match(/^\/api\/gatepasses\/([a-f0-9-]+)\/action$/i);
    if (req.method === 'POST' && gatepassActionMatch) {
      const session = getSession(req);
      if (!session || session.role !== 'hod') { sendJson(res, 401, { error: 'Sign in as HOD to approve or decline gate passes.' }); return; }
      const body = await readJson(req);
      if (!['approve', 'reject'].includes(body.action)) { sendJson(res, 400, { error: 'Choose approve or decline.' }); return; }
      const requests = readGatepasses();
      const request = requests.find(item => item.id === gatepassActionMatch[1] && isInSessionCampus(item, session));
      if (!request) { sendJson(res, 404, { error: 'Gate pass request not found.' }); return; }
      if (request.requesterRole === 'hod' && request.requesterId === session.userId) { sendJson(res, 403, { error: 'HODs cannot approve their own gate-pass requests.' }); return; }
      if (request.status !== 'pending') { sendJson(res, 409, { error: 'This gate pass request has already been decided.' }); return; }
      const now = new Date().toISOString();
      request.status = body.action === 'approve' ? 'approved' : 'rejected';
      request.statusLabel = body.action === 'approve' ? 'Approved by HOD' : 'Declined by HOD';
      request.updatedAt = now;
      request.approvedAt = body.action === 'approve' ? now : null;
      request.approvedBy = body.action === 'approve' ? session.userId : null;
      request.history.push({ label: request.statusLabel, actor: session.userId, at: now });
      writeGatepasses(requests);
      sendJson(res, 200, request);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/leave-requests') {
      const session = getSession(req);
      if (!session) { sendJson(res, 401, { error: 'Sign in to view leave requests.' }); return; }
      let requests = readLeaveRequests();
      if (session.role === 'student') requests = requests.filter(item => item.studentId === session.userId && isInSessionCampus(item, session));
      else if (session.role === 'teacher') requests = requests.filter(item => item.status === 'mentor_pending' && isInSessionCampus(item, session));
      else if (session.role === 'hod') requests = requests.filter(item => item.status === 'hod_pending' && isInSessionCampus(item, session));
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
      const request = requests.find(item => item.id === leaveActionMatch[1] && isInSessionCampus(item, session));
      if (!request) { sendJson(res, 404, { error: 'Leave request not found.' }); return; }
      const transitions = {
        teacher: { forward: ['mentor_pending', 'hod_pending', 'Forwarded to HOD'] },
        hod: {
          approve: ['hod_pending', 'approved', 'Approved by HOD'],
          reject: ['hod_pending', 'rejected', 'Declined by HOD'],
          forward: ['hod_pending', 'office_pending', 'Forwarded to Office']
        },
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
    if (pathname === '/api/ai-knowledge/sync-status' && req.method === 'GET') {
      const role = requireStaff(req, res, ['admin']);
      if (!role) return;
      sendJson(res, 200, { ...aiSyncStatus, inProgress: officialSiteSyncInProgress, intervalHours: 24, sourceCount: OFFICIAL_INSTITUTION_SOURCES.length });
      return;
    }
    if (pathname === '/api/ai-knowledge/sync' && req.method === 'POST') {
      const role = requireStaff(req, res, ['admin']);
      if (!role) return;
      if (officialSiteSyncInProgress) { sendJson(res, 202, { ...aiSyncStatus, inProgress: true }); return; }
      syncOfficialCollegeKnowledge().catch(error => console.error('[AI knowledge] Manual refresh failed:', error));
      sendJson(res, 202, { ...aiSyncStatus, inProgress: true });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/ai-knowledge') {
      const audience = url.searchParams.get('audience');
      const session = getSession(req);
      if (audience === 'admin') {
        if (!session || session.role !== 'admin') { sendJson(res, 403, { error: 'Administrator sign-in is required to manage the full AI database.' }); return; }
        sendJson(res, 200, readEntries());
        return;
      }
      if (audience === 'students' && !session) { sendJson(res, 200, []); return; }
      let entries = readEntries();
      if (session && session.role !== 'admin') entries = entries.filter(entry => !entry.campusKey || entry.campusKey === session.campusKey);
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
      if (!['all', 'students'].includes(body.audience)) { sendJson(res, 400, { error: 'Choose a valid AI audience.' }); return; }
      const audience = body.audience === 'students' ? 'students' : 'all';
      const entry = {
        id: crypto.randomUUID(), title: title.slice(0, 180), content: content.slice(0, 150000), campusKey: getSession(req)?.campusKey || null,
        category: String(body.category || 'general').slice(0, 80), audience,
        source: String(body.source || 'Faculty note').slice(0, 180),
        tags: Array.isArray(body.tags) ? body.tags.map(tag => String(tag).slice(0, 50)).slice(0, 30) : [],
        attachmentPath: safeUploadPath(body.attachmentPath) ? body.attachmentPath : null,
        attachmentName: String(body.attachmentName || '').slice(0, 180),
        createdBy: getSession(req)?.userId || null,
        createdAt: new Date().toISOString()
      };
      const entries = readEntries();
      entries.unshift(entry);
      writeEntries(entries);
      sendJson(res, 201, entry);
      return;
    }
    const deleteMatch = pathname.match(/^\/api\/ai-knowledge\/([a-z0-9_-]+)$/i);
    if (req.method === 'DELETE' && deleteMatch) {
      const role = requireStaff(req, res);
      if (!role) return;
      const entries = readEntries();
      const entry = entries.find(item => String(item.id) === deleteMatch[1]);
      const actor = getSession(req);
      if (!entry) { sendJson(res, 404, { error: 'Knowledge entry not found.' }); return; }
      if (role !== 'admin' && (entry.audience !== 'students' || entry.campusKey !== actor?.campusKey || (entry.createdBy && entry.createdBy !== actor?.userId))) {
        sendJson(res, 403, { error: 'You can delete only student notes you created for your campus.' }); return;
      }
      const remainingEntries = entries.filter(item => String(item.id) !== deleteMatch[1]);
      writeEntries(remainingEntries);
      if (entry.attachmentPath && !remainingEntries.some(item => item.attachmentPath === entry.attachmentPath)) {
        const attachmentFile = safeUploadPath(entry.attachmentPath);
        if (attachmentFile && fs.existsSync(attachmentFile)) fs.unlinkSync(attachmentFile);
      }
      writeDeletedKnowledgeIds([...readDeletedKnowledgeIds(), deleteMatch[1]]);
      sendJson(res, 204, null);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/certificates') {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in to view your certificate locker.' }); return; }
      const certificates = readJsonArray(CERTIFICATES_FILE).filter(item => item.studentId === session.userId && item.campusKey === session.campusKey).map(({ studentId, ...item }) => item);
      sendJson(res, 200, certificates); return;
    }
    const certificateFileMatch = pathname.match(/^\/api\/certificates\/([a-f0-9-]+)\/file$/i);
    if (req.method === 'GET' && certificateFileMatch) {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in to view this certificate.' }); return; }
      const item = readJsonArray(CERTIFICATES_FILE).find(entry => entry.id === certificateFileMatch[1] && entry.studentId === session.userId && entry.campusKey === session.campusKey);
      const file = item && safeUploadPath(item.attachmentPath);
      if (!item || !file || !fs.existsSync(file)) { sendJson(res, 404, { error: 'Certificate not found for this account.' }); return; }
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' });
      fs.createReadStream(file).pipe(res); return;
    }
    const certificateDeleteMatch = pathname.match(/^\/api\/certificates\/([a-f0-9-]+)$/i);
    if (req.method === 'DELETE' && certificateDeleteMatch) {
      const session = getSession(req);
      if (!session || session.role !== 'student') { sendJson(res, 401, { error: 'Sign in to manage your certificate locker.' }); return; }
      const certificates = readJsonArray(CERTIFICATES_FILE), item = certificates.find(entry => entry.id === certificateDeleteMatch[1] && entry.studentId === session.userId && entry.campusKey === session.campusKey);
      if (!item) { sendJson(res, 404, { error: 'Certificate not found for this account.' }); return; }
      writeJsonArray(CERTIFICATES_FILE, certificates.filter(entry => entry.id !== item.id));
      if (item.attachmentPath && !readJsonArray(CERTIFICATES_FILE).some(entry => entry.attachmentPath === item.attachmentPath)) { const file = safeUploadPath(item.attachmentPath); if (file && fs.existsSync(file)) fs.unlinkSync(file); }
      sendJson(res, 200, { ok: true }); return;
    }
    if (req.method === 'POST' && pathname === '/api/storage/uploads/request-url') {
      const session = getSession(req);
      if (!session || !['student', 'teacher'].includes(session.role)) { sendJson(res, 401, { error: 'Sign in to upload a student certificate or faculty handout.' }); return; }
      const body = await readJson(req), purpose = body.purpose === 'certificate' ? 'certificate' : 'knowledge';
      if ((purpose === 'certificate' && session.role !== 'student') || (purpose === 'knowledge' && session.role !== 'teacher')) { sendJson(res, 403, { error: purpose === 'certificate' ? 'Only a student can upload to their private certificate locker.' : 'Only a teacher can upload a shared study handout.' }); return; }
      if (body.contentType !== 'application/pdf' || !Number.isFinite(body.size) || body.size <= 0 || body.size > MAX_UPLOAD_BYTES) {
        sendJson(res, 400, { error: 'Choose a PDF file smaller than 25 MB.' }); return;
      }
      const certificateTitle = purpose === 'certificate' ? safeText(body.title, 100) : '';
      const certificateCategory = purpose === 'certificate' && ['Course / academic', 'Workshop / certification', 'Internship / placement', 'Achievement', 'Other'].includes(body.category) ? body.category : '';
      if (purpose === 'certificate' && (!certificateTitle || !certificateCategory)) { sendJson(res, 400, { error: 'Choose a certificate title and category.' }); return; }
      const token = crypto.randomBytes(24).toString('hex');
      const objectPath = `/uploads/${crypto.randomUUID()}.pdf`;
      uploadTickets.set(token, { objectPath, expires: Date.now() + 10 * 60 * 1000, name: path.basename(String(body.name || 'document.pdf')).slice(0, 180), requesterId: session.userId, requesterRole: session.role, campusKey: session.campusKey, purpose, certificateTitle, certificateCategory });
      sendJson(res, 200, { uploadURL: `/api/storage/uploads/${token}`, objectPath });
      return;
    }
    const uploadMatch = pathname.match(/^\/api\/storage\/uploads\/([a-f0-9]{48})$/i);
    if (req.method === 'PUT' && uploadMatch) {
      const session = getSession(req);
      const ticket = uploadTickets.get(uploadMatch[1]);
      if (!session || !ticket || ticket.requesterId !== session.userId || ticket.requesterRole !== session.role || ticket.campusKey !== session.campusKey) { sendJson(res, 403, { error: 'This private upload link does not belong to the signed-in account.' }); return; }
      uploadTickets.delete(uploadMatch[1]);
      if (ticket.expires < Date.now()) { sendJson(res, 410, { error: 'Upload link expired. Please try again.' }); return; }
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
      if (ticket.purpose === 'certificate') {
        const certificates = readJsonArray(CERTIFICATES_FILE).filter(item => item.studentId === session.userId && item.campusKey === session.campusKey);
        if (certificates.length >= 50) { fs.unlinkSync(storedPath); sendJson(res, 413, { error: 'Your certificate locker is full. Remove an older certificate before adding another.' }); return; }
        const item = { id: crypto.randomUUID(), studentId: session.userId, campusKey: session.campusKey, title: ticket.certificateTitle, category: ticket.certificateCategory, fileName: ticket.name, attachmentPath: ticket.objectPath, createdAt: new Date().toISOString() };
        const allCertificates = readJsonArray(CERTIFICATES_FILE); allCertificates.unshift(item); writeJsonArray(CERTIFICATES_FILE, allCertificates);
        sendJson(res, 201, { certificate: { id: item.id, title: item.title, category: item.category, fileName: item.fileName, createdAt: item.createdAt } }); return;
      }
      const extractedText = extractPdfText(file);
      sendJson(res, 201, { objectPath: ticket.objectPath, attachmentName: ticket.name, extractedText, hasExtractableText: extractedText.length > 0 });
      return;
    }
    const fileMatch = pathname.match(/^\/api\/storage(\/uploads\/[a-f0-9-]+\.pdf)$/i);
    if (req.method === 'GET' && fileMatch) {
      const session = getSession(req);
      if (!session) { sendJson(res, 401, { error: 'Sign in to view this study material.' }); return; }
      const knowledgeEntry = readEntries().find(entry => entry.attachmentPath === fileMatch[1]);
      if (!knowledgeEntry || (session.role !== 'admin' && knowledgeEntry.campusKey && knowledgeEntry.campusKey !== session.campusKey) || (session.role === 'student' && knowledgeEntry.audience !== 'students')) {
        sendJson(res, 404, { error: 'Study material not found for this account.' }); return;
      }
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
  setTimeout(() => syncOfficialCollegeKnowledge().catch(error => console.error('[AI knowledge] Initial refresh failed:', error)), 3000);
  setInterval(() => syncOfficialCollegeKnowledge().catch(error => console.error('[AI knowledge] Scheduled refresh failed:', error)), OFFICIAL_SITE_REFRESH_MS).unref();
});
