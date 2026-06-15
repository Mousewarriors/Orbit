/**
 * "Rebuild File Index" / "Index Files" dispatch — the Root Search command must
 * use the same indexing service as Settings → Files: enable indexing (which
 * kicks off the initial scan) the first time it's used, or rebuild the existing
 * index thereafter. Previously this command called `file_index_rebuild` directly,
 * which is a documented no-op while indexing is disabled (the default) — so the
 * command appeared to do nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { triggerFileIndex } from './builtins.js';

describe('triggerFileIndex', () => {
  it('enables indexing (and starts the initial scan) when never enabled', async () => {
    const setEnabled = vi.fn(async () => ({}));
    const rebuild = vi.fn(async () => ({}));
    const msg = await triggerFileIndex({
      status: async () => ({ enabled: false }),
      setEnabled,
      rebuild,
    });
    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(rebuild).not.toHaveBeenCalled();
    expect(msg).toMatch(/enabled/i);
  });

  it('rebuilds the existing index when already enabled', async () => {
    const setEnabled = vi.fn(async () => ({}));
    const rebuild = vi.fn(async () => ({}));
    const msg = await triggerFileIndex({
      status: async () => ({ enabled: true }),
      setEnabled,
      rebuild,
    });
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(setEnabled).not.toHaveBeenCalled();
    expect(msg).toMatch(/rebuild/i);
  });
});
