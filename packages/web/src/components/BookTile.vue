<script setup lang="ts">
import type { Book, MediaKind } from '@lectern/shared';
import BookCover from './BookCover.vue';

// A cover with a title under it, for shelves and grids.
// `mam`: after "Check MAM", whether MAM has it ('no' dims the tile).
defineProps<{ book: Book; kind: MediaKind; label?: string; mam?: 'yes' | 'no' }>();
defineEmits<{ open: [] }>();
</script>

<template>
  <button type="button" class="tile" :class="{ 'tile--missing': mam === 'no' }" @click="$emit('open')">
    <BookCover :src="book.coverUrl" :title="book.title" :shape="kind === 'audiobook' ? 'square' : 'portrait'" :width="140" />
    <span v-if="label" class="tile__label">{{ label }}</span>
    <span class="tile__title">{{ book.title }}</span>
    <span v-if="mam === 'yes'" class="tile__mam">On MAM</span>
    <span v-else-if="mam === 'no'" class="tile__mam tile__mam--no">Not found on MAM</span>
  </button>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 0;
  font: inherit;
  text-align: left;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}

.tile__label {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--green-500);
}

.tile__title {
  display: -webkit-box;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (prefers-color-scheme: dark) {
  .tile__label { color: #8fbf9f; }
}
.tile--missing { opacity: 0.5; }

.tile__mam {
  align-self: flex-start;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-text);
  background: var(--accent);
  border-radius: 999px;
}

.tile__mam--no {
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border);
}
</style>
