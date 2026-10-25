import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

test('API: validación, publicación pública, subida múltiple y revocación de tokens', async ({
  request,
}, testInfo) => {
  const headers = { Origin: 'http://localhost:4322' };
  const login = await request.post('/api/v1/session', {
    headers,
    data: { mode: 'admin', secret: 'e2e-admin-password' },
  });
  expect(login.status()).toBe(200);
  const tokenResponse = await request.post('/api/v1/tokens', {
    headers,
    data: { label: `integración-${testInfo.project.name}` },
  });
  const { token } = await tokenResponse.json();
  const auth = { Authorization: `Bearer ${token}` };
  const metadata = {
    title: 'Recuerdo público API',
    date: '2026-02-18',
    public: true,
    groupIds: [],
    tags: ['api'],
  };
  expect(
    (
      await request.get('/api/v1/memories?from=2026-02-30&to=2026-03-01', {
        headers: auth,
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.get('/api/v1/memories?from=2024-01-01&to=2026-01-01', {
        headers: auth,
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post('/api/v1/memories', {
        headers: auth,
        data: { metadata, uploadIds: [] },
      })
    ).status(),
  ).toBe(400);
  const image = await sharp({
    create: { width: 80, height: 60, channels: 3, background: '#9baf89' },
  })
    .jpeg()
    .toBuffer();
  async function uploadPhoto(bytes: Buffer = image) {
    const response = await request.post('/api/v1/uploads', {
      headers: auth,
      data: { date: metadata.date, title: metadata.title, size: bytes.length },
    });
    expect(response.status()).toBe(201);
    const ticket = await response.json();
    expect(
      (
        await request.put(ticket.uploadUrl, {
          headers: { ...ticket.headers, ...headers },
          data: bytes,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.post(`/api/v1/uploads/${ticket.id}/complete`, {
          headers: auth,
        })
      ).status(),
    ).toBe(200);
    return ticket.id as string;
  }
  const firstUpload = await uploadPhoto();
  const created = await request.post('/api/v1/memories', {
    headers: auth,
    data: { metadata, uploadIds: [firstUpload] },
  });
  expect(created.status()).toBe(201);
  const { memory } = await created.json();
  expect(
    (
      await request.post('/api/v1/memories', {
        headers: auth,
        data: { metadata, uploadIds: [firstUpload] },
      })
    ).status(),
  ).toBe(400);
  const update = await request.put(`/api/v1/memories/${memory.id}`, {
    headers: auth,
    data: {
      metadata,
      uploadIds: [
        await uploadPhoto(
          await readFile(new URL('../fixtures/sample.heic', import.meta.url)),
        ),
      ],
    },
  });
  expect((await update.json()).memory.photos).toHaveLength(2);
  expect(
    (
      await request.delete(`/api/v1/photos/${memory.photos[0].id}`, {
        headers: auth,
      })
    ).status(),
  ).toBe(200);
  const current = (
    await (
      await request.get(`/api/v1/memories/${memory.id}`, { headers: auth })
    ).json()
  ).memory;
  expect(
    (
      await request.delete(`/api/v1/photos/${current.photos[0].id}`, {
        headers: auth,
      })
    ).status(),
  ).toBe(400);
  // Cerrar cookies permite comprobar el álbum como visitante público.
  await request.delete('/api/v1/session', { headers });
  const publicResult = await request.get(`/api/v1/memories/${memory.id}`);
  expect(publicResult.status()).toBe(200);
  const publicMemory = (await publicResult.json()).memory;
  expect(publicMemory.photos[0]).not.toHaveProperty('originalUrl');
  expect((await request.get(publicMemory.photos[0].previewUrl)).status()).toBe(
    200,
  );
  expect(
    (
      await request.get(
        publicMemory.photos[0].previewUrl.replace('/preview', '/original'),
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/v1/groups', {
        headers,
        data: { name: 'Forbidden' },
      })
    ).status(),
  ).toBe(403);
  await request.delete(`/api/v1/memories/${memory.id}`, { headers: auth });
  const list = await (
    await request.get('/api/v1/tokens', { headers: auth })
  ).json();
  const entry = list.tokens.find(
    (t: { label: string }) =>
      t.label === `integración-${testInfo.project.name}`,
  );
  expect(
    (
      await request.delete(`/api/v1/tokens/${entry.id}`, { headers: auth })
    ).status(),
  ).toBe(200);
  expect(
    (await request.get('/api/v1/tokens', { headers: auth })).status(),
  ).toBe(403);
});

test('álbum completo: administración, API, privacidad y código de grupo', async ({
  page,
  browser,
  request,
}, testInfo) => {
  const name = `Amigos ${testInfo.project.name}`;
  const title = `Un día especial ${testInfo.project.name}`;
  const image = await sharp({
    create: { width: 900, height: 600, channels: 3, background: '#81996f' },
  })
    .jpeg()
    .toBuffer();
  await page.goto('/admin');
  await expect(page).toHaveURL(/acceso\?modo=admin/);
  await page.getByLabel('Tu contraseña').fill('e2e-admin-password');
  await page.getByRole('button', { name: 'Abrir mi espacio' }).click();
  await expect(
    page.getByRole('heading', { name: 'Mis recuerdos.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Accesos y API' }).click();
  await page.getByLabel('Nombre del grupo').fill(name);
  await page.getByRole('button', { name: 'Crear grupo' }).click();
  await expect(page.locator('#secret-value')).not.toBeEmpty();
  const groupCode = await page.locator('#secret-value').textContent();
  await page.getByRole('button', { name: 'Listo, continuar' }).click();
  await page.getByRole('link', { name: 'Mis recuerdos', exact: true }).click();
  await page.getByRole('link', { name: 'Nuevo recuerdo' }).click();
  await page.getByLabel('Título', { exact: true }).fill(title);
  await page
    .getByLabel('¿Qué quieres recordar?')
    .fill('Una tarde tranquila que merece quedarse.');
  await page.getByLabel('Etiquetas', { exact: true }).fill('viajes, especial');
  await page.getByLabel(name, { exact: true }).check();
  await page.getByLabel('Elige las fotos de este momento').setInputFiles({
    name: 'memory.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.concat([image, Buffer.alloc(5 * 1024 * 1024)]),
  });
  await page
    .getByRole('button', { name: 'Guardar recuerdo', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const memoryId = page.url().split('/').pop()!;
  const photoUrl = await page.locator('.photo-open').getAttribute('data-src');
  await page.getByRole('button', { name: 'Ampliar foto 1' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar visor' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Descargar original 1' }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^\d{8}-un-dia-especial-(desktop|mobile)-[a-f0-9]{12}\.jpg$/,
  );
  // Un visitante no obtiene datos ni imágenes aunque conozca sus identificadores.
  expect((await request.get(`/api/v1/memories/${memoryId}`)).status()).toBe(
    404,
  );
  expect((await request.get(photoUrl!)).status()).toBe(404);
  expect(
    (
      await request.post('/api/v1/groups', {
        data: { name: 'CSRF' },
        headers: { Origin: 'https://other.example' },
      })
    ).status(),
  ).toBe(403);
  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  await guest.goto('http://localhost:4322/acceso');
  await guest.getByLabel('Código de acceso', { exact: true }).fill(groupCode!);
  await guest.getByRole('button', { name: 'Ver recuerdos' }).click();
  await expect(
    guest.getByRole('heading', { name: 'Días para recordar.' }),
  ).toBeVisible();
  await guest.goto(`http://localhost:4322/recuerdos/${memoryId}`);
  await expect(guest.getByRole('heading', { name: title })).toBeVisible();
  await expect(
    guest.getByRole('link', { name: 'Descargar original 1' }),
  ).toHaveCount(0);
  expect((await guest.request.get(photoUrl!)).status()).toBe(200);
  expect(
    (
      await guest.request.get(photoUrl!.replace('/preview', '/original'))
    ).status(),
  ).toBe(403);
  expect((await guest.request.get('/api/v1/groups')).status()).toBe(403);
  // Edición, token API y revocación de grupo.
  await page.getByRole('link', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).fill(`${title} editado`);
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(
    page.getByRole('heading', { name: `${title} editado` }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Accesos y API' }).click();
  await page.getByLabel('Nombre de la integración').fill('Test API');
  await page.getByRole('button', { name: 'Crear token', exact: true }).click();
  await expect(page.locator('#secret-label')).toHaveText(
    'Token de administrador para la API',
  );
  const token = await page.locator('#secret-value').textContent();
  const apiResult = await request.get(`/api/v1/memories/${memoryId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(apiResult.status()).toBe(200);
  await page.getByRole('button', { name: 'Listo, continuar' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .locator('.access-row')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Cambiar código' })
    .click();
  await expect(page.locator('#secret-label')).toHaveText(
    'Nuevo código del grupo',
  );
  expect(
    (await guest.request.get(`/api/v1/memories/${memoryId}`)).status(),
  ).toBe(404);
  // Eliminar mediante API revoca también las URLs de las fotos.
  expect(
    (
      await request.delete(`/api/v1/memories/${memoryId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.get(photoUrl!, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status(),
  ).toBe(404);
  await visitor.close();
  await page.goto('/');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
