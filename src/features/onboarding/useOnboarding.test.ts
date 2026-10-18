import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOnboarding } from './useOnboarding';

interface Progress {
  step: number;
  draft: string;
}

const mockFetchProgress = vi.fn();

vi.mock('@/features/onboarding/storage', () => ({
  fetchProgress: mockFetchProgress,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rejy) => {
    resolve = res;
    reject = rej0;
  });
  return { promise, resolve, reject };
}

describe('useOnboarding.restore', () => {
  beforeEach(() => {
    mockFetchProgress.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores persisted progress on mount', async () => {
    const progress: Progress = { step: 2, draft: 'draft-2' };
    mockFetchProgress.mockResolvedValue(progress);

    const { result } = renderHook(() => useOnboarding());

    await waitFor(() => {
      expect(result.current.progress).toEqual(progress);
    });
  });

  it('discards a stale response that resolves after a newer retry', async () => {
    const first = deferred<Progress | null>();
    const second = deferred<Progress | null>();

    mockFetchProgress
      .mockReturnedValueOnce(first.promise)
      .mockReturnedValueOnce(second.promise);

    const { result } = renderHook(() => useOnboarding());

    // Trigger a user-initiated retry while the first request is still in flight.
    act(() => {
      void result.current.restore();
    });

    expect(mockFetchProgress).toHaveBeenCalledTimes(2);

    const newerProgress: Progress = { step: 5, draft: 'newer' };
    await act(async () => {
      second.resolve(newerProgress);
    });

    await waitFor(() => {
      expect(result.current.progress).toEqual(newerProgress);
    });

    // The older state snapshot resolves last and must be ignored.
    const staleProgress: Progress = { step: 1, draft: 'stale' };
    await act(async () => {
      first.resolve(staleProgress);
    });

    expect(result.current.progress).toEqual(newerProgress);
  });

  it('ignores a response that resolves after unmount', async () => {
    const pending = deferred<Progress | null>();
    mockFetchProgress.mockReturnValueOnce(pending.promise);

    const { result, unmount } = renderHook(() => useOnboarding());

    unmount();

    await act(async () => {
      pending.resolve({ step: 3, draft: 'after-unmount' });
    });

    // The hook is unmounted; the stale response must not be applied.
    expect(result.current.progress).toBeNull();
  });
});
