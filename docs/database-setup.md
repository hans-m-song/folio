# Database setup

Folio uses three database identities:

```text
Administrator  -> provisions roles, schema and default privileges
Migration role -> owns Folio objects and applies migrations
Runtime role   -> table-specific application CRUD; no Folio schema CREATE
```

## Administrator provisioning

Run `pnpm database:setup` with `psql` installed and an administrator connection
configured through standard PostgreSQL connection settings (`PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, and secure password handling). The wrapper does not load
credential files. An explicit `--username` is also accepted.

Required setup inputs are `FOLIO_DATABASE_APP_PASSWORD` and
`FOLIO_DATABASE_MIGRATION_PASSWORD`. Optional identifiers default to:

| Setting                         | Default         |
| ------------------------------- | --------------- |
| `FOLIO_DATABASE_SCHEMA`         | `folio`         |
| `FOLIO_DATABASE_APP_ROLE`       | `folio_app`     |
| `FOLIO_DATABASE_MIGRATION_ROLE` | `folio_migrate` |

Identifiers must start with a lowercase letter and contain only lowercase letters,
digits and underscores, up to 63 characters. The roles must differ.
Provisioning is transactional and repeatable. It refuses
privileged existing roles or any memberships on either dedicated role.
Passwords are supplied through process inputs, not command-line arguments.
Role creation still sends passwords in SQL; administrator-side statement logging
must be configured to avoid recording password-bearing statements.

For an existing schema, ownership transfer is disabled by default. After a backup
and an operator-reviewed maintenance plan, set
`FOLIO_DATABASE_TRANSFER_OWNERSHIP=true` for the administrator setup invocation.
Transfer is limited to objects in the configured Folio schema; it does not use
database-wide `REASSIGN OWNED` or delete records. Migrations refuse an absent
schema or incomplete ownership transfer.

## Migration and runtime connections

`FOLIO_MIGRATION_DATABASE_URL` must authenticate directly as the configured
migration role. There is no fallback to `FOLIO_DATABASE_URL`. The latter must
authenticate as the runtime role, including for the local-user seed command.
The migration command requires only its connection URL and schema/role settings;
it does not require authentication, browser or object-storage configuration.

Default privileges apply to future objects created by the migration role:
runtime table reads, sequence usage/read access and function execution. The
migration runner separately reapplies the existing table-specific write policy.
New tables therefore do not automatically receive unrestricted CRUD. Ownership
and role provisioning remain outside the migration runner.

## Docker Compose

The migration job shares the application image but uses a one-shot entrypoint.
The default application entrypoint remains the server. Supply migration-only
credentials in a private `.env.migrate` file containing
`FOLIO_MIGRATION_DATABASE_URL` and `FOLIO_DATABASE_MIGRATION_PASSWORD`; do not add
them to the runtime credential file. Keep schema and role identifiers consistent
across setup and migration inputs. The application service explicitly clears the
known administrator and migration credential variables. The migration job clears
administrator/password-provisioning variables and retains only its migration URL
and the runtime connection required for seeding.

The PostgreSQL initialization mount invokes administrator setup only when its
data directory is new. Existing volumes require an explicit administrator setup
invocation; restarting PostgreSQL does not rerun initialization. Configure the
application password and administrator connection separately, and never remove
the data volume to trigger an ownership upgrade.

After setup, the migration job applies SQL and then seeds the configured local
administrator using the runtime connection. To omit seeding:

```sh
docker compose run --rm --no-deps folio-migrate node src/database/migrate.mjs
```

No administrator provisioning command is bundled into the application image.
