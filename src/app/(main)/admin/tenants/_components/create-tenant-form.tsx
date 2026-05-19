"use client";

import { useState } from "react";

import { AlertCircle, CheckCircle2 } from "lucide-react";

import { createTenant } from "@/actions/tenants";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateTenantForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ migrationError: string | null } | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    subdomain: "",
    dbUrl: "",
    emoji: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const normalizedValue = name === "subdomain" ? value.toLowerCase().replace(/[^a-z0-9-]/g, "") : value;

    setFormData((prev) => ({
      ...prev,
      [name]: normalizedValue,
    }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (!formData.name || !formData.subdomain || !formData.dbUrl) {
        throw new Error("Please fill in all required fields (name, identifier, database URL).");
      }

      const result = await createTenant(
        formData.name,
        formData.subdomain,
        formData.dbUrl,
        formData.emoji ? { emoji: formData.emoji } : undefined,
      );

      setSuccess({ migrationError: result.migrationError });
      setFormData({ name: "", subdomain: "", dbUrl: "", emoji: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && !success.migrationError && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Tenant created and database migrated successfully.
          </AlertDescription>
        </Alert>
      )}

      {success?.migrationError && (
        <Alert className="border-amber-200 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            Tenant created, but database migration failed: {success.migrationError}. Use the &quot;Migrate DB&quot;
            button in the tenant list to retry.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">
            Tenant Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="name"
            name="name"
            placeholder="e.g., Acme Corporation"
            value={formData.name}
            onChange={handleChange}
            disabled={loading}
            required
          />
          <p className="text-gray-500 text-xs">1-255 characters</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="subdomain">
            Identifier <span className="text-red-500">*</span>
          </Label>
          <Input
            id="subdomain"
            name="subdomain"
            placeholder="e.g., acme"
            value={formData.subdomain}
            onChange={handleChange}
            disabled={loading}
            required
          />
          <p className="text-gray-500 text-xs">3-63 chars, lowercase + hyphens — unique slug for this tenant</p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="dbUrl">
            Database URL <span className="text-red-500">*</span>
          </Label>
          <Input
            id="dbUrl"
            name="dbUrl"
            type="password"
            placeholder="postgresql://user:password@localhost:5432/db_name"
            value={formData.dbUrl}
            onChange={handleChange}
            disabled={loading}
            required
          />
          <p className="text-gray-500 text-xs">PostgreSQL connection string (hidden for security)</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="emoji">Emoji (Optional)</Label>
          <Input
            id="emoji"
            name="emoji"
            placeholder="e.g., 🚀"
            value={formData.emoji}
            onChange={handleChange}
            disabled={loading}
            maxLength={2}
          />
          <p className="text-gray-500 text-xs">Single emoji character</p>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <Button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create Tenant"}
        </Button>
      </div>

      <div className="rounded-lg bg-blue-50 p-3 text-blue-800 text-sm">
        <p className="mb-1 font-semibold">Next Steps:</p>
        <ol className="list-inside list-decimal space-y-1 text-xs">
          <li>Ensure the PostgreSQL database exists (migrations run automatically on creation)</li>
          <li>Assign members — users access the tenant via centralized SSO login</li>
        </ol>
      </div>
    </form>
  );
}
