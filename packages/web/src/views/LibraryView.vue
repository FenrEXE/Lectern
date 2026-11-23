<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { LibraryRequest } from '@lectern/shared';
import { api } from '../api';
import BookCover from '../components/BookCover.vue';
import { joinNames, seriesLabel } from '../format';

// Books you've added through Lectern that are now in your library, newest first.
const items = ref<LibraryRequest[]>();
const error = ref<string>();

onMounted(async () => {
  try {
    items.value = (await api.requests()).filter((r) => r.status === 'done');
  } catch (err) {
    error.value = (err as Error).message;
  }
});

const count = computed(() => items.value?.length ?? 0);
</script>

<template>
  <h1>Library</h1>
  <p class="lead">Books you’ve added with Lectern. Listen to them in Audiobookshelf.</p>

  <p v-if="error" class="panel">Couldn’t load your library: {{ error }}</p>
  <p v-else-if="!items" class="lead">Loading…</p>
  <div v-else-if="count === 0" class="panel">
    <p>Nothing added yet.</p>
    <RouterLink to="/search" class="btn btn--primary">Find a book</RouterLink>
  </div>

  <ul v-else class="grid">
    <li v-for="r in items" :key="r.id" class="item">
      <BookCover :src="r.book.coverUrl" :title="r.book.title" :shape="r.kind === 'audiobook' ? 'square' : 'portrait'" :width="160" />
      <span class="title">{{ r.book.title }}</span>
      <span v-if="seriesLabel(r.book.series)" class="series">{{ seriesLabel(r.book.series) }}</span>
      <RouterLink
        v-if="r.book.authors.length"
        class="author"
        :to="{ name: 'author', params: { name: r.book.authors[0] }, query: { kind: r.kind } }"
      >
        {{ joinNames(r.book.authors) }}
      </RouterLink>
    </li>
  </ul>
</template>

<style scoped>
h1 {
  margin: 8px 0 4px;
  font-size: 30px;
}

.lead {
  margin: 0 0 16px;
  color: var(--text-muted);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 20px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.title {
  margin-top: 6px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}

.series {
  font-size: 13px;
  font-weight: 600;
  color: var(--green-500);
}

.author {
  font-size: 13px;
  color: var(--text-muted);
}

@media (prefers-color-scheme: dark) {
  .series { color: #8fbf9f; }
}
</style>
