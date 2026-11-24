import { describe, it, expect } from 'vitest';
import { systemButtonSpecs, volumeButtonSpecs, playbackButtonSpecs, powerButtonSpecs } from './RemoteButtonSpecs';

describe('RemoteButtonSpecs', () => {
  it('defines system button specs', () => {
    expect(systemButtonSpecs.map(b => b.key)).toContain('home');
  });

  it('defines volume controls', () => {
    expect(volumeButtonSpecs).toHaveLength(3);
  });

  it('defines playback controls', () => {
    expect(playbackButtonSpecs.some(b => b.key === 'play')).toBe(true);
  });

  it('defines power control', () => {
    expect(powerButtonSpecs[0].key).toBe('Power');
  });
});
