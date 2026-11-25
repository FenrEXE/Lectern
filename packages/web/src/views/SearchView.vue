<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import type { BookDetails, FoundBook, MediaKind, SearchResponse } from '@lectern/shared';
import { api } from '../api';
import BookRow from '../components/BookRow.vue';
import BookSheet from '../components/BookSheet.vue';
import { defaultKind } from '../session';

// Search MAM first: pressing Search sends one MAM request (none if someone
// searched the same thing recently), and only books MAM has are listed.
// Covers and descriptions are then filled in from Audible, Google Books and
// Open Library, never MAM.
//
// The search lives in the address (?q=...&kind=...), so results survive a
// refresh and the back button works as expected.
const route = useRoute();
const router = useRouter();

const q = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''));
const kind = computed<MediaKind>(() =>
  route.query.kind === 'ebook' || route.query.kind === 'audiobook' ? route.query.kind : defaultKind.value,
);

const typed = ref(q.value);
const result = ref<SearchResponse>();
const details = ref<Record<string, BookDetails>>({});
const loading = ref(false);
const error = ref<string>();
const open = ref<FoundBook>();
const showOthers = ref(false);

let inFlight: AbortController | undefined;

/** A found book with whatever details have arrived. MAM's own facts win. */
const withDetails = (b: FoundBook): FoundBook => {
  const d = details.value[b.id];
  if (!d) return b;
  return {
    ...d,
    ...b,
    narrators: b.narrators?.length ? b.narrators : d.narrators,
    series: b.series ?? d.series,
    isbn: b.isbn ?? d.isbn,
  };
};

const books = computed(() => (result.value?.books ?? []).map(withDetails));
const others = computed(() => (result.value?.others ?? []).map(withDetails));

async function loadDetails(list: FoundBook[]): Promise<void> {
  const wanted = list
    .filter((b) => !details.value[b.id])
    .slice(0, 30)
    .map((b) => ({ id: b.id, title: b.title, author: b.authors[0] }));
  if (!wanted.length) return;
  try {
    details.value = { ...details.value, ...(await api.details(kind.value, wanted)) };
  } catch {
    // Covers are a nice-to-have; the list works without them.
  }
}

async function load(): Promise<void> {
  inFlight?.abort();
  result.value = undefined;
  error.value = undefined;
  showOthers.value = false;
  if (q.value.trim().length < 2) return;
  const controller = (inFlight = new AbortController());
  loading.value = true;
  try {
    result.value = await api.search(q.value, kind.value, controller.signal);
    void loadDetails(result.value.books);
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

watch(showOthers, (shown) => {
  if (shown && result.value) void loadDetails(result.value.others);
});

function submit(): void {
  const text = typed.value.trim();
  if (text) void router.push({ query: { q: text, kind: kind.value } });
}

function setKind(k: MediaKind): void {
  void router.replace({ query: { ...route.query, kind: k } });
}
</script>

<template>
  <form class="search" role="search" @submit.prevent="submit">
    <label for="search-box" class="visually-hidden">Search MAM</label>
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

  <p v-if="!q" class="hint">Search MAM by author, title or series, then press Search.</p>

  <ul v-else-if="loading" class="list" aria-label="Loading results">
    <li v-for="n in 4" :key="n" class="skeleton" />
  </ul>

  <p v-else-if="error" class="notice">Search didn’t work: {{ error }}</p>

  <template v-else-if="result">
    <p v-if="result.status !== 'ok'" class="notice">{{ result.message }}</p>

    <template v-else>
      <div v-if="books.length === 0 && others.length === 0" class="notice nothing">
        <p>MAM has nothing for “{{ result.query }}”.</p>
        <RouterLink v-if="result.didYouMean" class="btn btn--primary" :to="{ query: { q: result.didYouMean, kind } }">
          Search for “{{ result.didYouMean }}” instead
        </RouterLink>
        <p v-else class="muted small">Check the spelling, or try just the author’s surname.</p>
      </div>

      <ul v-if="books.length" class="list">
        <li v-for="book in books" :key="book.id">
          <BookRow
            :book="book"
            :kind="kind"
            :torrent="book.torrents[0]"
            :versions="book.torrents.length"
            :pack="book.pack"
            @open="open = book"
          />
        </li>
      </ul>
      <p v-else-if="others.length" class="notice">Nothing with “{{ result.query }}” in the title, author or series.</p>

      <p v-if="result.hiddenLanguages" class="muted small">
        {{ result.hiddenLanguages }} result{{ result.hiddenLanguages === 1 ? '' : 's' }} in other languages hidden (Settings → You).
      </p>

      <template v-if="others.length">
        <button type="button" class="link" :aria-expanded="showOthers" @click="showOthers = !showOthers">
          {{ showOthers ? 'Hide' : 'Show' }} {{ others.length }} more that matched another way (narrator, tags…)
        </button>
        <ul v-if="showOthers" class="list">
          <li v-for="book in others" :key="book.id">
            <BookRow
              :book="book"
              :kind="kind"
              :torrent="book.torrents[0]"
              :versions="book.torrents.length"
              :pack="book.pack"
              @open="open = book"
            />
          </li>
        </ul>
      </template>
    </template>
  </template>

  <BookSheet v-if="open" :book="withDetails(open)" :kind="kind" :torrents="open.torrents" @close="open = undefined" />
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
.nothing p { margin: 0 0 10px; }
.nothing .btn { text-decoration: none; }

.link {
  min-height: 44px;
  margin: 6px 0;
  padding: 0;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--green-500);
  background: none;
  border: 0;
  cursor: pointer;
}

@media (prefers-color-scheme: dark) {
  .link { color: #8fbf9f; }
}
</style>
