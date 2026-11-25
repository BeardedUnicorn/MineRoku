import { describe, expect, it } from 'vitest';
import { formatTime, parseTime } from './time';

describe('time utils', () => {
  it('reads the milliseconds out of a Roku time string', () => {
    expect(parseTime('30000 ms')).toBe(30000);
    expect(parseTime(undefined)).toBe(0);
    expect(parseTime('n/a')).toBe(0);
  });

  it('formats under and over an hour', () => {
    expect(formatTime(30_000)).toBe('0:30');
    expect(formatTime(120_000)).toBe('2:00');
    expect(formatTime(3_725_000)).toBe('1:02:05');
  });
});
