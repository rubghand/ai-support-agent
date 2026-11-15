CREATE TYPE "public"."action_status" AS ENUM('pending', 'approved', 'rejected', 'executed', 'failed');--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_name" text NOT NULL,
	"args" jsonb NOT NULL,
	"summary" text NOT NULL,
	"subject_key" text NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"conversation_id" text,
	"status" "action_status" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" integer,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_actions_one_open_idx" ON "pending_actions" USING btree ("tool_name","subject_key") WHERE "pending_actions"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "pending_actions_status_idx" ON "pending_actions" USING btree ("status","created_at");