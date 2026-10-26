# Database setup

For flag-only user provisioning and name/role editing, see
[User administration](./user-administration.md).

```text
Provisioning admin    -> owns schema, controls schema ACLs, runs manual setup
folio_admin           -> schema USAGE/CREATE, owns objects, applies migrations
folio_app             -> restricted runtime CRUD
```

Despite its name, `folio_admin` has no superuser, database-creation, role-creation,
replication or RLS-bypass powers. The runtime role cannot assume it.

## Fresh database

Run `pnpm database:setup` with `psql` installed and an administrator connection
configured through standard PostgreSQL settings (`PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER` and secure password handling). The wrapper accepts
`POSTGRES_USER` and `POSTGRES_DB` as connection fallbacks, but no container invokes
this script automatically. The wrapper does not load files.

Required password inputs are `FOLIO_DATABASE_APP_PASSWORD` and
`FOLIO_DATABASE_ADMIN_PASSWORD`; use distinct passwords. Passwords are not command-line arguments;
administrator statement logging must still avoid password-bearing SQL.

Bootstrap creates exactly two roles (`folio_app`, `folio_admin`), the `folio`
schema, and default privileges. Names are fixed. It deliberately fails and rolls
back when a role or schema already exists: it is not a repeatable repair tool.
The provisioning connection needs CREATEROLE and CREATE on the target database,
or superuser privileges. The schema remains owned by that provisioning role.
The migration runner neither requires schema ownership nor changes schema ACLs;
it still requires ownership of the tables, sequences and functions it manages.
Setup temporarily enables assuming `folio_admin` to establish that role's future
object defaults, then removes its own temporary membership grant. PostgreSQL's
automatic role-creator administration grant, where present, is retained.
A non-owner administrator with database CREATE but no grant option may receive
a warning on the database-level REVOKE. Fresh `folio_app` has no direct database
CREATE grant to revoke; setup does not grant it one.
Default table access is SELECT; sequence access is USAGE/SELECT; function execution
is granted to the app rather than PUBLIC. Migrations supply table-specific writes.

For a new Compose installation, the explicit order is:

```text
Start PostgreSQL → admin provisions roles/schema → run migrations → start Folio
```

Start only PostgreSQL first:

```sh
docker compose up --detach postgres
```

Compose does not publish a PostgreSQL host port by default. An administrator can
manually apply the SQL through the running container, with both role-password
inputs exported in their shell. Replace
the username/database if your cluster administrator settings differ:

```sh
docker compose exec --no-tty \
  --env FOLIO_DATABASE_APP_PASSWORD \
  --env FOLIO_DATABASE_ADMIN_PASSWORD \
  postgres psql --no-psqlrc --username folio_owner --dbname folio \
  < ops/setup-database.sql
```

For an externally reachable database, the administrator can instead run
`pnpm database:setup` locally using the PostgreSQL connection settings above.
The migration and app connections must use `folio_admin` and `folio_app`, respectively.

After administrator setup succeeds:

```sh
docker compose build folio
docker compose run --rm --no-deps folio-migrate node src/database/migrate.mjs
docker compose up --detach
```

The final startup also runs the configured migration/local-user seed job before
the application. Keep any required authentication and storage configuration ready.

## Existing database upgrade

Do not rerun bootstrap or delete a data volume. Stop the application and take a
backup before the upgrade. Run `ops/upgrade-database-owner.sql` through administrator
`psql --no-psqlrc --file ops/upgrade-database-owner.sql` using standard connection
settings and `FOLIO_DATABASE_ADMIN_PASSWORD`.

This one-time upgrade expects `folio_app` and the `folio` schema. It renames the
previous `folio_migrate` role to `folio_admin` if present, or creates `folio_admin`
for an older database without a migration role. It sets the role's password and
transfers ownership of existing Folio tables, sequences and functions. It does
not provision arbitrary roles/schemas, transfer unrelated
objects or use database-wide `REASSIGN OWNED`. Unsupported existing states fail
rather than being automatically repaired. Role membership and privileged-role
checks remain on this explicit upgrade path.
This legacy upgrade retains migration-role schema ownership; the new fresh-setup
workflow does not require it. Existing schema ownership need not change to use
the privilege-based runner.

Update the migration connection URL username to `folio_admin`. Remove or change
an explicit `FOLIO_DATABASE_ADMIN_ROLE=folio_migrate` override. The setting
names remain `FOLIO_DATABASE_ADMIN_URL` and
`FOLIO_DATABASE_ADMIN_PASSWORD`; `FOLIO_DATABASE_APP_URL` is the application connection.

Then run migrations before restarting the application. The upgrade sets ownership
and future defaults; the migration runner resets existing table/sequence grants
and reapplies the runtime write policy. Do not resume the app between those steps.

## Docker Compose and migrations

Private `.env.migrate` supplies the migration URL to the migration job. Neither
PostgreSQL nor the application loads this file. Supply provisioning passwords
explicitly to the administrator's manual setup process. No credentials or
administrator provisioning scripts are bundled into the shared application image.
No Folio role/schema creation runs during PostgreSQL startup, even on a fresh
volume. Starting the entire stack before manual provisioning causes migrations to
fail rather than automatically creating missing roles or schema.

The migration job uses the shared image's one-shot command, then seeds the local
application-login record through the runtime connection; this is not PostgreSQL
role creation. The default image command remains the server.
To run migrations without seeding:

```sh
docker compose run --rm --no-deps folio-migrate node src/database/migrate.mjs
```

The migration runner retains custom schema/role configuration for separately
managed deployments. These administrator scripts intentionally target only the
fixed Folio names.
