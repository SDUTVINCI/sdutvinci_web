ALTER TABLE "users" ADD COLUMN "account" varchar(32);--> statement-breakpoint
DO $migration$
DECLARE
	user_record RECORD;
	base_account text;
	candidate_account text;
	suffix_number integer;
BEGIN
	FOR user_record IN
		SELECT "id", "display_name", "email"
		FROM "users"
		ORDER BY "created_at", "id"
	LOOP
		IF lower(user_record."display_name") ~ '^[a-z][a-z0-9]{2,31}$' THEN
			base_account := lower(user_record."display_name");
		ELSE
			base_account := regexp_replace(
				lower(split_part(user_record."email", '@', 1)),
				'[^a-z0-9]',
				'',
				'g'
			);
		END IF;

		IF base_account !~ '^[a-z][a-z0-9]{2,31}$' THEN
			base_account := 'user' || left(replace(user_record."id"::text, '-', ''), 12);
		END IF;

		base_account := left(base_account, 32);
		candidate_account := base_account;
		suffix_number := 0;

		WHILE EXISTS (
			SELECT 1 FROM "users" WHERE "account" = candidate_account
		) LOOP
			suffix_number := suffix_number + 1;
			candidate_account :=
				left(base_account, 32 - length(suffix_number::text))
				|| suffix_number::text;
		END LOOP;

		UPDATE "users"
		SET "account" = candidate_account
		WHERE "id" = user_record."id";
	END LOOP;
END
$migration$;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "account" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_account_unique" ON "users" USING btree ("account");
