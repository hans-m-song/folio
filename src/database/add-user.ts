import { Pool } from "pg";
import { z } from "zod";

import { loadConfig } from "../config";
import { userRoleSchema } from "../domain/types";

const input = z
  .object({ email: z.string().trim().email(), role: userRoleSchema })
  .parse({ email: process.argv[2], role: process.argv[3] ?? "member" });
const config = loadConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
try {
  await pool.query(
    `INSERT INTO "${config.databaseSchema}"."users" (email, role) VALUES ($1, $2)`,
    [input.email, input.role],
  );
  process.stdout.write("Folio user created.\n");
} finally {
  await pool.end();
}
