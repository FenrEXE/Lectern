<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import type { BookSuggestion, MediaKind, SuggestResponse } from '@lectern/shared';
import { api } from '../api';
import BookRow from '../components/BookRow.vue';
import BookSheet from '../components/BookSheet.vue';

// The search lives in the address (?q=...&kind=...), so results survive a
// refresh and the back button works as expected.
const route = useRoute();
const router = useRouter();

const q = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''));
const kind = computed<MediaKind>(() => (route.query.kind === 'ebook' ? 'ebook' : 'audiobook'));

const typed = ref(q.value);
const result = ref<SuggestResponse>();
const loading = ref(false);
const error = ref<string>();
const open = ref<BookSuggestion>();

let inFlight: AbortController | undefined;

async function load(): Promise<void> {
  inFlight?.abort();
  result.value = undefined;
  error.value = undefined;
  if (q.value.trim().length < 2) return;
  const controller = (inFlight = new AbortController());
  loading.value = true;
  try {
    result.value = await api.suggest(q.value, kind.value, controller.signal);
  } catch (err) {
    if (!controller.signal.aborted) error.value = (err as Error).message;
  } finally {
    if (inFlight === controller) loading.value = false;
  }
}

watch([q, kind], () => {
  typed.value = q.value;
  void load();
}, { immediate: true });

function submit(): void {
  const text = typed.value.trim();
  if (text) void router.push({ query: { q: text, kind: kind.value } });
}

function setKind(k: MediaKind): void {
  void router.replace({ query: { ...route.query, kind: k } });
}

const sourceNames = { audible: 'Audible', google: 'Google Books', openlibrary: 'Open Library' } as const;
</script>

<template>
  <form class="search" role="search" @submit.prevent="submit">
    <label for="search-box" class="visually-hidden">Search books</label>
    <input
      id="search-box"
      v-model="typed"
      type="search"
      placeholder="Author, title or series"
      autocomplete="off"
      enterkeyhint="search"
    />
    <button type="submit">Search</button>
  </form>

  <div class="kinds" role="group" aria-label="What to look for">
    <button
      v-for="k in (['audiobook', 'ebook'] as const)"
      :key="k"
      type="button"
      class="kind"
      :aria-pressed="kind === k"
      @click="setKind(k)"
    >
      {{ k === 'audiobook' ? 'Audiobooks' : 'Ebooks' }}
    </button>
  </div>

  <p v-if="!q" class="hint">Type an author, title or series. Spelling doesn’t have to be perfect.</p>

  <ul v-else-if="loading" class="list" aria-label="Loading results">
    <li v-for="n in 4" :key="n" class="skeleton" />
  </ul>

  <p v-else-if="error" class="notice">Search didn’t work: {{ error }}</p>

  <template v-else-if="result">
    <p v-if="result.didYouMean" class="did-you-mean">
      Did you mean
      <RouterLink :to="{ query: { q: result.didYouMean, kind } }">{{ result.didYouMean }}</RouterLink>?
    </p>
    <p v-for="p in result.problems" :key="p.source" class="muted small">
      <template v-if="p.reason === 'limit'">
        {{ sourceNames[p.source] }} has hit its request limit for now, so some books may be missing.
        <template v-if="p.source === 'google'">Adding a Google Books API key fixes this.</template>
      </template>
      <template v-else>{{ sourceNames[p.source] }} didn’t answer, so some books may be missing.</template>
    </p>

    <p v-if="result.suggestions.length === 0" class="notice">
      No books found for “{{ result.query }}”. Try fewer words, or just the author.
    </p>
    <ul v-else class="list">
      <li v-for="book in result.suggestions" :key="book.id">
        <BookRow :book="book" :kind="kind" @open="open = book" />
      </li>
    </ul>
  </template>

  <BookSheet v-if="open" :book="open" :kind="kind" @close="open = undefined" />
</template>

<style scoped>
.search {
  display: flex;
  gap: 8px;
}

.search input {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 0 16px;
  font-size: 16px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.search button {
  min-height: 48px;
  padding: 0 18px;
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-text);
  background: var(--accent);
  border: 0;
  border-radius: var(--radius);
  cursor: pointer;
}

.kinds {
  display: inline-flex;
  gap: 4px;
  margin: 12px 0 16px;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.kind {
  min-height: 36px;
  padding: 0 16px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}

.kind[aria-pressed='true'] {
  color: var(--accent-text);
  background: var(--accent);
}

.list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.skeleton {
  height: 104px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  50% { opacity: 0.5; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }
}

.hint, .muted { color: var(--text-muted); }
.small { font-size: 13px; }

.did-you-mean {
  margin: 0 0 12px;
  font-size: 15px;
}

.did-you-mean a {
  font-weight: 600;
  font-style: italic;
  color: var(--accent);
}

.notice {
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
