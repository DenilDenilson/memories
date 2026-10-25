export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function monthData(value?: string | null) {
  const month =
    value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
      ? value
      : today().slice(0, 7);
  const [year, number] = month.split('-').map(Number);
  const first = new Date(`${month}-01T12:00:00`);
  const count = new Date(year, number, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const cells = Array.from(
    { length: Math.ceil((offset + count) / 7) * 7 },
    (_, index) => {
      const day = index - offset + 1;
      return day > 0 && day <= count
        ? `${month}-${String(day).padStart(2, '0')}`
        : null;
    },
  );
  const shift = (delta: number) => {
    const d = new Date(first);
    d.setMonth(d.getMonth() + delta);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  return {
    month,
    cells,
    from: `${month}-01`,
    to: `${month}-${count}`,
    previous: shift(-1),
    next: shift(1),
    label: first.toLocaleDateString('es', { month: 'long', year: 'numeric' }),
  };
}
export function dateLabel(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(
    'es',
    options || {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    },
  );
}
