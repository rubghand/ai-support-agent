CREATE TABLE "spans" (
	"id" text PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text,
	"user_id" text,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spans" ADD CONSTRAINT "spans_trace_id_traces_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."traces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spans_trace_idx" ON "spans" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "traces_conversation_idx" ON "traces" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "traces_started_idx" ON "traces" USING btree ("started_at");