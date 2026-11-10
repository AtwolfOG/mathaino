# Observed KJV source and import contract

The importer was designed after inspecting the actual directory and JSON, not an
external API or an assumed Bible format. Source files remain read-only.

## Observed layout

```text
bible/kjv/
  en-kjv.json
  books/
    genesis/
      chapters/
        1.json
        1/verses/1.json
        ...
    esther(greek)/chapters/10.json ... 16.json
    ...
```

`en-kjv.json` is translation metadata with ID `en-kjv`, a version description,
language/country objects, copyright information, and scope `Bible with Deuterocanon`.
It contains no book order or independent per-chapter verse-count manifest.

Chapter files contain exactly a `data` array. Each record has string-valued
`book`, `chapter`, `verse`, and `text`. For example, the inspected Genesis chapter
uses `book: "Genesis"` and `chapter: "1"`. Individual verse files contain string
`verse` and `text`. Chapter/verse identifiers in this source are positive decimal
strings. Paragraph markers and inline notes are part of the text, not separate
fields. They must not be stripped, edited, or normalised.

Book directories use source identifiers such as `1chronicles`, `songofsolomon`,
and `esther(greek)`. Display names come from validated chapter records and are
checked against the inspected identifier/name catalogue. Greek Esther starts at
chapter 10, with chapter 10 beginning at verse 4; these are not missing Protestant
chapters or verses. No universal chapter/verse starting point is imposed on the
excluded additional books.

## Read-only inventory results

| Collection        | Books | Chapter files | Unique verses | Chapter-array records |
| ----------------- | ----: | ------------: | ------------: | --------------------: |
| Full source       |    80 |         1,362 |        36,820 |                67,922 |
| Protestant subset |    66 |         1,189 |        31,102 |                62,204 |
| Additional books  |    14 |           173 |         5,718 |                 5,718 |

There are 36,820 individual verse JSON files and one metadata JSON file, for
38,183 JSON files. Ten `.DS_Store` files are ignored as operating-system metadata.

Every Protestant verse appears twice in its chapter array: **31,102 identical
duplicate occurrences**. All individual verse files agree with the corresponding
unique chapter records. The initial inventory found no malformed JSON, conflicting
duplicates, reference mismatches, file/record discrepancies, or internal gaps.

The initial path/content SHA-256 across all 38,193 files was:

```text
ab996bf5e05a50ce6ca42c820482d48f51172e05c1da18b135b74e3b42da2f2a
```

## Approved selection and duplicate policy

The user selected the standard Protestant 66 only. The 14 excluded source books
are `1esdras`, `2esdras`, `tobit`, `judith`, `esther(greek)`, `wisdom`,
`ecclesiasticus`, `baruch`, `songofthethree`, `susanna`, `belandthedragon`,
`manasseh`, `1maccabees`, and `2maccabees`. Exclusion is explicit in the report;
no source files are removed or rewritten.

Canonical order is an explicit Protestant profile, not filesystem/alphabetical
order. It uses the conventional 66-book order and chapter ranges, plus the stated
aggregate baseline of 1,189 chapters and 31,102 unique verses. These expectations
are distinct from observations of the input being validated.

Duplicate rejection is the default. The approved actual run explicitly enables
verified identical deduplication. Repeated references must agree exactly, and the
individual verse file must also agree. Conflicting text always prevents import.
Every duplicate reference, extra-occurrence count, and chapter-file location is
included in the detailed report. Deduplication changes only the import projection.

## Coverage limits

The parser verifies canonical book/chapter presence, leading/internal verse gaps,
the stated aggregate verse total, and equality of both redundant representations.
A missing trailing verse file is detected against its chapter array. If both
representations lose a trailing verse, the canonical total detects the shortage,
but the source provides no independent per-chapter expected final verse number.
The importer must report that limitation rather than invent missing text or claim
independent verification of every versification boundary.

The selected profile is specific to this KJV source. Generic database identifiers,
translation-scoped keys, and chapter/order storage remain usable by future
translation adapters without assuming that all translations share this format.

## Running the importer

```sh
# Strict validation rejects duplicates by default.
npm run bible:import -- --validate-only
# Explicitly approved identical-duplicate handling, without a database.
npm run bible:import -- --validate-only --allow-identical-duplicates
# Actual import, using configured DATABASE_URL.
npm run bible:import -- --allow-identical-duplicates
```

The native command uses the fixed project source. Reads use fatal UTF-8 decoding,
bounded file handles, and no-follow opens. Symlinks/unexpected entries are errors.
Validation finishes before persistence is called. There are no translation API
requests or downloads.

The command prints a compact JSON summary and creates a uniquely named detailed
report in `reports/`. It never writes inside the source, follows a report-directory
symlink, or overwrites an earlier report. Reports retain translation metadata,
coverage, exclusions, every duplicate reference/count/location, errors, warnings,
inserted counts, and verified counts. Generated reports are ignored by Git.
Failures exit nonzero and are never labelled successful imports.

The writer batches inserts in one transaction, then compares every stored
reference/text with the validated dataset before commit. Conflicting names,
assigned order values, or text, and unexpected stored references, cause failure;
existing rows are not overwritten/deleted. Unknown NULL order values may be filled.
An unknown commit outcome can be reconciled by a matching idempotent rerun.

## Observed final import

The user-approved development database `mathaino` on port 54329 was populated:

| Result                             | Books | Chapters | Verses |
| ---------------------------------- | ----: | -------: | -----: |
| First import inserted and verified |    66 |    1,189 | 31,102 |
| Second import inserted             |     0 |        0 |      0 |
| Second import verified             |    66 |    1,189 | 31,102 |

Both runs reported zero errors, 31,102 verified identical duplicate occurrences,
and the explicit exclusion of 14 books / 173 chapters / 5,718 verses. The second
run filled zero order values. Database fingerprints including IDs, text, order,
creation times and update times matched before/after rerun for all three tables.
Order checkpoints were Genesis 1, Malachi 39, Matthew 40, and Revelation 66.
Every imported verse was compared with source text, including notes and markers.

Detailed successful reports:

- `reports/kjv-import-1793928124672-07bcaa21-facd-4820-b4e5-34e943899756.json`
- `reports/kjv-import-1793928206080-2bc3f170-89fd-4830-b102-34b02824c557.json`

Operator commands executed:

```sh
docker compose up -d --build --wait postgres
DATABASE_URL=postgresql://mathaino:mathaino_local@127.0.0.1:54329/mathaino npm run db:migrate
DATABASE_URL=postgresql://mathaino:mathaino_local@127.0.0.1:54329/mathaino npm run bible:import -- --allow-identical-duplicates
```

Automated mutation tests use the separate test service and rollback-only fixtures,
not development/production data. This operator import is distinct from those tests.
The additive migration was also checked in an isolated legacy catalogue containing
chapter `A`: original text survived, and unknown ordering remained NULL.

## Verification record

Focused RED runs preceded the parser, directory adapter, application coordinator,
chapter schema, database import writer, and native command implementations.
Coverage includes malformed JSON/UTF-8, wrong shapes/types/references, duplicate
conflicts, explicit identical deduplication, missing books/chapters/verses, redundant
file disagreement, ordering, annotations, idempotence, transaction rollback,
unexpected stored references, and translation isolation. A mixed-translation
regression was reproduced and fixed before the final full suite.

KJV-task checks (before the subsequent authentication work):

- `npm run test`: 61 passing unit/component tests.
- `TEST_DATABASE_URL=postgresql://mathaino_test:mathaino_test_local@127.0.0.1:54330/mathaino_test npm run test:integration`: 95 passing integration tests.
- `npm run lint`, `npm run typecheck`, `npm run format:check`, and
  `npm run build`: passed.
- With the explicit isolated `DATABASE_URL`, `npm run db:check` passed and
  `npm run db:generate -- --name=schema_consistency` found no schema drift.
- `git diff --check` and `git diff --exit-code -- bible/kjv`: passed.
- The post-import full source inventory still contained 38,193 files and matched
  the initial SHA-256 above, including ignored operating-system metadata files.
