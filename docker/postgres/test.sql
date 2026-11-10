-- Dedicated ephemeral test store; never points at a developer or production store.
CREATE ROLE mathaino_test LOGIN PASSWORD 'mathaino_test_local' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE mathaino_test OWNER mathaino_test;
CREATE DATABASE mathaino_auth_e2e_test OWNER mathaino_test;
CREATE ROLE mathaino_auth LOGIN PASSWORD 'mathaino_auth_test_local' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
