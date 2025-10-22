#!/usr/bin/env ts-node
import authService from '../services/auth.service';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function seedAdmin() {
  console.log('\n🔐 Creating default admin user...\n');

  try {
    const user = await authService.createUser({
      username: 'admin',
      email: 'admin@watchdna.com',
      password: 'admin123',
      role: 'admin'
    });

    console.log('✅ Admin user created successfully!\n');
    console.log('─'.repeat(40));
    console.log(`Username: ${user.username}`);
    console.log(`Email:    ${user.email}`);
    console.log(`Password: admin123`);
    console.log(`Role:     ${user.role}`);
    console.log('─'.repeat(40));
    console.log('\n⚠️  Change the password after first login!\n');

  } catch (error: any) {
    if (error.message.includes('already exists')) {
      console.log('✅ Admin user already exists\n');
    } else {
      console.error(`❌ Error: ${error.message}\n`);
      process.exit(1);
    }
  }

  process.exit(0);
}

seedAdmin();
