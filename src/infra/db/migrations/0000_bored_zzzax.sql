CREATE TABLE IF NOT EXISTS "external_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"internal_id" uuid NOT NULL,
	CONSTRAINT "uq_mapping_external" UNIQUE("connection_id","entity_type","external_id"),
	CONSTRAINT "uq_mapping_internal" UNIQUE("connection_id","entity_type","internal_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"sequence_id" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_project_id_sequence_id_unique" UNIQUE("project_id","sequence_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_events" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
