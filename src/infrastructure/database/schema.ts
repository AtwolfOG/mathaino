import { sql } from "drizzle-orm";
import {
  check,
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

const ownerPolicy = (name: string, owner: AnyPgColumn) => {
  const ownsRow = sql`${owner} = nullif((select current_setting('mathaino.user_id', true)), '')::uuid`;
  return pgPolicy(name, {
    for: "all",
    to: "public",
    using: ownsRow,
    withCheck: ownsRow,
  });
};

export const authenticationRole = pgRole("mathaino_auth").existing();
const authenticationPolicy = (name: string) =>
  pgPolicy(name, {
    for: "all",
    to: authenticationRole,
    using: sql`true`,
    withCheck: sql`true`,
  });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name"),
    email: text("email").unique("users_email_unique"),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    ...timestamps(),
  },
  (table) => [
    ownerPolicy("users_owner_access", table.id),
    authenticationPolicy("users_authentication_access"),
    check(
      "users_email_canonical",
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
).enableRLS();

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    passwordHash: text("password_hash"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    ...timestamps(),
  },
  (table) => [
    unique("auth_accounts_provider_identity_unique").on(
      table.provider,
      table.providerAccountId,
    ),
    index("auth_accounts_user_idx").on(table.userId),
    check(
      "auth_accounts_provider_nonempty",
      sql`btrim(${table.provider}) <> ''`,
    ),
    check(
      "auth_accounts_identity_nonempty",
      sql`btrim(${table.providerAccountId}) <> ''`,
    ),
    ownerPolicy("auth_accounts_owner_access", table.userId),
    authenticationPolicy("auth_accounts_authentication_access"),
  ],
).enableRLS();

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").unique("auth_sessions_token_hash_unique"),
    token: text("token").unique("auth_sessions_token_unique"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
    check(
      "auth_sessions_hash_sha256",
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "auth_sessions_valid_lifetime",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    ownerPolicy("auth_sessions_owner_access", table.userId),
    authenticationPolicy("auth_sessions_authentication_access"),
    check(
      "auth_sessions_one_credential",
      sql`(${table.tokenHash} is not null) <> (${table.token} is not null)`,
    ),
    check(
      "auth_sessions_token_nonempty",
      sql`${table.token} is null or btrim(${table.token}) <> ''`,
    ),
  ],
).enableRLS();

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index("auth_verifications_identifier_idx").on(table.identifier),
    index("auth_verifications_expiry_idx").on(table.expiresAt),
    authenticationPolicy("auth_verifications_service_access"),
  ],
).enableRLS();

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique("auth_rate_limits_key_unique"),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (table) => [
    authenticationPolicy("auth_rate_limits_service_access"),
    check("auth_rate_limits_count_nonnegative", sql`${table.count} >= 0`),
    check("auth_rate_limits_time_nonnegative", sql`${table.lastRequest} >= 0`),
  ],
).enableRLS();

export const bibleBooks = pgTable(
  "bible_books",
  {
    translationId: text("translation_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order"),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.translationId, table.id] }),
    unique("bible_books_translation_order_unique").on(
      table.translationId,
      table.sortOrder,
    ),
    check("bible_books_order_positive", sql`${table.sortOrder} > 0`),
    check(
      "bible_books_translation_nonempty",
      sql`btrim(${table.translationId}) <> ''`,
    ),
    check("bible_books_id_nonempty", sql`btrim(${table.id}) <> ''`),
    check("bible_books_name_nonempty", sql`btrim(${table.name}) <> ''`),
  ],
);

export const bibleChapters = pgTable(
  "bible_chapters",
  {
    translationId: text("translation_id").notNull(),
    bookId: text("book_id").notNull(),
    id: text("id").notNull(),
    sortOrder: integer("sort_order"),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.translationId, table.bookId, table.id] }),
    unique("bible_chapters_book_order_unique").on(
      table.translationId,
      table.bookId,
      table.sortOrder,
    ),
    foreignKey({
      name: "bible_chapters_book_fk",
      columns: [table.translationId, table.bookId],
      foreignColumns: [bibleBooks.translationId, bibleBooks.id],
    }).onDelete("restrict"),
    check("bible_chapters_id_nonempty", sql`btrim(${table.id}) <> ''`),
    check("bible_chapters_order_positive", sql`${table.sortOrder} > 0`),
  ],
);

export const bibleVerses = pgTable(
  "bible_verses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    translationId: text("translation_id").notNull(),
    bookId: text("book_id").notNull(),
    chapter: text("chapter").notNull(),
    verse: text("verse").notNull(),
    text: text("text").notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("bible_verses_reference_unique").on(
      table.translationId,
      table.bookId,
      table.chapter,
      table.verse,
    ),
    foreignKey({
      name: "bible_verses_book_fk",
      columns: [table.translationId, table.bookId],
      foreignColumns: [bibleBooks.translationId, bibleBooks.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "bible_verses_chapter_fk",
      columns: [table.translationId, table.bookId, table.chapter],
      foreignColumns: [
        bibleChapters.translationId,
        bibleChapters.bookId,
        bibleChapters.id,
      ],
    }).onDelete("restrict"),
    check("bible_verses_chapter_nonempty", sql`btrim(${table.chapter}) <> ''`),
    check("bible_verses_verse_nonempty", sql`btrim(${table.verse}) <> ''`),
    check("bible_verses_text_nonempty", sql`btrim(${table.text}) <> ''`),
  ],
);

export const learningItems = pgTable(
  "learning_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verseId: uuid("verse_id")
      .notNull()
      .references(() => bibleVerses.id, { onDelete: "restrict" }),
    state: text("state", { enum: ["learning", "mastered"] })
      .notNull()
      .default("learning"),
    masteredAt: timestamp("mastered_at", { withTimezone: true }),
    masteryThresholdOverride: integer("mastery_threshold_override"),
    queueOrder: bigint("queue_order", { mode: "number" })
      .notNull()
      .generatedAlwaysAsIdentity(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique("learning_items_user_verse_unique").on(table.userId, table.verseId),
    // Composite target keys prevent dependent records crossing ownership/state.
    unique("learning_items_owner_id_unique").on(table.userId, table.id),
    unique("learning_items_owner_id_state_unique").on(
      table.userId,
      table.id,
      table.state,
    ),
    index("learning_items_user_state_idx").on(table.userId, table.state),
    index("learning_items_active_queue_idx")
      .on(table.userId, table.state, table.queueOrder)
      .where(sql`${table.archivedAt} is null`),
    index("learning_items_verse_idx").on(table.verseId),
    check(
      "learning_items_state_valid",
      sql`${table.state} in ('learning', 'mastered')`,
    ),
    check(
      "learning_items_mastery_consistent",
      sql`(${table.state} = 'mastered') = (${table.masteredAt} is not null)`,
    ),
    check(
      "learning_items_mastery_threshold_override_valid",
      sql`${table.masteryThresholdOverride} is null or ${table.masteryThresholdOverride} between 1 and 30`,
    ),
    ownerPolicy("learning_items_owner_access", table.userId),
  ],
).enableRLS();

export const learningPreferences = pgTable(
  "learning_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    removalPolicy: text("removal_policy", { enum: ["archive", "delete"] })
      .notNull()
      .default("archive"),
    masteryThreshold: integer("mastery_threshold").notNull().default(3),
    timeZone: text("time_zone").notNull().default("Etc/UTC"),
    currentLearningItemId: uuid("current_learning_item_id"),
    queueVersion: bigint("queue_version", { mode: "number" })
      .notNull()
      .default(0),
    ...timestamps(),
  },
  (table) => [
    index("learning_preferences_current_item_idx").on(
      table.userId,
      table.currentLearningItemId,
    ),
    foreignKey({
      name: "learning_preferences_owned_current_item_fk",
      columns: [table.userId, table.currentLearningItemId],
      foreignColumns: [learningItems.userId, learningItems.id],
    }).onDelete("restrict"),
    check(
      "learning_preferences_removal_policy_valid",
      sql`${table.removalPolicy} in ('archive', 'delete')`,
    ),
    check(
      "learning_preferences_queue_version_nonnegative",
      sql`${table.queueVersion} >= 0`,
    ),
    check(
      "learning_preferences_mastery_threshold_valid",
      sql`${table.masteryThreshold} between 1 and 30`,
    ),
    check(
      "learning_preferences_time_zone_nonempty",
      sql`btrim(${table.timeZone}) <> ''`,
    ),
    ownerPolicy("learning_preferences_owner_access", table.userId),
  ],
).enableRLS();

export const practiceAttempts = pgTable(
  "practice_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    learningItemId: uuid("learning_item_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    requestHash: text("request_hash").notNull(),
    mode: text("mode", { enum: ["typing", "voice"] }).notNull(),
    purpose: text("purpose", { enum: ["learning", "review"] }).notNull(),
    outcome: text("outcome", { enum: ["success", "failure"] }).notNull(),
    practicedAt: timestamp("practiced_at", { withTimezone: true }).notNull(),
    practiceDate: date("practice_date", { mode: "string" }).notNull(),
    timeZone: text("time_zone").notNull(),
    assessmentPolicy: text("assessment_policy").notNull(),
    dayPolicy: text("day_policy").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "practice_attempts_owned_item_fk",
      columns: [table.userId, table.learningItemId],
      foreignColumns: [learningItems.userId, learningItems.id],
    }).onDelete("cascade"),
    unique("practice_attempts_user_operation_unique").on(
      table.userId,
      table.operationId,
    ),
    unique("practice_attempts_owner_id_day_unique").on(
      table.userId,
      table.id,
      table.practiceDate,
    ),
    unique("practice_attempts_owner_id_item_day_unique").on(
      table.userId,
      table.id,
      table.learningItemId,
      table.practiceDate,
    ),
    index("practice_attempts_item_time_idx").on(
      table.userId,
      table.learningItemId,
      table.practicedAt,
    ),
    index("practice_attempts_user_day_idx").on(
      table.userId,
      table.practiceDate,
    ),
    check(
      "practice_attempts_mode_valid",
      sql`${table.mode} in ('typing', 'voice')`,
    ),
    check(
      "practice_attempts_purpose_valid",
      sql`${table.purpose} in ('learning', 'review')`,
    ),
    check(
      "practice_attempts_outcome_valid",
      sql`${table.outcome} in ('success', 'failure')`,
    ),
    check(
      "practice_attempts_hash_sha256",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "practice_attempts_zone_nonempty",
      sql`btrim(${table.timeZone}) <> ''`,
    ),
    check(
      "practice_attempts_assessment_nonempty",
      sql`btrim(${table.assessmentPolicy}) <> ''`,
    ),
    check(
      "practice_attempts_day_policy_nonempty",
      sql`btrim(${table.dayPolicy}) <> ''`,
    ),
    ownerPolicy("practice_attempts_owner_access", table.userId),
  ],
).enableRLS();

export const learningSuccessDays = pgTable(
  "learning_success_days",
  {
    userId: uuid("user_id").notNull(),
    learningItemId: uuid("learning_item_id").notNull(),
    practiceDate: date("practice_date", { mode: "string" }).notNull(),
    sourceAttemptId: uuid("source_attempt_id").notNull(),
    timeZone: text("time_zone").notNull(),
    dayPolicy: text("day_policy").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.learningItemId, table.practiceDate],
    }),
    foreignKey({
      name: "learning_success_days_attempt_fk",
      columns: [
        table.userId,
        table.sourceAttemptId,
        table.learningItemId,
        table.practiceDate,
      ],
      foreignColumns: [
        practiceAttempts.userId,
        practiceAttempts.id,
        practiceAttempts.learningItemId,
        practiceAttempts.practiceDate,
      ],
    }).onDelete("cascade"),
    index("learning_success_days_attempt_idx").on(
      table.userId,
      table.sourceAttemptId,
      table.learningItemId,
      table.practiceDate,
    ),
    check(
      "learning_success_days_zone_nonempty",
      sql`btrim(${table.timeZone}) <> ''`,
    ),
    check(
      "learning_success_days_policy_nonempty",
      sql`btrim(${table.dayPolicy}) <> ''`,
    ),
    ownerPolicy("learning_success_days_owner_access", table.userId),
  ],
).enableRLS();

export const dailyPracticeCompletions = pgTable(
  "daily_practice_completions",
  {
    userId: uuid("user_id").notNull(),
    practiceDate: date("practice_date", { mode: "string" }).notNull(),
    sourceAttemptId: uuid("source_attempt_id").notNull(),
    timeZone: text("time_zone").notNull(),
    dayPolicy: text("day_policy").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.practiceDate] }),
    foreignKey({
      name: "daily_completion_owned_day_attempt_fk",
      columns: [table.userId, table.sourceAttemptId, table.practiceDate],
      foreignColumns: [
        practiceAttempts.userId,
        practiceAttempts.id,
        practiceAttempts.practiceDate,
      ],
    }).onDelete("cascade"),
    index("daily_completion_attempt_idx").on(
      table.userId,
      table.sourceAttemptId,
      table.practiceDate,
    ),
    check(
      "daily_completion_zone_nonempty",
      sql`btrim(${table.timeZone}) <> ''`,
    ),
    check(
      "daily_completion_policy_nonempty",
      sql`btrim(${table.dayPolicy}) <> ''`,
    ),
    ownerPolicy("daily_completion_owner_access", table.userId),
  ],
).enableRLS();

export const reviewSchedules = pgTable(
  "review_schedules",
  {
    learningItemId: uuid("learning_item_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    learningState: text("learning_state").notNull().default("mastered"),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    policyId: text("policy_id").notNull(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({
      name: "review_schedules_owned_mastered_item_fk",
      columns: [table.userId, table.learningItemId, table.learningState],
      foreignColumns: [
        learningItems.userId,
        learningItems.id,
        learningItems.state,
      ],
    })
      .onDelete("cascade")
      .onUpdate("restrict"),
    index("review_schedules_owner_item_idx").on(
      table.userId,
      table.learningItemId,
      table.learningState,
    ),
    index("review_schedules_user_due_idx").on(table.userId, table.nextDueAt),
    check(
      "review_schedules_mastered_only",
      sql`${table.learningState} = 'mastered'`,
    ),
    check(
      "review_schedules_policy_nonempty",
      sql`btrim(${table.policyId}) <> ''`,
    ),
    ownerPolicy("review_schedules_owner_access", table.userId),
  ],
).enableRLS();
