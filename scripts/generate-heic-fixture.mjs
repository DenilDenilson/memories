import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const temp = await mkdtemp(join(tmpdir(), 'denil-fixture-'));
try {
  const input = join(temp, 'sample.png');
  await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#82996c' },
  })
    .png()
    .toFile(input);
  execFileSync('heif-enc', [
    '-q',
    '60',
    '-o',
    'tests/fixtures/sample.heic',
    input,
  ]);
} finally {
  await rm(temp, { recursive: true, force: true });
}
