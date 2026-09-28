Ilahia portal backend (local use)
=================================

Requirements: Node.js 18 or newer. No npm packages are needed.

Start it in PowerShell:

  cd "C:\Users\hp\OneDrive\Desktop\project\public"
  $env:TEACHER_ID = "FAC-CS-902"
  $env:TEACHER_PASSWORD = "teacher123"
  $env:ADMIN_ID = "admin"
  $env:ADMIN_PASSWORD = "ilahia2026"
  node server.js

Then open http://127.0.0.1:3000/ (do not open the HTML with file://).
Sign in with the teacher ID/password configured above. For admin sign-in,
use the admin ID/password configured above. These are demo defaults; replace
them with private passwords before using this beyond your own PC.

Teacher notes are saved in data/ai-knowledge.json and become available to
student ClassBot whenever students visit this same running site. Uploaded
PDFs are stored in data/uploads. Text-based PDFs are extracted for ClassBot;
scanned/image-only PDFs need pasted notes or OCR before the AI can use them.

The server listens only on this PC by default. This local setup will not make
notes available to students on other devices or over the Internet. For that,
deploy the backend and site to an HTTPS host. The server automatically listens
on the host's PORT and 0.0.0.0 when NODE_ENV=production. Set DATA_DIR to the
host's persistent storage mount, and set strong TEACHER_PASSWORD and
ADMIN_PASSWORD secrets in the host dashboard. A temporary/ephemeral data folder
will lose notes and PDFs when the host restarts or redeploys.

Keep the data folder private and make backups of it. It contains teacher notes
and uploaded handouts.

Public website setup (Render Blueprint)
=======================================

The included render.yaml is configured for a public Node web service and a
persistent disk. On Render, persistent disks require a paid service. Do not
create the Blueprint unless that plan and its cost are acceptable. Render's
free web services cannot keep this app's local JSON/PDF storage after restarts.

1. Create a PRIVATE GitHub repository. Upload the contents of this public
   folder to the repository root: server.js, render.yaml, .gitignore, and
   1 index.html. Do not upload the data folder; it may contain private notes.
2. In Render, create a new Blueprint and connect that repository. Choose its
   render.yaml file. Set teacher/admin IDs and strong passwords when prompted.
3. Deploy the Blueprint. Render gives the service a public HTTPS URL. Open that
   URL; do not use the localhost preview for the public site.

If your repository includes this folder as a subfolder instead of putting its
contents at the repository root, change rootDir in render.yaml to that folder
name. The Render Blueprint file must also be selected from that folder.

