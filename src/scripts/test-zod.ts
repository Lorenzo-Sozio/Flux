import { z } from "zod";

const emptyStringToNull = z.union([z.string(), z.null(), z.undefined()]).transform(v => !v ? null : v);

const leadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  title: emptyStringToNull,
  email: z.union([z.string().email("Invalid email address"), z.literal(""), z.null(), z.undefined()]).transform(v => !v ? null : v),
  phone: emptyStringToNull,
  mobile: emptyStringToNull,
  companyName: emptyStringToNull,
  industry: emptyStringToNull,
  website: emptyStringToNull,
  street: emptyStringToNull,
  city: emptyStringToNull,
  state: emptyStringToNull,
  zipCode: emptyStringToNull,
  country: emptyStringToNull,
  status: z.enum(["new", "contacting", "engaged", "qualified", "unqualified"]).default("new"),
  source: emptyStringToNull,
  rating: emptyStringToNull,
  notes: emptyStringToNull,
});

try {
  const testData = {
    firstName: "Mario",
    lastName: "Rossi",
    title: "",
    rating: "",
  };
  console.log(leadSchema.parse(testData));
} catch (e) {
  console.error(e);
}