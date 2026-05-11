CREATE TABLE "billing_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"metric_type" text NOT NULL,
	"threshold_percent" integer NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event_type" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"triggered_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"stripe_product_id" text,
	"stripe_price_monthly_id" text,
	"stripe_price_annual_id" text,
	"stripe_extra_user_monthly_price_id" text,
	"stripe_extra_user_annual_price_id" text,
	"price_per_user_monthly" integer DEFAULT 0 NOT NULL,
	"price_per_user_annual" integer DEFAULT 0 NOT NULL,
	"annual_discount_percent" integer DEFAULT 0 NOT NULL,
	"included_users" integer DEFAULT 1 NOT NULL,
	"max_users" integer,
	"min_users" integer DEFAULT 1 NOT NULL,
	"extra_user_price_monthly" integer DEFAULT 0 NOT NULL,
	"extra_user_price_annual" integer DEFAULT 0 NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"limits" text DEFAULT '{}' NOT NULL,
	"enabled_modules" text DEFAULT '["crm"]' NOT NULL,
	"support_tier" text DEFAULT 'community' NOT NULL,
	"has_white_label" boolean DEFAULT false NOT NULL,
	"has_sandbox" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_plan_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "billing_stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"tenant_id" text,
	"payload" text NOT NULL,
	"processed_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"plan_id" text,
	"stripe_subscription_id" text,
	"stripe_customer_id" text,
	"stripe_subscription_item_id" text,
	"status" text DEFAULT 'free' NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"trial_end" timestamp,
	"canceled_at" timestamp,
	"grace_period_end" timestamp,
	"currency" text DEFAULT 'eur' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscription_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "billing_tenant_addon" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"addon_type" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"stripe_subscription_item_id" text,
	"stripe_price_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_usage_stat" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"metric_type" text NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_usage_stat_unique" UNIQUE("tenant_id","metric_type","period_start")
);
--> statement-breakpoint
CREATE TABLE "deal_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"user_id" text NOT NULL,
	"content" text NOT NULL,
	"parent_id" text,
	"edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates_cache" (
	"id" text PRIMARY KEY DEFAULT 'eur' NOT NULL,
	"rates" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_city" (
	"id" text PRIMARY KEY NOT NULL,
	"country_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"region" text,
	"postal_codes" text[] DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "geo_city_country_slug_uniq" UNIQUE("country_id","slug")
);
--> statement-breakpoint
CREATE TABLE "geo_country" (
	"id" text PRIMARY KEY NOT NULL,
	"iso2" text NOT NULL,
	"iso3" text,
	"name_en" text NOT NULL,
	"name_it" text,
	"calling_code" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "geo_country_iso2_uniq" UNIQUE("iso2")
);
--> statement-breakpoint
CREATE TABLE "sales_target" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"period_type" text DEFAULT 'month' NOT NULL,
	"target_amount" numeric(12, 2) NOT NULL,
	"target_deals" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_target_user_period_unique" UNIQUE("user_id","period")
);
--> statement-breakpoint
CREATE TABLE "saved_report" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"config" text NOT NULL,
	"owner_id" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_members" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_members_tenant_user_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"db_url" text NOT NULL,
	"settings" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
ALTER TABLE "deal" ALTER COLUMN "currency" SET DEFAULT 'EUR';--> statement-breakpoint
ALTER TABLE "quote" ALTER COLUMN "currency" SET DEFAULT 'EUR';--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "country_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "city_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "source_lead_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "country_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "city_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "source_lead_id" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "health_score" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "country_id" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "city_id" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "converted_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "converted_to_contact_id" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "converted_to_company_id" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "converted_to_deal_id" text;--> statement-breakpoint
ALTER TABLE "marketing_campaign" ADD COLUMN "scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "marketing_campaign" ADD COLUMN "recipient_type" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "tax_percent" numeric(5, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "approved_by_id" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "billing_alert" ADD CONSTRAINT "billing_alert_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_plan_id_billing_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_tenant_addon" ADD CONSTRAINT "billing_tenant_addon_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage_stat" ADD CONSTRAINT "billing_usage_stat_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_comment" ADD CONSTRAINT "deal_comment_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_comment" ADD CONSTRAINT "deal_comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_city" ADD CONSTRAINT "geo_city_country_id_geo_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."geo_country"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_target" ADD CONSTRAINT "sales_target_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_report" ADD CONSTRAINT "saved_report_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_country_id_geo_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."geo_country"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_city_id_geo_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."geo_city"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_country_id_geo_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."geo_country"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_city_id_geo_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."geo_city"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_country_id_geo_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."geo_country"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_city_id_geo_city_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."geo_city"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;