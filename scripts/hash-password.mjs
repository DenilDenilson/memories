import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

// No mostrar la contraseña mientras se introduce en una terminal.
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
process.stdout.write('Contraseña de administrador (mínimo 12 caracteres): ');
muted = true;
const password = await rl.question('');
rl.close();
process.stdout.write('\n');
if (password.length < 12) {
  console.error('Usa al menos 12 caracteres.');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
console.log(
  `ADMIN_PASSWORD_HASH=scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
);
