import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { withTestDatabase } from "../helpers/schema-database";

test("every foreign key has a valid non-partial index with the foreign columns as its leading keys", () =>
  withTestDatabase(async (db) => {
    const result = await db.execute(sql`
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indisvalid and i.indisready
          and i.indpred is null
          and not exists (
            select 1 from unnest(c.conkey) with ordinality as fk(attnum, position)
            where i.indkey[(fk.position - 1)::int] is distinct from fk.attnum
          )
      )
  `);
    expect(result.rows).toEqual([]);
  }));
