-- Add email_settings table to platform DB for admin-level email configuration
CREATE TABLE IF NOT EXISTS "email_settings" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text DEFAULT 'resend' NOT NULL,
  "resend_api_key" text,
  "smtp_host" text,
  "smtp_port" integer DEFAULT 587,
  "smtp_user" text,
  "smtp_password" text,
  "smtp_secure" boolean DEFAULT false,
  "from_email" text DEFAULT 'noreply@yourdomain.com' NOT NULL,
  "from_name" text DEFAULT 'CRM' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
