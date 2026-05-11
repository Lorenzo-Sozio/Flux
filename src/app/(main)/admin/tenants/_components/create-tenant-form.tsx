"use client";

import { useState } from "react";
import { createTenant } from "@/actions/tenants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";

export function CreateTenantForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    subdomain: "",
    dbUrl: "",
    emoji: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const normalizedValue =
      name === "subdomain"
        ? value.toLowerCase().replace(/[^a-z0-9-]/g, "")
        : value;

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
    setSuccess(false);

    try {
      if (!formData.name || !formData.subdomain || !formData.dbUrl) {
        throw new Error("Please fill in all required fields.");
      }

      await createTenant(
        formData.name,
        formData.subdomain,
        formData.dbUrl,
        formData.emoji ? { emoji: formData.emoji } : undefined
      );

      setSuccess(true);
      setFormData({ name: "", subdomain: "", dbUrl: "", emoji: "" });

      // Reset success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
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

      {success && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Tenant created successfully! You need to create the database and
            apply migrations manually.
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
          <p className="text-xs text-gray-500">1-255 characters</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="subdomain">
            Subdomain <span className="text-red-500">*</span>
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="subdomain"
              name="subdomain"
              placeholder="e.g., acme"
              value={formData.subdomain}
              onChange={handleChange}
              disabled={loading}
              required
            />
            <span className="whitespace-nowrap text-sm text-gray-500">
              .localhost:3000
            </span>
          </div>
          <p className="text-xs text-gray-500">
            3-63 chars, lowercase + hyphens
          </p>
        </div>

        <div className="sm:col-span-2 space-y-2">
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
          <p className="text-xs text-gray-500">
            PostgreSQL connection string (hidden for security)
          </p>
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
          <p className="text-xs text-gray-500">Single emoji character</p>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <Button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create Tenant"}
        </Button>
      </div>

      <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
        <p className="font-semibold mb-1">⚠️ Next Steps:</p>
        <ol className="list-inside list-decimal space-y-1 text-xs">
          <li>Create the PostgreSQL database (manually or via script)</li>
          <li>Run database migrations on the new tenant database</li>
          <li>The tenant will be immediately live on the subdomain</li>
        </ol>
      </div>
    </form>
  );
}
