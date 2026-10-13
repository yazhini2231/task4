require("dotenv").config();

const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");

const app = express();
const isProduction = process.env.NODE_ENV === "production";

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  throw new Error("Missing DATABASE_URL or SESSION_SECRET. Configure your .env file.");
}

if (isProduction) app.set("trust proxy", 1);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // If your database provider requires SSL, set DATABASE_SSL=true locally.
  // Production hosting commonly requires SSL for remote PostgreSQL connections.
  ssl: isProduction || process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : undefined,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err.message);
});

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  name: "task_manager_session",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in first." });
  }
  next();
}

app.post("/api/register", async (req, res) => {
  try {
    const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body.password;

    if (
      username.length < 2 || username.length > 50 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 ||
      typeof password !== "string" || password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        error: "Enter a username (2–50 characters), valid email, and password (8–72 bytes).",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, email, passwordHash]
    );

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Could not start your session." });
      req.session.userId = result.rows[0].id;
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: "Could not save your session." });
        res.status(201).json({ user: result.rows[0] });
      });
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "This email is already registered." });
    }
    console.error("Registration error:", err.message);
    res.status(500).json({ error: "Registration failed. Check the server logs." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = req.body.password;

    if (!email || typeof password !== "string" || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ error: "Enter a valid email and password." });
    }

    const result = await pool.query(
      `SELECT id, username, email, password_hash FROM users WHERE email = $1`,
      [email]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Could not start your session." });
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) return res.status(500).json({ error: "Could not save your session." });
        res.json({ user: { id: user.id, username: user.username, email: user.email } });
      });
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Login failed. Check the server logs." });
  }
});

app.get("/api/me", async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });

  try {
    const result = await pool.query(
      "SELECT id, username, email FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (!result.rows[0]) {
      return req.session.destroy(() => res.json({ user: null }));
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error("Session check error:", err.message);
    res.status(500).json({ error: "Could not check login." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Logout failed." });
    res.clearCookie("task_manager_session", {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
    });
    res.json({ message: "Logged out successfully." });
  });
});

app.get("/api/tasks", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, completed, created_at
       FROM tasks WHERE user_id = $1 ORDER BY id DESC`,
      [req.session.userId]
    );
    res.json({ tasks: result.rows });
  } catch (err) {
    console.error("Get tasks error:", err.message);
    res.status(500).json({ error: "Could not load tasks." });
  }
});

app.post("/api/tasks", requireAuth, async (req, res) => {
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  if (!title || title.length > 200) {
    return res.status(400).json({ error: "Task title must contain 1–200 characters." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tasks (user_id, title) VALUES ($1, $2)
       RETURNING id, title, completed, created_at`,
      [req.session.userId, title]
    );
    res.status(201).json({ task: result.rows[0] });
  } catch (err) {
    console.error("Create task error:", err.message);
    res.status(500).json({ error: "Could not create task." });
  }
});

app.patch("/api/tasks/:id", requireAuth, async (req, res) => {
  const id = req.params.id;
  const hasTitle = Object.hasOwn(req.body, "title");
  const hasCompleted = Object.hasOwn(req.body, "completed");

  if (!/^[1-9]\d*$/.test(id) || (!hasTitle && !hasCompleted)) {
    return res.status(400).json({ error: "Invalid task update." });
  }
  if (
    (hasTitle && (typeof req.body.title !== "string" ||
      !req.body.title.trim() || req.body.title.trim().length > 200)) ||
    (hasCompleted && typeof req.body.completed !== "boolean")
  ) {
    return res.status(400).json({ error: "Invalid task data." });
  }

  try {
    const result = await pool.query(
      `UPDATE tasks
       SET title = CASE WHEN $1 THEN $2 ELSE title END,
           completed = CASE WHEN $3 THEN $4 ELSE completed END
       WHERE id = $5 AND user_id = $6
       RETURNING id, title, completed, created_at`,
      [
        hasTitle,
        hasTitle ? req.body.title.trim() : "",
        hasCompleted,
        hasCompleted ? req.body.completed : false,
        id,
        req.session.userId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Task not found." });
    res.json({ task: result.rows[0] });
  } catch (err) {
    console.error("Update task error:", err.message);
    res.status(500).json({ error: "Could not update task." });
  }
});

app.delete("/api/tasks/:id", requireAuth, async (req, res) => {
  if (!/^[1-9]\d*$/.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid task ID." });
  }

  try {
    const result = await pool.query(
      `DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.session.userId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Task not found." });
    res.json({ message: "Task deleted." });
  } catch (err) {
    console.error("Delete task error:", err.message);
    res.status(500).json({ error: "Could not delete task." });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
