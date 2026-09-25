import { Pool } from "pg";
import { z } from "zod";

import { loadConfig } from "../config";

const input = z
  .object({
    ageHours: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 30),
    maximum: z.coerce.number().int().min(1).max(1_000),
  })
  .parse({ ageHours: process.argv[2] ?? 24, maximum: process.argv[3] ?? 100 });
const config = loadConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
try {
  const result = await pool.query(
    `WITH expired AS (SELECT id FROM "${config.databaseSchema}"."source_artifacts" WHERE state='pending' AND version_id IS NULL AND created_at < now() - ($1 * interval '1 hour') ORDER BY created_at, id LIMIT $2 FOR UPDATE SKIP LOCKED) UPDATE "${config.databaseSchema}"."source_artifacts" artifact SET state='abandoned' FROM expired WHERE artifact.id=expired.id RETURNING artifact.id`,
    [input.ageHours, input.maximum],
  );
  process.stdout.write(`Abandoned ${result.rowCount ?? 0} pending uploads.\n`);
} finally {
  await pool.end();
}
