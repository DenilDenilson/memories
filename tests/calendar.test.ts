import { describe, it, expect } from 'vitest';
import { monthData } from '../src/lib/calendar';
import { dateSchema } from '../src/lib/memories';

describe('calendario y fechas', () => {
  it('respeta años bisiestos y rechaza fechas inexistentes', () => {
    expect(monthData('2024-02').to).toBe('2024-02-29');
    expect(monthData('2025-02').to).toBe('2025-02-28');
    expect(dateSchema.safeParse('2025-02-29').success).toBe(false);
    expect(dateSchema.safeParse('2024-02-29').success).toBe(true);
  });
  it('empieza el lunes y completa las semanas', () => {
    const feb = monthData('2026-02');
    expect(feb.cells.slice(0, 6)).toEqual(Array(6).fill(null));
    expect(feb.cells[6]).toBe('2026-02-01');
    expect(feb.cells.length % 7).toBe(0);
    expect(feb.cells.filter(Boolean)).toHaveLength(28);
  });
  it('navega entre años', () => {
    expect(monthData('2026-01').previous).toBe('2025-12');
    expect(monthData('2026-12').next).toBe('2027-01');
  });
});
