CREATE TABLE "note_reads" (
	"note_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_reads_note_id_member_id_pk" PRIMARY KEY("note_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "note_reads" ADD CONSTRAINT "note_reads_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_reads" ADD CONSTRAINT "note_reads_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_reads_member_idx" ON "note_reads" USING btree ("member_id");