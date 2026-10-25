export {};
const form = document.querySelector<HTMLFormElement>('#memory-form')!;
const error = document.querySelector<HTMLElement>('#form-error')!;
const status = document.querySelector<HTMLElement>('#upload-status')!;
const input = document.querySelector<HTMLInputElement>('#photos')!;
let objectUrls: string[] = [];
function showError(message: string) {
  error.textContent = message;
  error.hidden = false;
}
input.addEventListener('change', () => {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  const container = document.querySelector('#new-previews')!;
  container.replaceChildren();
  for (const file of input.files || []) {
    if (/heic|heif/i.test(file.name)) {
      const label = document.createElement('span');
      label.className = 'badge';
      label.textContent = file.name;
      container.append(label);
    } else {
      const image = document.createElement('img');
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      image.src = url;
      image.alt = file.name;
      container.append(image);
    }
  }
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  const fields = new FormData(form);
  const files = [...(input.files || [])];
  if (files.some((f) => f.size > 30 * 1024 * 1024))
    return showError('Cada foto puede pesar hasta 30 MB.');
  if (files.reduce((sum, f) => sum + f.size, 0) > 99 * 1024 * 1024)
    return showError(
      'Selecciona menos de 100 MB por subida. Puedes añadir más fotos al editar.',
    );
  const tags = String(fields.get('tags') || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags.length > 15 || tags.some((t) => t.length > 40))
    return showError('Usa hasta 15 etiquetas de máximo 40 caracteres.');
  const body = new FormData();
  body.set(
    'metadata',
    JSON.stringify({
      title: fields.get('title'),
      date: fields.get('date'),
      description: fields.get('description'),
      tags,
      public: fields.has('public'),
      groupIds: fields.getAll('groups'),
    }),
  );
  files.forEach((file) => body.append('photos', file));
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  button.disabled = true;
  status.hidden = false;
  try {
    const response = await fetch(
      `/api/v1/memories${form.dataset.id ? `/${form.dataset.id}` : ''}`,
      { method: form.dataset.id ? 'PUT' : 'POST', body },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    window.location.assign(`/recuerdos/${result.memory.id}`);
  } catch (e) {
    showError(e instanceof Error ? e.message : 'No se pudo guardar.');
    button.disabled = false;
    status.hidden = true;
  }
});
document
  .querySelector('#delete-memory')
  ?.addEventListener('click', async () => {
    if (
      !confirm(
        '¿Eliminar este recuerdo y todas sus fotos originales? Esta acción no se puede deshacer.',
      )
    )
      return;
    try {
      const response = await fetch(`/api/v1/memories/${form.dataset.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error((await response.json()).error);
      window.location.assign('/admin');
    } catch (e) {
      showError(e instanceof Error ? e.message : 'No se pudo eliminar.');
    }
  });
document
  .querySelectorAll<HTMLButtonElement>('[data-delete-photo]')
  .forEach((button) =>
    button.addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta foto y su original?')) return;
      button.disabled = true;
      try {
        const response = await fetch(
          `/api/v1/photos/${button.dataset.deletePhoto}`,
          { method: 'DELETE' },
        );
        if (!response.ok) throw new Error((await response.json()).error);
        button.parentElement?.remove();
      } catch (e) {
        showError(e instanceof Error ? e.message : 'No se pudo eliminar.');
        button.disabled = false;
      }
    }),
  );
