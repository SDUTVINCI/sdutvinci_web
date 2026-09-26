-- An old soft-deleted account must not keep the unique member profile link.
DELETE FROM "user_members" AS "link" USING "users" AS "account"
WHERE "link"."user_id" = "account"."id"
  AND "account"."deleted_at" IS NOT NULL;
