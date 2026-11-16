/** Days are keyed as YYYY-MM-DD in the phone's own time zone. */

export function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Noon, so a daylight-saving change cannot move the date. */
export function fromKey(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

export function addDays(key: string, days: number): string {
  const date = fromKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

/** 0 is Sunday. */
export function weekdayOf(key: string): number {
  return fromKey(key).getDay();
}

export function isDateKey(text: string | null | undefined): text is string {
  return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(fromKey(text).getTime());
}

/** "Monday, November 16" */
export function longDay(key: string): string {
  return fromKey(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "Mon 16" */
export function shortDay(key: string): string {
  const date = fromKey(key);
  return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${date.getDate()}`;
}

/** "7 am", "4 pm", "noon" */
export function hourLabel(hour: number): string {
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}
