# Secure Task Manager

A full-stack capstone project with user registration, bcrypt password hashing, server-side sessions stored in PostgreSQL, and per-user task ownership.

## Features

- Register and log in with email and password
- Passwords stored as bcrypt hashes
- Server-side sessions stored in PostgreSQL
- Create, view, edit, complete, and delete tasks
- SQL queries scope task operations to the logged-in user
- Responsive HTML/CSS/JavaScript frontend
- Ready for deployment to a Node.js hosting provider

## Requirements

- Node.js 20 or newer
- npm
- A PostgreSQL database (Supabase can provide one)
- Git (for deployment)

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment variables

Copy `.env.example` to `.env` and fill in:

- `DATABASE_URL`: PostgreSQL connection string from your database provider
- `SESSION_SECRET`: long random secret (generate with the command below)
- `NODE_ENV=development` for local work

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never commit `.env` or publish database credentials.

## 3. Create the database tables

Open your Supabase project, select SQL Editor, and execute the contents of `schema.sql`.

Use the PostgreSQL connection string for `DATABASE_URL`. If the connection requires SSL during local development, set `DATABASE_SSL=true`.

## 4. Run locally

```bash
npm run dev
```

Open http://localhost:3000. The terminal must remain running.

## 5. Test user isolation

1. Register with email A and create a few tasks.
2. Log out.
3. Register with email B and create different tasks.
4. Confirm account B does not see account A's tasks.
5. Log back into account A and verify its tasks remain saved.

The backend includes the authenticated user ID in each task SELECT, UPDATE, and DELETE query.

## 6. Deploy

1. Push the repository to GitHub. Ensure `.env` is ignored.
2. Create a Node web service on your hosting provider (for example Render).
3. Build command: `npm install`
4. Start command: `npm start`
5. Configure `DATABASE_URL`, `SESSION_SECRET`, and `NODE_ENV=production` in the host's environment settings.
6. Deploy and test registration, login, task operations, and logout at the public URL.

Free hosting plans, database quotas, sleep behavior, and availability may change; check provider terms.

## API routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/register` | Create an account |
| POST | `/api/login` | Authenticate |
| GET | `/api/me` | Check session |
| POST | `/api/logout` | End session |
| GET | `/api/tasks` | List current user's tasks |
| POST | `/api/tasks` | Create a task |
| PATCH | `/api/tasks/:id` | Update title/completion |
| DELETE | `/api/tasks/:id` | Delete a task |

## Security notes

This is an educational capstone starting point, not a production security audit. Before handling real users, add rate limiting, CSRF protection, robust security headers, monitoring, and review the hosting/database SSL configuration. The application uses parameterized SQL queries, bcrypt hashing, regenerated sessions after authentication, HTTP-only cookies, and owner-scoped task queries.
