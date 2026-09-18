import crypto from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- <password>');
  process.exit(1);
}

const iterations = 210000;
const salt = crypto.randomBytes(16);
const digest = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
console.log(`pbkdf2-sha256$${iterations}$${salt.toString('base64url')}$${digest.toString('base64url')}`);
