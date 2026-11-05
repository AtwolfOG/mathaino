-- Dedicated ephemeral test store; never points at a developer or production store.
CREATE ROLE mathaino_test LOGIN PASSWORD 'mathaino_test_local' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE mathaino_test OWNER mathaino_test;
