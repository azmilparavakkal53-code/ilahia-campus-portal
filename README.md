# Ilahia Ecosystem Campus Portal

Ilahia Ecosystem is a multi-institute campus portal prototype. It combines public institute pages with separate student, teacher, HOD and administrator workflows. Skill Learner lets students share skills and request a teacher’s review before displaying a verified teaching-skill badge. Teachers review requests from their own campus.

## Run locally

1. Install Node.js 18 or newer.
2. Open this project folder in VS Code.
3. In the VS Code PowerShell terminal, run `node server.js`.
4. Open `http://127.0.0.1:3001/` in a browser. Keep the terminal open while using the app.

The local server uses demonstration accounts and local files under `data/`. Use only sample information in this mode. Do not expose local demo credentials or real student records publicly.

## Deployment status

`render.yaml` prepares a Render Blueprint for a **demo deployment** and requires production account secrets. Before public use, configure institution-approved accounts, a durable database and private file storage, HTTPS, backups, and real institute records. Render's free web service has an ephemeral filesystem; files can disappear on restart, deploy or sleep. Render's free Postgres currently expires after 30 days, so that is not a permanent production database.

The current backend still stores application records and PDF uploads in local JSON/files. A hosted demo can therefore lose submitted data. Do not use it as the system of record for real student information until durable storage is implemented.

See [BACKEND-README.txt](BACKEND-README.txt) for environment variables, account setup and the limitations of the free demo host.
