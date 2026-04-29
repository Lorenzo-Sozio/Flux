CREATE TABLE "appointment_attendee" (
	"id" text PRIMARY KEY NOT NULL,
	"appointment_id" text NOT NULL,
	"user_id" text,
	"contact_id" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'required' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_at" timestamp,
	"response_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_attendee_response_token_unique" UNIQUE("response_token")
);
--> statement-breakpoint
CREATE TABLE "appointment" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"location" text,
	"location_url" text,
	"conference_type" text,
	"conference_link" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"ical_uid" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"organizer_id" text,
	"contact_id" text,
	"deal_id" text,
	"company_id" text,
	"lead_id" text,
	"reminder_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_ical_uid_unique" UNIQUE("ical_uid")
);
--> statement-breakpoint
ALTER TABLE "appointment_attendee" ADD CONSTRAINT "appointment_attendee_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_attendee" ADD CONSTRAINT "appointment_attendee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_attendee" ADD CONSTRAINT "appointment_attendee_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_organizer_id_user_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;