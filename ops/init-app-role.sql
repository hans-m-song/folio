SELECT format('CREATE ROLE folio_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'folio_app')
\gexec
ALTER ROLE folio_app PASSWORD :'app_password';
