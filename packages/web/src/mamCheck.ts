// "Check MAM" for an author or series page: one MAM search for every book on
// the page, only when the button is pressed (never when the page opens).
import { ref } from 'vue';
import type { BookSuggestion, MediaKind, OnMamResponse } from '@lectern/shared';
import { api } from './api';

export function useMamCheck() {
  const result = ref<OnMamResponse>();
  const checking = ref(false);
  const error = ref<string>();

  async function check(kind: MediaKind, query: string, books: BookSuggestion[]): Promise<void> {
    checking.value = true;
    error.value = undefined;
    try {
      result.value = await api.onMam({
        kind,
        query,
        books: books.map(({ id, title, subtitle, authors, series, isbn }) => ({ id, title, subtitle, authors, series, isbn })),
      });
      if (result.value.status !== 'ok') error.value = result.value.message;
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      checking.value = false;
    }
  }

  function reset(): void {
    result.value = undefined;
    error.value = undefined;
  }

  /** 'yes' / 'no' once checked, undefined before. */
  const state = (id: string): 'yes' | 'no' | undefined =>
    result.value?.status === 'ok' ? (result.value.found[id] ? 'yes' : 'no') : undefined;

  const torrents = (id: string) => result.value?.found[id];

  return { result, checking, error, check, reset, state, torrents };
}
