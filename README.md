# Stage 1 — Foundation

The clean slate. After this zip, you have:
- A working Next.js + Supabase project
- Login + Signup
- A minimal database schema (profiles + companies + audit_logs)
- An automatic trigger that makes the **first signup** a superuser

Everything else (companies management, vehicles, holidays, etc.) comes in later stages.

## Install order — read carefully

### Step 1 — Wipe Supabase auth users

This is destructive but necessary.

1. Supabase → **Authentication** → **Users** tab
2. Delete every user (click each → ⋮ menu → Delete user)
3. **Confirm the user list is empty**

If you skip this step, the trigger will fail when you sign up because there's already an orphaned auth row with no profile.

### Step 2 — Run the SQL

1. Supabase → **SQL Editor** → New query
2. Paste contents of `supabase/migrations/001_foundation.sql` → Run
3. The script wipes the entire `public` schema, then creates `profiles`, `companies`, `audit_logs`, RLS policies, and the auto-profile-creation trigger
4. Watch the **Notices** tab for what got dropped

Verify:
```sql
select tablename from pg_tables where schemaname='public' order by 1;
-- should show only: audit_logs, companies, profiles
```

### Step 3 — Set up the local project

In a fresh folder (recommend `south-lincs-systems-fresh` so you can keep the broken one as a backup):

1. Extract the zip into the new folder
2. **Copy your existing `.env.local`** from your old project into this one. Same Supabase project, so same keys still work.
3. Open a terminal in the new folder:
   ```powershell
   npm install
   npm run dev
   ```
4. Wait for "Ready in Xms"

### Step 4 — Sign up as superuser

1. In your browser, go to `http://localhost:3000`
2. You'll be redirected to `/login`
3. Click "Sign up"
4. Fill in your **real email**, a name, a password (min 6 chars)
5. Click "Create account"

What happens behind the scenes:
- `supabase.auth.signUp` creates an auth user
- The DB trigger fires, sees zero profiles exist, creates yours with `role='superuser'`
- You'll see a "Check your email" screen

### Step 5 — Confirm + log in

**If your Supabase has email confirmation enabled** (default):
- Check your email, click the confirmation link
- You'll be returned to the app
- Go to `/login`, sign in
- Middleware sees `role='superuser'`, redirects you to `/superuser`
- That URL doesn't exist yet (Stage 2 builds it) → **expect a 404**. That's the right outcome for Stage 1.

**If you've disabled email confirmation** (Supabase → Authentication → Email Auth → "Confirm email" off):
- Skip the email step
- Go straight to `/login`, sign in
- Same expected 404 on `/superuser`

### Step 6 — Verify

Run in Supabase SQL Editor:
```sql
select id, email, role, full_name, created_at from public.profiles;
```

Should show one row, your account, `role='superuser'`. ✅

## What works after Stage 1

- ✅ Sign up
- ✅ Sign in
- ✅ Sign-out (will be in Stage 2 when there's a UI)
- ✅ Audit endpoint (no UI yet)
- ✅ Middleware role-gating

## What's NOT in Stage 1 (don't be surprised)

- ❌ `/superuser` — 404, comes in Stage 2
- ❌ `/dashboard` — 404, comes in Stage 3 (admin)
- ❌ `/employee` — 404, comes in Stage 4 (driver app)
- ❌ Any companies / vehicles / holidays / schedules / services
- ❌ Idle timeout — held back, will add deliberately later

## Things that might surprise you

**Email confirmation.** By default Supabase sends a confirmation link. You can disable this in Supabase → Authentication → Email → toggle off "Confirm email" if you don't want to wait for emails during testing. Production should keep it ON.

**The trigger gives every signup AFTER the first the role 'admin'.** So if you sign up a second test user, they become admin. Edit `001_foundation.sql` and adjust the trigger logic if you want different defaults.

**Middleware redirect on /signup or /login when logged in.** If you're already signed in and hit `/login`, middleware sends you to your role's dashboard. Currently `/superuser` is a 404 — that's expected.

## When you're ready

Reply **"foundation works"** (or paste any errors you hit) and I'll ship Stage 2 — the superuser sidebar, companies management, users management, and audit log viewer.
