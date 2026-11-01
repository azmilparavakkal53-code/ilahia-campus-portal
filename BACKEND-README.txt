ILAHIA ECOSYSTEM PORTAL — BACKEND AND DEPLOYMENT
================================================

LOCAL DEVELOPMENT
-----------------

Requirements: Node.js 18 or newer. The local backend uses Node's built-in
modules and does not require npm packages.

1. Open this folder in VS Code.
2. Open the integrated PowerShell terminal in this folder.
3. Run: node server.js
4. Open: http://127.0.0.1:3001/

Keep the terminal open. Local demonstration accounts are supplied by the
development server and shown in the local sign-in flow. These passwords are
for localhost demonstration only. Never reuse them on a public deployment.

The server listens on 127.0.0.1 during local development. In production it
binds to 0.0.0.0 and refuses to start unless production account configuration
is present.

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
   teacher and hod accounts for every campus key below. Each account needs a
   unique id and a strong password; displayName is optional.
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

Skill Learner cash payout additionally requires Razorpay Route and verified
provider-linked accounts. Without those approvals and mappings, users can
coordinate terms in the private portal chat; the app must not collect card
or bank credentials in chat.

GATEPASS SECURITY BOUNDARY
-------------------------

Gate-pass requests are routed to HOD review. Approved passes are shown in the
requester's portal using a short-lived rotating verification code; the code
can be checked once by the authorized gate-pass workflow. A web page cannot
prevent screenshots. Short expiry and server-side verification reduce reuse
of an old capture, but do not make a screen physically uncopyable.

The office can use the protected admin backup/restore workflow. Store exported
backups privately because they contain portal records and uploaded documents.
