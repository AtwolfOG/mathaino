-- Local development bootstrap only; not an application migration.
CREATE ROLE mathaino LOGIN PASSWORD 'mathaino_local' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE mathaino OWNER mathaino;
CREATE ROLE mathaino_auth LOGIN PASSWORD 'mathaino_auth_local' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
