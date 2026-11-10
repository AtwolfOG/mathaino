CREATE TABLE "bible_books" (
	"translation_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bible_books_translation_id_id_pk" PRIMARY KEY("translation_id","id"),
	CONSTRAINT "bible_books_translation_nonempty" CHECK (btrim("bible_books"."translation_id") <> ''),
	CONSTRAINT "bible_books_id_nonempty" CHECK (btrim("bible_books"."id") <> ''),
	CONSTRAINT "bible_books_name_nonempty" CHECK (btrim("bible_books"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "bible_verses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"translation_id" text NOT NULL,
	"book_id" text NOT NULL,
	"chapter" text NOT NULL,
	"verse" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bible_verses_reference_unique" UNIQUE("translation_id","book_id","chapter","verse"),
	CONSTRAINT "bible_verses_chapter_nonempty" CHECK (btrim("bible_verses"."chapter") <> ''),
	CONSTRAINT "bible_verses_verse_nonempty" CHECK (btrim("bible_verses"."verse") <> ''),
	CONSTRAINT "bible_verses_text_nonempty" CHECK (btrim("bible_verses"."text") <> '')
);
--> statement-breakpoint
ALTER TABLE "bible_verses" ADD CONSTRAINT "bible_verses_book_fk" FOREIGN KEY ("translation_id","book_id") REFERENCES "public"."bible_books"("translation_id","id") ON DELETE restrict ON UPDATE no action;