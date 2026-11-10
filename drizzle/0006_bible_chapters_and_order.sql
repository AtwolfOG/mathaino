CREATE TABLE "bible_chapters" (
	"translation_id" text NOT NULL,
	"book_id" text NOT NULL,
	"id" text NOT NULL,
	"sort_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bible_chapters_translation_id_book_id_id_pk" PRIMARY KEY("translation_id","book_id","id"),
	CONSTRAINT "bible_chapters_book_order_unique" UNIQUE("translation_id","book_id","sort_order"),
	CONSTRAINT "bible_chapters_id_nonempty" CHECK (btrim("bible_chapters"."id") <> ''),
	CONSTRAINT "bible_chapters_order_positive" CHECK ("bible_chapters"."sort_order" > 0)
);
--> statement-breakpoint
ALTER TABLE "bible_books" ADD COLUMN "sort_order" integer;--> statement-breakpoint
ALTER TABLE "bible_chapters" ADD CONSTRAINT "bible_chapters_book_fk" FOREIGN KEY ("translation_id","book_id") REFERENCES "public"."bible_books"("translation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Preserve legacy catalogue rows, including nonnumeric chapter identifiers.
INSERT INTO "bible_chapters" ("translation_id", "book_id", "id")
SELECT DISTINCT "translation_id", "book_id", "chapter" FROM "bible_verses";
--> statement-breakpoint
ALTER TABLE "bible_verses" ADD CONSTRAINT "bible_verses_chapter_fk" FOREIGN KEY ("translation_id","book_id","chapter") REFERENCES "public"."bible_chapters"("translation_id","book_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_books" ADD CONSTRAINT "bible_books_translation_order_unique" UNIQUE("translation_id","sort_order");--> statement-breakpoint
ALTER TABLE "bible_books" ADD CONSTRAINT "bible_books_order_positive" CHECK ("bible_books"."sort_order" > 0);
--> statement-breakpoint
CREATE TRIGGER "bible_chapters_touch_updated_at" BEFORE UPDATE ON "bible_chapters"
FOR EACH ROW EXECUTE FUNCTION "mathaino_touch_updated_at"();
