<script setup lang="ts">
import type { Book, MamTorrent, MediaKind } from '@lectern/shared';
import { duration, joinNames, seriesLabel } from '../format';
import BookCover from './BookCover.vue';

// One book in a list. From a MAM search, `torrent` is its best version and
// `versions` how many there are; those show as a line of MAM details.
const props = defineProps<{
  book: Book;
  kind: MediaKind;
  torrent?: MamTorrent;
  versions?: number;
  pack?: boolean;
  /** After "Check MAM" on a series page: MAM doesn't seem to have it (dimmed). */
  missing?: boolean;
}>();

function mamLine(): string {
  const t = props.torrent;
  if (!t) return '';
  return [
    t.formats.map((f) => f.toUpperCase()).join('/'),
    t.size,
    `${t.seeders} seeding`,
    props.versions && props.versions > 1 ? `${props.versions} versions` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}
defineEmits<{ open: [] }>();
</script>

<template>
  <button type="button" class="row" :class="{ 'row--missing': missing }" @click="$emit('open')">
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
      <span v-if="missing" class="row__mam">Not found on MAM</span>
      <span v-if="torrent" class="row__mam">
        {{ mamLine() }}
        <span v-if="pack" class="row__badge">Pack</span>
        <span v-if="torrent.freeleech" class="row__badge">Freeleech</span>
        <span v-if="torrent.snatched" class="row__badge row__badge--quiet">Downloaded before</span>
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
.row__mam {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-muted);
}

.row__badge {
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent-text);
  background: var(--accent);
  border-radius: 999px;
}

.row__badge--quiet {
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border);
}
.row--missing { opacity: 0.55; }
</style>
