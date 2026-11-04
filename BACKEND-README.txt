ILAHIA ECOSYSTEM PORTAL — BACKEND AND DEPLOYMENT
================================================

LOCAL DEVELOPMENT
-----------------

Requirements: Node.js 18 or newer. The local backend uses Node's built-in
modules and does not require npm packages.

1. Open this folder in VS Code.
2. Open the integrated PowerShell terminal in this folder.
3. Run: node server.js
4. On this computer open: http://127.0.0.1:3001/
5. To open on a phone connected to the same Wi-Fi, run `ipconfig` on the computer,
   find its Wi-Fi IPv4 Address, then open `http://<that-address>:3001/` on the phone.

Keep the terminal open. Local demonstration accounts are supplied by the
development server and shown in the local sign-in flow. These passwords are
for localhost demonstration only. Never reuse them on a public deployment.

The server listens on all network interfaces so a phone on the same Wi-Fi can
open the local demo. Use this only on a trusted private network; demo accounts
are not suitable for public access. Production refuses to start unless
production account configuration is present.

RENDER BLUEPRINT SETUP
---------------------

The included render.yaml now matches the backend's production requirements:
it uses /api/health for health checks, asks for production campus accounts,
requires an administrator account, and generates a gate-pass signing secret.

To deploy a demo:

1. Push this project to a GitHub repository that you control.
2. In Render, create a Blueprint and connect that repository.
3. Select render.yaml. In Render's private environment-variable prompt, enter
   ADMIN_ID and a unique ADMIN_PASSWORD.
4. Enter CAMPUS_ACCOUNTS_JSON as one JSON object. It must contain student,
   teacher and hod accounts for every campus key below. Add a security account
   for every campus under the `security` key. Each account needs a unique ID and
   strong password; displayName is optional. Security sign-in remains disabled
   in production for any campus without a configured account.
5. Keep the generated GATEPASS_CODE_SECRET. Do not commit credentials or
   secret values to GitHub.
6. Deploy and open the HTTPS URL Render provides.

Campus keys:
icet, arts, poly, school, iti, law, pharmacy, kmlps

Example structure only — replace every placeholder with an institution-
approved account before deployment:

{"student":{"icet":{"id":"REPLACE","password":"REPLACE"},"arts":{"id":"REPLACE","password":"REPLACE"},"poly":{"id":"REPLACE","password":"REPLACE"},"school":{"id":"REPLACE","password":"REPLACE"},"iti":{"id":"REPLACE","password":"REPLACE"},"law":{"id":"REPLACE","password":"REPLACE"},"pharmacy":{"id":"REPLACE","password":"REPLACE"},"kmlps":{"id":"REPLACE","password":"REPLACE"}},"teacher":{"icet":{"id":"REPLACE","password":"REPLACE"},"arts":{"id":"REPLACE","password":"REPLACE"},"poly":{"id":"REPLACE","password":"REPLACE"},"school":{"id":"REPLACE","password":"REPLACE"},"iti":{"id":"REPLACE","password":"REPLACE"},"law":{"id":"REPLACE","password":"REPLACE"},"pharmacy":{"id":"REPLACE","password":"REPLACE"},"kmlps":{"id":"REPLACE","password":"REPLACE"}},"hod":{"icet":{"id":"REPLACE","password":"REPLACE"},"arts":{"id":"REPLACE","password":"REPLACE"},"poly":{"id":"REPLACE","password":"REPLACE"},"school":{"id":"REPLACE","password":"REPLACE"},"iti":{"id":"REPLACE","password":"REPLACE"},"law":{"id":"REPLACE","password":"REPLACE"},"pharmacy":{"id":"REPLACE","password":"REPLACE"},"kmlps":{"id":"REPLACE","password":"REPLACE"}}}

STORAGE AND FREE HOSTING LIMITS
------------------------------

This backend currently stores records as JSON files and uploaded PDFs in the
DATA_DIR (by default, the project's data folder). The Render free web service
filesystem is temporary: writes can be lost on restart, redeploy or sleep.
The backup/restore controls are useful for demonstrations and manual recovery,
but they do not make ephemeral storage durable.

Render's free Postgres database currently expires 30 days after creation and
has no backups. It is suitable for a short demo, not ongoing student records.
For a real pilot, first migrate JSON records to a managed, backed-up database
and move PDFs to private durable object storage. That migration is not
implemented yet. Do not upload real certificates, counselling details or
student records to a free ephemeral demo deployment.

OPTIONAL FEE PAYMENT CONFIGURATION
---------------------------------

Fee checkout is disabled until the institution configures an approved
Razorpay merchant account. Use test credentials first. Set secrets only in
the host's private environment settings:

RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
FEE_SCHEDULE_JSON

FEE_SCHEDULE_JSON maps campus keys to finance-office-approved fee categories
and amounts in whole rupees. Configure only confirmed tuition, examination
and bus-transport amounts. Hostel charges are not part of the portal fee
categories. The backend validates orders against the schedule and verifies
the provider payment signature before recording a receipt. Do not add test
or guessed fee amounts to a public deployment.

MessBuzz online canteen checkout uses the same RAZORPAY_KEY_ID and
RAZORPAY_KEY_SECRET. It calculates the order amount from the server-side menu
and adds an order to the kitchen queue only after Razorpay reports a captured,
signature-verified payment. Pay-at-counter remains available without gateway
credentials. Configure and verify Razorpay test-mode credentials before using
online checkout; never put the key secret in browser code or source control.

Skill Learner cash payout additionally requires Razorpay Route and verified
provider-linked accounts. Without those approvals and mappings, users can
coordinate terms in the private portal chat; the app must not collect card
or bank credentials in chat.

GATEPASS SECURITY BOUNDARY
-------------------------

Student gate-pass requests are routed to the selected mentor first. The mentor can edit the destination, purpose, and travel times, then must add a recommendation note before forwarding to the HOD. The HOD makes the final approval or decline decision; the student sees the mentor note and any decline reason. Staff gate-pass requests go to the HOD directly. Approved passes are shown in the requester's portal as a rotating QR. Campus security signs in on the assigned campus device; the persistent HttpOnly security session stays active across browser restarts until security signs out. Use this only on a secured campus device; clearing browser data also ends access. The QR rotates every 30 seconds, is accepted only by the signed-in campus security account, and a successful scan records the student, destination, purpose and travel times, then invalidates the pass. It expires after 10 hours from approval or at the approved return time, whichever comes first. A browser cannot block screenshots or sharing; short-lived codes plus one-scan server validation reduce reuse but cannot prevent someone from showing a still-current capture.

Local-only demo security login: choose a campus, then use its distinct ID `<PREFIX>-SEC-001` and login code `<PREFIX>-SEC-26` (ICET, ARTS, POLY, SCHOOL, ITI, LAW, PHARM, or KMLPS). Never use these demo codes in a public deployment. Production security accounts belong under `CAMPUS_ACCOUNTS_JSON.security` and must be assigned separately for each campus by the institution.

The office can use the protected admin backup/restore workflow. Store exported
backups privately because they contain portal records and uploaded documents.
