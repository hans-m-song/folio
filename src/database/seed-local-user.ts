import { Pool } from "pg";

import { localAdministratorEmail } from "../auth/local";
import { loadAuthConfig, loadConfig } from "../config";

const config = loadConfig(process.env);
const authConfig = loadAuthConfig(process.env);
if (authConfig.authMode !== "local" || authConfig.nodeEnv === "production")
  throw new Error(
    "Local administrator seeding requires local development mode",
  );

const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
try {
  await pool.query(
    `INSERT INTO "${config.databaseSchema}"."users" AS target (email, display_name, google_subject, role, active) VALUES ($1, $2, NULL, 'administrator', true) ON CONFLICT (lower(email)) DO UPDATE SET display_name = COALESCE(NULLIF(target.display_name, ''), EXCLUDED.display_name), google_subject = NULL, role = 'administrator', active = true`,
    [localAdministratorEmail, "Local development administrator"],
  );
  process.stdout.write("Local development account ready.\n");
} finally {
  await pool.end();
}
