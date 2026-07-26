CREATE TABLE "rate_limit_buckets" (
	"scope" varchar(64) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_buckets_primary_key" PRIMARY KEY("scope","key_hash"),
	CONSTRAINT "rate_limit_buckets_attempt_count_check" CHECK ("rate_limit_buckets"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_updated_at_index" ON "rate_limit_buckets" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_blocked_until_index" ON "rate_limit_buckets" USING btree ("blocked_until");