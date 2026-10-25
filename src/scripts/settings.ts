export {};
const error = document.querySelector<HTMLElement>('#settings-error')!;
function showError(e: unknown) {
  error.textContent =
    e instanceof Error ? e.message : 'No se pudo completar la operación.';
  error.hidden = false;
}
async function call(path: string, method: string, body?: unknown) {
  error.hidden = true;
  const response = await fetch(`/api/v1/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function showSecret(label: string, secret: string) {
  document.querySelector('#secret-label')!.textContent = label;
  document.querySelector('#secret-value')!.textContent = secret;
  document.querySelector<HTMLElement>('#secret-result')!.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
for (const [selector, path, key] of [
  ['#group-form', 'groups', 'code'],
  ['#token-form', 'tokens', 'token'],
]) {
  const form = document.querySelector<HTMLFormElement>(selector)!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('button')!;
    button.disabled = true;
    try {
      const result = await call(
        path,
        'POST',
        Object.fromEntries(new FormData(form)),
      );
      showSecret(
        path === 'groups'
          ? `Código de ${result.name}`
          : 'Token de administrador para la API',
        result[key],
      );
    } catch (e) {
      showError(e);
      button.disabled = false;
    }
  });
}
document
  .querySelector('#dismiss-secret')
  ?.addEventListener('click', () => window.location.reload());
document.querySelector('#copy-secret')?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(
      document.querySelector('#secret-value')!.textContent!,
    );
    document.querySelector('#copy-secret')!.textContent = 'Copiado';
  } catch {
    showError(new Error('Selecciona y copia el código manualmente.'));
  }
});
document
  .querySelectorAll<HTMLButtonElement>('[data-rotate]')
  .forEach((button) =>
    button.addEventListener('click', async () => {
      if (
        !confirm(
          '¿Cambiar el código? Se cerrarán los accesos actuales de este grupo.',
        )
      )
        return;
      try {
        const result = await call(
          `groups/${button.dataset.rotate}/rotate`,
          'POST',
        );
        showSecret('Nuevo código del grupo', result.code);
      } catch (e) {
        showError(e);
      }
    }),
  );
document
  .querySelectorAll<HTMLButtonElement>(
    '[data-delete-group], [data-delete-token]',
  )
  .forEach((button) =>
    button.addEventListener('click', async () => {
      if (!confirm('¿Revocar este acceso?')) return;
      try {
        await call(
          button.dataset.deleteGroup
            ? `groups/${button.dataset.deleteGroup}`
            : `tokens/${button.dataset.deleteToken}`,
          'DELETE',
        );
        window.location.reload();
      } catch (e) {
        showError(e);
      }
    }),
  );
