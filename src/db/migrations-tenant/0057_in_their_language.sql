-- Notifications written before their texts had keys, given the key and values they would
-- have been written with today — so the bell composes them in the reader's language.
--
-- Until 27 September 2026 the product wrote finished English sentences into the row
-- ("Task due today: "…"", "Lead assigned to you"). The bell composes a row from its
-- `title_key` and `params`, and those rows had none, so they stayed English for ever in an
-- Italian office. Each statement recognises one of those sentences exactly — title and
-- message both where both carry values — and fills the key in. A row it does not recognise
-- is left as it is: text somebody wrote (an automation's own message) is not a translation
-- problem. "Task completed" is left too: its sentence never said who completed it, and the
-- keyed text does.
--
-- Data only, guarded by `title_key IS NULL`: re-running it finds nothing left to do.
UPDATE "notification" AS n SET "title_key" = 'taskDueToday', "params" = jsonb_build_object('title', x.t[1])
FROM (SELECT "id", regexp_match("title", '^Task due today: "(.*)"$') AS t FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'activityToday', "params" = jsonb_build_object('kind', lower(x.t[1]), 'description', x.t[2])
FROM (SELECT "id", regexp_match("title", '^(call|meeting|activity) today: "(.*)"$', 'i') AS t FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'activityReminder', "params" = jsonb_build_object('kind', lower(x.t[1]), 'description', x.t[2], 'time', x.m[1])
FROM (SELECT "id", regexp_match("title", '^Upcoming (call|meeting|activity): "(.*)"$', 'i') AS t, regexp_match(coalesce("message", ''), '^Scheduled for (.*)$') AS m FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL AND x.m IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'taskOverdue', "params" = jsonb_build_object('title', x.t[1], 'count', x.m[1]::int)
FROM (SELECT "id", regexp_match("title", '^Task "(.*)" is overdue$') AS t, regexp_match(coalesce("message", ''), '^(\d+) dependent task\(s\) are at risk') AS m FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL AND x.m IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = CASE n."title" WHEN 'Lead assigned to you' THEN 'leadAssigned' WHEN 'Contact assigned to you' THEN 'contactAssigned' ELSE 'companyAssigned' END, "params" = jsonb_build_object('name', x.m[1])
FROM (SELECT "id", regexp_match(coalesce("message", ''), '^(.*) has been assigned to you\.$') AS m FROM "notification" WHERE "title_key" IS NULL AND "title" IN ('Lead assigned to you', 'Contact assigned to you', 'Company assigned to you')) AS x
WHERE n."id" = x."id" AND x.m IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'dealWon', "params" = jsonb_build_object('name', x.m[1])
FROM (SELECT "id", regexp_match(coalesce("message", ''), '^"(.*)" has been marked as won\.$') AS m FROM "notification" WHERE "title_key" IS NULL AND "title" = 'Deal won! 🏆') AS x
WHERE n."id" = x."id" AND x.m IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'quoteApprovalRequested', "params" = jsonb_build_object('number', x.m[1])
FROM (SELECT "id", regexp_match(coalesce("message", ''), '^Quote (.+) needs your approval before it can be sent\.$') AS m FROM "notification" WHERE "title_key" IS NULL AND "title" = 'Quote awaiting your approval') AS x
WHERE n."id" = x."id" AND x.m IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'quoteApproved', "params" = jsonb_build_object('number', x.m[1])
FROM (SELECT "id", regexp_match(coalesce("message", ''), '^Quote (.+) is approved\. You can send it to the customer\.$') AS m FROM "notification" WHERE "title_key" IS NULL AND "title" = 'Quote approved') AS x
WHERE n."id" = x."id" AND x.m IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'quoteRejected', "params" = jsonb_build_object('number', x.m[1], 'hasReason', CASE WHEN x.m[2] IS NULL THEN 'no' ELSE 'yes' END, 'reason', coalesce(x.m[2], ''))
FROM (SELECT "id", regexp_match(coalesce("message", ''), '^Quote (\S+) was not approved\.(?: Reason: (.*))?$') AS m FROM "notification" WHERE "title_key" IS NULL AND "title" = 'Quote sent back') AS x
WHERE n."id" = x."id" AND x.m IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'chatMessage', "params" = jsonb_build_object('sender', x.t[1], 'preview', coalesce(n."message", ''))
FROM (SELECT "id", regexp_match("title", '^New message from (.+)$') AS t FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'orderCreated', "params" = jsonb_build_object('number', x.t[1], 'total', x.m[1], 'lines', x.m[2]::int)
FROM (SELECT "id", regexp_match("title", '^New order (\S+)$') AS t, regexp_match(coalesce("message", ''), '^(.*) — (\d+) lines?\.$') AS m FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL AND x.m IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'slaBreach', "params" = jsonb_build_object('ticket', x.t[1], 'subject', coalesce(n."message", ''))
FROM (SELECT "id", regexp_match("title", '^SLA missed — (.+)$') AS t FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'slaWarning', "params" = jsonb_build_object('percent', x.t[1], 'ticket', x.t[2], 'subject', coalesce(n."message", ''))
FROM (SELECT "id", regexp_match("title", '^(.+) of the SLA used — (.+)$') AS t FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'contractRenewal', "params" = jsonb_build_object('title', x.t[1], 'autoRenew', 'yes', 'renewsOn', x.m[1], 'deadline', x.m[2], 'end', '')
FROM (SELECT "id", regexp_match("title", '^Contract "(.*)" is due for a decision$') AS t, regexp_match(coalesce("message", ''), '^It renews itself on (\S+) unless notice is given by (\S+)\.$') AS m FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL AND x.m IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'contractRenewal', "params" = jsonb_build_object('title', x.t[1], 'autoRenew', 'no', 'end', x.m[1], 'deadline', x.m[2], 'renewsOn', '')
FROM (SELECT "id", regexp_match("title", '^Contract "(.*)" is due for a decision$') AS t, regexp_match(coalesce("message", ''), '^It ends on (\S+)\. Notice to renew or cancel is due by (\S+)\.$') AS m FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL AND x.m IS NOT NULL;
--> statement-breakpoint
UPDATE "notification" AS n SET "title_key" = 'sequenceReply', "params" = jsonb_build_object('email', x.t[1], 'sequence', x.m[1])
FROM (SELECT "id", regexp_match("title", '^(.+) replied$') AS t, regexp_match(coalesce("message", ''), '^The sequence "(.*)" has stopped writing to them\.$') AS m FROM "notification" WHERE "title_key" IS NULL) AS x
WHERE n."id" = x."id" AND x.t IS NOT NULL AND x.m IS NOT NULL;
