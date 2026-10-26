# User administration

25 October 2026: implemented and verified locally; operator acceptance is pending.

## Add a user from the CLI

After database setup, run the provisioning script with named flags:

```sh
pnpm user:add --email operator@example.invalid --role member --display-name "Operations"
```

`--email` is required. `--role` defaults to `member`; `--display-name` is optional.
Display names are trimmed, limited to 200 characters and stored as null when blank.
Use `pnpm user:add --help` to see usage without loading database configuration.
Positional arguments are no longer accepted.

## Edit a user

An administrator can select **Edit user** in Administration → Users to change
the display name and role. Clearing the name stores null, so views use the email
fallback while no display name is present. Existing login-time name filling still
applies: a later Google login may populate an empty name from a verified profile.
The user's email, ID and activation state are
unchanged by this edit. Activate and Deactivate remain separate actions.

Existing session lookups read the user's current display name and role. Changes
apply on the next lookup; the administration list refreshes after a successful save.
