<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import type { AuthorResponse, BookSuggestion, MediaKind } from '@lectern/shared';
import { api } from '../api';
import BookSheet from '../components/BookSheet.vue';
import BookTile from '../components/BookTile.vue';
import { defaultKind } from '../session';

// Everything by one author: series in reading order (standalones last), or
// all books newest first, or A–Z. Book info only; MAM is asked when a book is opened.
const route = useRoute();
const router = useRouter();

const name = computed(() => String(route.params.name ?? ''));
// Audible's ID for this author, when the page was opened from a book.
const authorId = computed(() => (typeof route.query.id === 'string' ? route.query.id : undefined));
const kind = computed<MediaKind>(() =>
  route.query.kind === 'ebook' || route.query.kind === 'audiobook' ? route.query.kind : defaultKind.value,
);
const sort = ref<'series' | 'newest' | 'az'>('series');

const data = ref<AuthorResponse>();
const error = ref<string>();
const open = ref<BookSuggestion>();

watch(
  [name, authorId, kind],
  async () => {
    data.value = undefined;
    error.value = undefined;
    try {
      data.value = await api.author(name.value, kind.value, authorId.value);
    } catch (err) {
      error.value = (err as Error).message;
    }
  },
  { immediate: true },
);

const allBooks = computed(() => (data.value ? [...data.value.series.flatMap((s) => s.books), ...data.value.standalone] : []));
const flat = computed(() =>
  sort.value === 'newest'
    ? [...allBooks.value].sort((a, b) => (b.publishedYear ?? 0) - (a.publishedYear ?? 0))
    : [...allBooks.value].sort((a, b) => a.title.localeCompare(b.title)),
);

function setKind(k: MediaKind): void {
  void router.replace({ query: { ...route.query, kind: k } });
}

const numberLabel = (b: BookSuggestion) => (b.series?.[0]?.number ? `Book ${b.series[0].number}` : undefined);
</script>

<template>
  <header class="head">
    <p class="eyebrow">Author</p>
    <h1>{{ name }}</h1>
    <div class="controls">
      <div class="segmented" role="group" aria-label="Kind of book">
        <button type="button" :aria-pressed="kind === 'audiobook'" @click="setKind('audiobook')">Audiobooks</button>
        <button type="button" :aria-pressed="kind === 'ebook'" @click="setKind('ebook')">Ebooks</button>
      </div>
      <div class="segmented" role="group" aria-label="Sort">
        <button type="button" :aria-pressed="sort === 'series'" @click="sort = 'series'">By series</button>
        <button type="button" :aria-pressed="sort === 'newest'" @click="sort = 'newest'">Newest</button>
        <button type="button" :aria-pressed="sort === 'az'" @click="sort = 'az'">A–Z</button>
      </div>
    </div>
  </header>

  <p v-if="error" class="panel">Couldn’t load this author: {{ error }}</p>
  <div v-else-if="!data" class="shelf" aria-label="Loading">
    <div v-for="n in 5" :key="n" class="skeleton" />
  </div>

  <template v-else>
    <p v-if="allBooks.length === 0" class="panel">No books found for {{ name }}.</p>

    <template v-else-if="sort === 'series'">
      <section v-for="group in data.series" :key="group.name" class="group">
        <h2>
          <RouterLink :to="{ name: 'series', params: { name: group.name }, query: { author: name, authorId, kind } }">
            {{ group.name }}
          </RouterLink>
          <span class="count">{{ group.books.length }} book{{ group.books.length === 1 ? '' : 's' }}</span>
        </h2>
        <ul class="shelf">
          <li v-for="b in group.books" :key="b.id">
            <BookTile :book="b" :kind="kind" :label="numberLabel(b)" @open="open = b" />
          </li>
        </ul>
      </section>

      <section v-if="data.standalone.length" class="group">
        <h2>Standalone books</h2>
        <ul class="shelf">
          <li v-for="b in data.standalone" :key="b.id">
            <BookTile :book="b" :kind="kind" :label="b.publishedYear ? String(b.publishedYear) : undefined" @open="open = b" />
          </li>
        </ul>
      </section>
    </template>

    <ul v-else class="grid">
      <li v-for="b in flat" :key="b.id">
        <BookTile :book="b" :kind="kind" :label="b.publishedYear ? String(b.publishedYear) : undefined" @open="open = b" />
      </li>
    </ul>
  </template>

  <BookSheet v-if="open" :book="open" :kind="kind" @close="open = undefined" />
</template>

<style scoped>
.head { margin: 8px 0 18px; }

.eyebrow {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

h1 {
  margin: 2px 0 12px;
  font-size: 32px;
  line-height: 1.15;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.group { margin-bottom: 22px; }

.group h2 {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 10px;
  font-size: 20px;
}

.group h2 a {
  color: inherit;
  text-decoration-color: var(--border);
  text-underline-offset: 4px;
}

.count {
  font-family: system-ui, sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}

/* A row you scroll sideways, like a shelf. */
.shelf {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 132px;
  gap: 14px;
  margin: 0 -16px;
  padding: 0 16px 6px;
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scroll-padding-inline: 16px; /* snap to the page edge, not the screen edge */
  list-style: none;
}

.shelf li { scroll-snap-align: start; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 18px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.skeleton {
  aspect-ratio: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse { 50% { opacity: 0.5; } }

@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }
}
</style>
