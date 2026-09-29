Ilahia portal backend
=====================

Local development in VS Code
----------------------------

Requirements: Node.js 18 or newer. No npm packages are needed.

Open this folder in VS Code. In the integrated PowerShell terminal:

  $env:TEACHER_ID = "your-teacher-id"
  $env:TEACHER_PASSWORD = "choose-a-private-password"
  $env:ADMIN_ID = "your-admin-id"
  $env:ADMIN_PASSWORD = "choose-another-private-password"
  node server.js

Then open http://127.0.0.1:3000/. Keep the terminal running while using it.
Never commit real passwords or the data/ folder to GitHub.

Teacher notes are saved locally in data/ai-knowledge.json and PDFs in
data/uploads. Back up this folder privately; it contains teacher materials.

Free public website setup (Render Blueprint)
============================================

The included render.yaml is configured for Render's free Node web service.
It provides a public HTTPS URL at no monthly service charge under current
free-plan limits. Free instances sleep after 15 minutes without traffic; the
first visit after sleeping can take about a minute.

Important: the backend uses local files for teacher notes and PDF uploads.
Render's free filesystem is temporary, and notes/PDFs can be lost whenever the
service sleeps, restarts, or redeploys. Keep private backups and do not rely
on this free setup as the only copy of important school materials.

The source is already in the private GitHub repository. In Render, finish
account verification, then create a Blueprint and connect
azmilparavakkal53-code/ilahia-campus-portal. Select render.yaml and enter
teacher/admin IDs and strong passwords in Render's environment-variable
fields. Do not put passwords in source files or GitHub. Deploy; Render will
provide the public HTTPS URL.

For persistent notes and PDFs, the app would need a separate durable database
and file-storage configuration. That is not included in this free setup.
