<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { AvailabilityResponse, BookSuggestion, MamTorrent, MediaKind } from '@lectern/shared';
import { api } from '../api';
import { duration, joinNames, seriesLabel } from '../format';
import BookCover from './BookCover.vue';

// The book page, as a sheet over the search results. Opening it is the
// moment Lectern asks MAM: only for the one book the person chose.
const props = defineProps<{ book: BookSuggestion; kind: MediaKind }>();
const emit = defineEmits<{ close: [] }>();

const dialog = ref<HTMLDialogElement>();
const availability = ref<AvailabilityResponse>();
const loadError = ref<string>();
const showAllText = ref(false);
const showOthers = ref(false);

const best = computed(() => availability.value?.matches[0]);

async function check(): Promise<void> {
  availability.value = undefined;
  loadError.value = undefined;
  try {
    availability.value = await api.availability(props.book, props.kind);
  } catch (err) {
    loadError.value = (err as Error).message;
  }
}

function torrentLine(t: MamTorrent): string {
  const formats = t.formats.map((f) => f.toUpperCase()).join('/');
  return [formats, t.size, `${t.seeders} seeding`].filter(Boolean).join(' · ');
}

function badges(t: MamTorrent): string[] {
  return [
    t.freeleech && 'Freeleech',
    t.collection && 'Series pack',
    t.snatched && 'Downloaded before',
  ].filter((b): b is string => !!b);
}

onMounted(() => {
  dialog.value?.showModal();
  void check();
});
watch(() => props.book.id, () => void check());

// Clicking the dimmed area around the sheet closes it.
function onBackdrop(e: MouseEvent): void {
  if (e.target === dialog.value) dialog.value?.close();
}
</script>

<template>
  <dialog ref="dialog" class="sheet" aria-labelledby="sheet-title" @close="emit('close')" @click="onBackdrop">
    <div class="sheet__body">
      <button type="button" class="close" aria-label="Close" @click="dialog?.close()">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>

      <header class="head">
        <BookCover
          class="head__cover"
          :src="book.coverUrl"
          :title="book.title"
          :shape="kind === 'audiobook' ? 'square' : 'portrait'"
        />
        <div class="head__text">
          <h2 id="sheet-title">{{ book.title }}</h2>
          <p v-if="book.subtitle && book.subtitle !== seriesLabel(book.series)" class="subtitle">{{ book.subtitle }}</p>
          <p v-if="seriesLabel(book.series)" class="series">{{ seriesLabel(book.series) }}</p>
          <p class="muted">{{ joinNames(book.authors) }}</p>
          <p v-if="kind === 'audiobook' && book.narrators?.length" class="muted">
            Narrated by {{ joinNames(book.narrators) }}
          </p>
          <p class="muted small">
            {{ [book.publishedYear, kind === 'audiobook' ? duration(book.durationMinutes) : undefined].filter(Boolean).join(' · ') }}
          </p>
        </div>
      </header>

      <section class="availability" aria-live="polite">
        <h3>On MAM</h3>

        <p v-if="loadError" class="notice">Couldn’t check MAM: {{ loadError }}</p>
        <p v-else-if="!availability" class="muted">Checking MAM…</p>

        <template v-else-if="availability.status === 'ok'">
          <template v-if="best">
            <p class="best-label">Best match</p>
            <div class="torrent torrent--best">
              <span class="torrent__title">{{ best.title }}</span>
              <span class="torrent__meta">
                {{ torrentLine(best) }}
                <span v-for="b in badges(best)" :key="b" class="badge">{{ b }}</span>
              </span>
            </div>
            <button type="button" class="primary" disabled>Add to Library</button>
            <p class="muted small center">Downloading is the next thing to build.</p>

            <ul v-if="availability.matches.length > 1" class="torrents">
              <li v-for="t in availability.matches.slice(1)" :key="t.id" class="torrent">
                <span class="torrent__title">{{ t.title }}</span>
                <span class="torrent__meta">
                  {{ torrentLine(t) }}
                  <span v-for="b in badges(t)" :key="b" class="badge">{{ b }}</span>
                </span>
              </li>
            </ul>
          </template>
          <p v-else class="notice">Not on MAM yet.</p>

          <template v-if="availability.others.length">
            <button type="button" class="link" :aria-expanded="showOthers" @click="showOthers = !showOthers">
              {{ showOthers ? 'Hide' : 'Show' }} {{ availability.others.length }} other results
            </button>
            <ul v-if="showOthers" class="torrents">
              <li v-for="t in availability.others" :key="t.id" class="torrent">
                <span class="torrent__title">{{ t.title }}</span>
                <span class="torrent__meta">{{ joinNames(t.authors) }} · {{ torrentLine(t) }}</span>
              </li>
            </ul>
          </template>
        </template>

        <p v-else class="notice">{{ availability.message }}</p>
      </section>

      <section v-if="book.description" class="about">
        <h3>About this book</h3>
        <p :class="{ clamp: !showAllText }">{{ book.description }}</p>
        <button v-if="book.description.length > 240" type="button" class="link" @click="showAllText = !showAllText">
          {{ showAllText ? 'Show less' : 'Read more' }}
        </button>
      </section>
    </div>
  </dialog>
</template>

<style scoped>
.sheet {
  width: min(640px, 100%);
  max-width: 100%;
  max-height: 92dvh;
  margin: auto auto 0;
  padding: 0;
  color: var(--text);
  background: var(--bg);
  border: 0;
  border-radius: 20px 20px 0 0;
}

@media (min-width: 700px) {
  .sheet { margin: auto; border-radius: 20px; }
}

.sheet::backdrop { background: rgb(0 0 0 / 0.5); }

.sheet__body {
  position: relative;
  padding: 24px 20px calc(24px + env(safe-area-inset-bottom));
}

.close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.head {
  display: flex;
  gap: 16px;
  padding-right: 36px;
}

.head__cover { width: 120px; align-self: flex-start; }

.head__text { min-width: 0; }

.head h2 {
  margin: 0 0 4px;
  font-size: 22px;
  line-height: 1.2;
}

.head p { margin: 0 0 4px; }

.subtitle { font-size: 15px; }
.series { font-weight: 600; color: var(--green-500); }
.muted { color: var(--text-muted); font-size: 14px; }
.small { font-size: 13px; }
.center { text-align: center; }

h3 {
  margin: 24px 0 10px;
  font-size: 17px;
}

.best-label {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.torrents {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.torrent {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.torrent--best { border-color: var(--green-500); }

.torrent__title { font-weight: 600; font-size: 15px; }
.torrent__meta { font-size: 13px; color: var(--text-muted); }

.badge {
  margin-left: 6px;
  padding: 1px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-text);
  background: var(--accent);
  border-radius: 999px;
}

.primary {
  width: 100%;
  min-height: 52px;
  margin-top: 12px;
  font: inherit;
  font-size: 17px;
  font-weight: 600;
  color: var(--accent-text);
  background: var(--accent);
  border: 0;
  border-radius: var(--radius);
  cursor: pointer;
}

.primary:disabled { opacity: 0.55; cursor: not-allowed; }

.notice {
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.link {
  min-height: 44px;
  padding: 0;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--green-500);
  background: none;
  border: 0;
  cursor: pointer;
}

.about p {
  margin: 0;
  line-height: 1.55;
  white-space: pre-line;
}

.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (prefers-color-scheme: dark) {
  .series, .link { color: #8fbf9f; }
}
</style>
