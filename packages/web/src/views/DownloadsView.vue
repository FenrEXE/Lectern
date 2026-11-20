<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import type { LibraryRequest } from '@lectern/shared';
import { api } from '../api';
import BookCover from '../components/BookCover.vue';
import { joinNames, seriesLabel } from '../format';

// Everything added to the library, newest first. While anything is still on
// its way, the list refreshes every few seconds (from Lectern only, never MAM).
const items = ref<LibraryRequest[]>();
const error = ref<string>();
const retrying = ref<number>();
let timer: ReturnType<typeof setTimeout> | undefined;

const active = computed(() => items.value?.some((r) => ['sending', 'downloading', 'importing'].includes(r.status)));

async function load(): Promise<void> {
  try {
    items.value = await api.requests();
    error.value = undefined;
  } catch (err) {
    error.value = (err as Error).message;
  }
  timer = setTimeout(load, active.value ? 3_000 : 30_000);
}

async function retry(id: number): Promise<void> {
  retrying.value = id;
  try {
    await api.retry(id);
    clearTimeout(timer);
    await load();
  } finally {
    retrying.value = undefined;
  }
}

function minutes(seconds?: number): string {
  if (!seconds) return '';
  if (seconds < 90) return 'less than 2 min left';
  const m = Math.round(seconds / 60);
  return m < 90 ? `${m} min left` : `${Math.round(m / 60)} h left`;
}

function statusText(r: LibraryRequest): string {
  switch (r.status) {
    case 'sending':
      return 'Sending to qBittorrent…';
    case 'downloading':
      return ['Downloading', `${Math.floor(r.progress * 100)}%`, minutes(r.etaSeconds)].filter(Boolean).join(' · ');
    case 'importing':
      return 'Adding to your library…';
    case 'done':
      return 'In your library';
    case 'failed':
      return 'Didn’t work';
  }
}

onMounted(load);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <h1>Downloads</h1>

  <p v-if="error" class="notice">Can’t load downloads: {{ error }}</p>
  <p v-else-if="!items" class="muted">Loading…</p>
  <div v-else-if="items.length === 0" class="empty">
    <p>Nothing here yet.</p>
    <RouterLink to="/search">Find a book</RouterLink>
  </div>

  <ul v-else class="list">
    <li v-for="r in items" :key="r.id" class="item" :class="`item--${r.status}`">
      <BookCover class="item__cover" :src="r.book.coverUrl" :title="r.book.title" :shape="r.kind === 'audiobook' ? 'square' : 'portrait'" />
      <div class="item__text">
        <span class="item__title">{{ r.book.title }}</span>
        <span v-if="seriesLabel(r.book.series)" class="item__series">{{ seriesLabel(r.book.series) }}</span>
        <span class="muted">{{ joinNames(r.book.authors) }}</span>

        <span class="status">
          <span class="dot" aria-hidden="true" />
          {{ statusText(r) }}
        </span>
        <progress
          v-if="r.status === 'downloading'"
          :value="r.progress"
          max="1"
          :aria-label="`${r.book.title}: ${Math.floor(r.progress * 100)}% downloaded`"
        />
        <span v-if="r.message" class="message">{{ r.message }}</span>
        <button
          v-if="r.status === 'failed'"
          type="button"
          class="retry"
          :disabled="retrying === r.id"
          @click="retry(r.id)"
        >
          {{ retrying === r.id ? 'Retrying…' : 'Try again' }}
        </button>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  gap: 14px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.item__cover { width: 72px; align-self: flex-start; }

.item__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.item__title { font-weight: 600; font-size: 16px; line-height: 1.3; }
.item__series { font-size: 14px; font-weight: 600; color: var(--green-500); }
.muted { color: var(--text-muted); font-size: 14px; }

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 14px;
  font-weight: 600;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--text-muted);
}

.item--downloading .dot,
.item--sending .dot,
.item--importing .dot { background: #b9832b; }
.item--done .dot { background: #3e8a5c; }
.item--failed .dot { background: #b3412f; }

progress {
  width: 100%;
  height: 8px;
  margin-top: 4px;
  accent-color: var(--green-500);
}

.message {
  font-size: 13px;
  color: var(--text-muted);
}

.item--failed .message { color: #b3412f; }

.retry {
  align-self: flex-start;
  min-height: 40px;
  margin-top: 6px;
  padding: 0 14px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--accent-text);
  background: var(--accent);
  border: 0;
  border-radius: 10px;
  cursor: pointer;
}

.empty a { font-weight: 600; color: var(--accent); }

.notice {
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

@media (prefers-color-scheme: dark) {
  .item__series { color: #8fbf9f; }
  .item--failed .message { color: #e08a7a; }
}
</style>
