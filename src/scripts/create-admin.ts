import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../db/schema';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import { eq } from 'drizzle-orm';

// Load .env
dotenv.config();

async function createAdmin() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  const adminEmail = 'admin@flux.local';
  const adminPassword = 'admin';

  console.log(`Checking if admin user ${adminEmail} exists...`);
  
  const [existingUser] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, adminEmail));

  if (existingUser) {
    console.log('Admin user already exists!');
    return;
  }

  console.log('Creating admin user...');
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  await db.insert(schema.users).values({
    name: 'Admin Flux',
    email: adminEmail,
    password: hashedPassword,
    role: 'admin',
  });

  console.log('Admin user created successfully!');
  console.log('Email:', adminEmail);
  console.log('Password:', adminPassword);
}

createAdmin()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Failed to create admin user', e);
    process.exit(1);
  });