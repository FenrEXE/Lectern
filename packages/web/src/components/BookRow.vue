<script setup lang="ts">
import type { BookSuggestion, MediaKind } from '@lectern/shared';
import { duration, joinNames, seriesLabel } from '../format';
import BookCover from './BookCover.vue';

defineProps<{ book: BookSuggestion; kind: MediaKind }>();
defineEmits<{ open: [] }>();
</script>

<template>
  <button type="button" class="row" @click="$emit('open')">
    <BookCover
      class="row__cover"
      :src="book.coverUrl"
      :title="book.title"
      :shape="kind === 'audiobook' ? 'square' : 'portrait'"
    />
    <span class="row__text">
      <span class="row__title">{{ book.title }}</span>
      <span v-if="seriesLabel(book.series)" class="row__series">{{ seriesLabel(book.series) }}</span>
      <span class="row__meta">{{ joinNames(book.authors) }}</span>
      <span v-if="kind === 'audiobook' && book.narrators?.length" class="row__meta">
        Narrated by {{ joinNames(book.narrators) }}
      </span>
      <span class="row__meta row__small">
        {{ [book.publishedYear, kind === 'audiobook' ? duration(book.durationMinutes) : undefined].filter(Boolean).join(' · ') }}
      </span>
    </span>
  </button>
</template>

<style scoped>
.row {
  display: flex;
  gap: 14px;
  width: 100%;
  padding: 12px;
  text-align: left;
  font: inherit;
  color: inherit;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.row:hover { border-color: var(--green-500); }

.row__cover { width: 76px; align-self: flex-start; }

.row__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.row__title {
  font-weight: 600;
  font-size: 16px;
  line-height: 1.3;
}

.row__series {
  font-size: 14px;
  font-weight: 600;
  color: var(--green-500);
}

.row__meta {
  font-size: 14px;
  color: var(--text-muted);
}

.row__small { font-size: 13px; }

@media (prefers-color-scheme: dark) {
  .row__series { color: #8fbf9f; }
}
</style>
