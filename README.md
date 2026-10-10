# RentMate — Neon PostgreSQL + Node.js Express + Render + Android

This repository contains **everything in one GitHub repo**:
- `server.js` Node.js Express backend (no Python, no FastAPI, no Supabase)
- `sql/001_schema.sql` Neon PostgreSQL schema
- `manager-website/` manager portal (served by Node at `/manager/`)
- `admin-website/` admin portal (served by Node at `/admin/`)
- `android/RentMateApp-master/` full Kotlin/Compose Android Studio project

## 1. Neon
Create Neon project, open SQL Editor, execute **all** `sql/001_schema.sql`. Copy the Neon connection string with SSL enabled. **Never commit it.** Neon starts empty: old Supabase data/users do not transfer automatically.

## 2. VS Code (Node 20+)
```powershell
npm install
Copy-Item .env.example .env
```
Edit `.env`: set `DATABASE_URL`, a randomly generated `JWT_SECRET` of at least 32 characters, and optional `BOOTSTRAP_SECRET` for one-time admin setup.
Generate secrets using `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
Start locally with `npm run dev`. Test `http://localhost:10000/health`, manager portal `/manager/`, admin portal `/admin/`.

## 3. GitHub -> Render
Create a **private** GitHub repository, push the entire folder (do not include `.env`, `node_modules`). In Render, New > Web Service > connect GitHub repo. Runtime Node, build `npm install`, start `npm start`. Environment variables: `DATABASE_URL` (Neon pooled URL), `JWT_SECRET` (long random value), `BOOTSTRAP_SECRET` (one-time only), `NODE_ENV=production`. Deploy and test `/health`. Web portals are on the **same Render host** at `/manager/` and `/admin/`, so they use relative API URLs and require no extra web configuration.

## 4. Create first admin (once)
Set BOOTSTRAP_SECRET in Render before deploying. Run from PowerShell, replacing URL and credentials (never share them):
```powershell
$headers = @{ 'x-bootstrap-secret' = 'YOUR_BOOTSTRAP_SECRET' }
$body = @{ email='admin@example.com'; full_name='System Admin'; password='YOUR_STRONG_PASSWORD_12_PLUS' } | ConvertTo-Json
Invoke-RestMethod -Uri 'https://YOUR-SERVICE.onrender.com/setup/first-admin' -Method Post -Headers $headers -ContentType 'application/json' -Body $body
```
**Immediately remove `BOOTSTRAP_SECRET` from Render and redeploy.** Log in at `/admin/`.
Create manager accounts with `POST /admin/managers` using an admin Bearer token. Admin website currently provides read-only overview; use API to create managers (example below).

## 5. Android
Open `android/RentMateApp-master` in Android Studio. Edit `app/src/main/java/com/example/rentmate/RentMateApiConfig.kt`: set `BASE_URL` to the **same** HTTPS Render origin (no `/api` suffix). Build and install. Android registration and login use Node endpoints; tenant dashboard uses live `/dashboard`. Existing screens retain original UI. Some secondary screen controls are still placeholders; repository exposes chores, expenses, announcements, payment/rent history endpoints for further wiring.

## API quick reference
`POST /auth/register`, `POST /auth/login`, `GET /me`, `GET /dashboard`, `GET /my/{rent,payments,chores,announcements,expenses,expense-splits}`, `PATCH /my/chores/:id/complete`, `POST /households/:id/expenses`.
Manager: `GET /manager/portfolio`, `GET /manager/unassigned-tenants`, `POST /manager/properties`, `/manager/units`, `/manager/assign-tenant`, `/manager/rent`, `/manager/payments`, `/manager/chores`, `/manager/announcements`.
Admin: `GET /admin/overview`, `POST /admin/managers`.

### Admin creates a manager (PowerShell)
```powershell
$login = Invoke-RestMethod -Uri 'https://YOUR-SERVICE.onrender.com/auth/login' -Method Post -ContentType 'application/json' -Body (@{email='admin@example.com';password='ADMIN_PASSWORD'}|ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.access_token)" }
$body = @{email='manager@example.com';password='STRONG_PASSWORD';full_name='Manager Name';business_name='Green Valley Residence'}|ConvertTo-Json
Invoke-RestMethod -Uri 'https://YOUR-SERVICE.onrender.com/admin/managers' -Method Post -Headers $headers -ContentType 'application/json' -Body $body
```

## Important limitations before production
- Registration stores only email, name, phone and password hash. The Android form's ID/student fields and selected documents are **not** sent or stored; do not claim identity verification is complete.
- No email verification, password reset, online payments, document uploads, or automated payment verification. Manual payments must be verified before recording.
- Existing Android screens beyond dashboard may still display static placeholders; backend routes are implemented but not all Compose controls are wired.
- Admin website is a live read-only overview; manager website supports properties, units, rent, payments, tenant assignment, chores and announcements.
- Neon uses a new database; previous Supabase data is not migrated.
- Set CORS_ORIGINS if hosting portals on another domain. Same-origin Render portals work without it.
- No end-to-end live Render/Neon testing has been performed. Run a staging test before real user data.
