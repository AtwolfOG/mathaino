-- Local development bootstrap only; not an application migration.
CREATE ROLE mathaino LOGIN PASSWORD 'mathaino_local' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE mathaino OWNER mathaino;
