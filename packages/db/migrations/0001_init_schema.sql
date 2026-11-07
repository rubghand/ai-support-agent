CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."order_kind" AS ENUM('plan', 'addon');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('paid', 'pending', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'starter', 'growth', 'scale');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'pending', 'closed');--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"heading_path" text NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', "chunks"."heading_path"), 'A') || setweight(to_tsvector('english', "chunks"."content"), 'B')) STORED NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text NOT NULL,
	"plan" "plan" NOT NULL,
	"billing_cycle" "billing_cycle" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"category" text NOT NULL,
	"updated_on" date NOT NULL,
	"content_hash" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"kind" "order_kind" NOT NULL,
	"item" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "order_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_document_id_idx" ON "chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "chunks_content_hash_idx" ON "chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_tsv_gin_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "tickets_customer_id_idx" ON "tickets" USING btree ("customer_id");