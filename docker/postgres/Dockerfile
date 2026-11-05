FROM postgres:15 AS development
COPY development.sql /docker-entrypoint-initdb.d/01-development.sql

FROM postgres:15 AS test
COPY test.sql /docker-entrypoint-initdb.d/01-test.sql
