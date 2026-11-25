<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import type { LibraryRequest, StatusResponse } from '@lectern/shared';
import { api } from '../api';
import BookTile from '../components/BookTile.vue';
import MamStatsBar from '../components/MamStatsBar.vue';
import { askToSearch } from '../searchIntent';
import { isAdmin, me } from '../session';

const router = useRouter();
const query = ref('');
const status = ref<StatusResponse>();
const recent = ref<LibraryRequest[]>([]);

const serviceNames: Record<keyof StatusResponse['services'], string> = {
  mam: 'MyAnonamouse',
  qbittorrent: 'qBittorrent',
  audiobookshelf: 'Audiobookshelf',
};

const missing = computed(() =>
  status.value ? (Object.keys(status.value.services) as Array<keyof StatusResponse['services']>).filter((k) => status.value!.services[k] !== 'configured') : [],
);
const inProgress = computed(() => recent.value.filter((r) => ['sending', 'downloading', 'importing'].includes(r.status)).length);
const added = computed(() => recent.value.filter((r) => r.status === 'done').slice(0, 12));

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function search(): void {
  const q = query.value.trim();
  if (!q) return;
  askToSearch();
  void router.push({ name: 'search', query: { q } });
}

onMounted(async () => {
  const [s, r] = await Promise.allSettled([api.status(), api.requests()]);
  if (s.status === 'fulfilled') status.value = s.value;
  if (r.status === 'fulfilled') recent.value = r.value;
});
</script>

<template>
  <MamStatsBar />

  <section class="hero">
    <h1>{{ greeting() }}, {{ me?.name }}</h1>
    <p class="tagline">Find a book, tap once, start listening.</p>

    <form class="search" role="search" @submit.prevent="search">
      <label for="home-search" class="visually-hidden">Search books</label>
      <input
        id="home-search"
        v-model="query"
        type="search"
        placeholder="Author, title or series"
        autocomplete="off"
        enterkeyhint="search"
      />
      <button type="submit">Search</button>
    </form>
  </section>

  <!-- Setup still needed: admins get a link to Settings; others a plain note. -->
  <section v-if="status && isAdmin && missing.length" class="panel notice">
    <h2>Finish setting up</h2>
    <p>Not connected yet: {{ missing.map((k) => serviceNames[k]).join(', ') }}.</p>
    <RouterLink to="/settings" class="btn btn--primary">Open Settings</RouterLink>
  </section>
  <section v-else-if="status && !status.canAdd.audiobook && !status.canAdd.ebook" class="panel notice">
    <p>You can search, but adding books isn’t set up for your profile yet. {{ isAdmin ? 'Set your library folders in Settings → Profiles.' : 'Ask an admin to set your library.' }}</p>
  </section>

  <RouterLink v-if="inProgress" to="/downloads" class="panel progress">
    <span class="dot" aria-hidden="true" />
    {{ inProgress }} book{{ inProgress === 1 ? '' : 's' }} on the way
    <span class="arrow" aria-hidden="true">›</span>
  </RouterLink>

  <section v-if="added.length" class="recent">
    <h2>Recently added</h2>
    <ul class="shelf">
      <li v-for="r in added" :key="r.id">
        <BookTile
          :book="r.book"
          :kind="r.kind"
          @open="r.book.authors[0] && router.push({ name: 'author', params: { name: r.book.authors[0] }, query: { kind: r.kind } })"
        />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.hero {
  padding: 16px 0 20px;
}

.hero h1 {
  margin: 0 0 4px;
  font-size: 30px;
  line-height: 1.2;
}

.tagline {
  margin: 0 0 18px;
  color: var(--text-muted);
}

.search {
  display: flex;
  gap: 8px;
  max-width: 640px;
}

.search input {
  flex: 1;
  min-width: 0;
  min-height: 50px;
  padding: 0 16px;
  font-size: 16px; /* 16px stops iOS zooming in on focus */
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.search button {
  min-height: 50px;
  padding: 0 20px;
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-text);
  background: var(--accent);
  border: 0;
  border-radius: var(--radius);
  cursor: pointer;
}

.notice h2 {
  margin: 0 0 4px;
  font-size: 19px;
}

.notice p {
  margin: 0 0 12px;
}

.progress {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  font-weight: 600;
  text-decoration: none;
}

.progress .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #b9832b;
}

.progress .arrow {
  margin-left: auto;
  font-size: 22px;
  color: var(--text-muted);
}

.recent h2 {
  margin: 8px 0 10px;
  font-size: 20px;
}

.shelf {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 132px;
  gap: 14px;
  margin: 0 -16px;
  padding: 0 16px 6px;
  overflow-x: auto;
  list-style: none;
}
</style>
