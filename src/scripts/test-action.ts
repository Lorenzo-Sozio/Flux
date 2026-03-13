import { createLead } from '../src/app/(main)/dashboard/leads/actions';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import * as dotenv from 'dotenv';
dotenv.config();

// Mock next-auth auth function
jest.mock('@/auth', () => ({
  auth: () => Promise.resolve({ user: { id: 'test-id' } })
}));

async function test() {
  const formData = new FormData();
  formData.append("firstName", "Test");
  formData.append("lastName", "Test2");
  formData.append("jobTitle", "");
  formData.append("email", "");
  formData.append("phone", "");
  formData.append("mobile", "");
  formData.append("companyName", "");
  formData.append("industry", "");
  formData.append("website", "");
  formData.append("street", "");
  formData.append("city", "");
  formData.append("state", "");
  formData.append("zipCode", "");
  formData.append("country", "");
  formData.append("status", "new");
  formData.append("source", "");
  formData.append("rating", "warm");
  formData.append("notes", "");

  // Bypass next-auth by faking the session directly in actions or testing raw
}

test();