<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import type { BookSuggestion, MediaKind, SeriesResponse } from '@lectern/shared';
import { api } from '../api';
import BookRow from '../components/BookRow.vue';
import BookSheet from '../components/BookSheet.vue';
import { defaultKind } from '../session';

// One series, in reading order. Book info only; MAM is asked when a book is opened.
const route = useRoute();
const name = computed(() => String(route.params.name ?? ''));
const author = computed(() => (typeof route.query.author === 'string' ? route.query.author : undefined));
const kind = computed<MediaKind>(() =>
  route.query.kind === 'ebook' || route.query.kind === 'audiobook' ? route.query.kind : defaultKind.value,
);

const data = ref<SeriesResponse>();
const error = ref<string>();
const open = ref<BookSuggestion>();

watch(
  [name, author, kind],
  async () => {
    data.value = undefined;
    error.value = undefined;
    try {
      data.value = await api.series(name.value, author.value, kind.value);
    } catch (err) {
      error.value = (err as Error).message;
    }
  },
  { immediate: true },
);
</script>

<template>
  <header class="head">
    <p class="eyebrow">Series</p>
    <h1>{{ data?.series ?? name }}</h1>
    <p v-if="author" class="by">
      by <RouterLink :to="{ name: 'author', params: { name: author }, query: { kind } }">{{ author }}</RouterLink>
    </p>
  </header>

  <p v-if="error" class="panel">Couldn’t load this series: {{ error }}</p>
  <ul v-else-if="!data" class="list" aria-label="Loading">
    <li v-for="n in 4" :key="n" class="skeleton" />
  </ul>
  <p v-else-if="data.books.length === 0" class="panel">No books found in this series.</p>
  <ol v-else class="list">
    <li v-for="b in data.books" :key="b.id">
      <BookRow :book="b" :kind="kind" @open="open = b" />
    </li>
  </ol>

  <BookSheet v-if="open" :book="open" :kind="kind" @close="open = undefined" />
</template>

<style scoped>
.head { margin: 8px 0 16px; }

.eyebrow {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

h1 {
  margin: 2px 0 4px;
  font-size: 32px;
  line-height: 1.15;
}

.by {
  margin: 0;
  color: var(--text-muted);
}

.by a {
  font-weight: 600;
  color: var(--text);
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

@keyframes pulse { 50% { opacity: 0.5; } }

@media (prefers-reduced-motion: reduce) {
  .skeleton { animation: none; }
}
</style>
