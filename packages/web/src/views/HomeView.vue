<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { HealthResponse } from '@lectern/shared';
import { api } from '../api';

const router = useRouter();
const query = ref('');
const health = ref<HealthResponse | null>(null);
const healthError = ref(false);

const serviceNames: Record<keyof HealthResponse['services'], string> = {
  mam: 'MyAnonamouse',
  qbittorrent: 'qBittorrent',
  audiobookshelf: 'Audiobookshelf',
};

function search(): void {
  const q = query.value.trim();
  if (q) void router.push({ name: 'search', query: { q } });
}

onMounted(async () => {
  try {
    health.value = await api.health();
  } catch {
    healthError.value = true;
  }
});
</script>

<template>
  <section class="hero">
    <img src="/icon.svg" alt="" width="64" height="64" />
    <h1>Lectern</h1>
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

  <section class="status" aria-labelledby="status-heading">
    <h2 id="status-heading">Connections</h2>
    <p v-if="healthError" class="muted">Can't reach the Lectern server.</p>
    <p v-else-if="!health" class="muted">Checking…</p>
    <ul v-else>
      <li v-for="(state, key) in health.services" :key="key">
        <span class="dot" :class="state === 'configured' ? 'dot--on' : 'dot--off'" aria-hidden="true" />
        {{ serviceNames[key] }}
        <span class="muted">{{ state === 'configured' ? 'set up' : 'not set up yet' }}</span>
      </li>
    </ul>
    <p v-if="health" class="muted version">Version {{ health.version }}</p>
  </section>
</template>

<style scoped>
.hero {
  text-align: center;
  padding: 32px 0 24px;
}

.hero h1 {
  margin: 12px 0 4px;
  font-size: 36px;
}

.tagline {
  margin: 0 0 24px;
  color: var(--text-muted);
}

.search {
  display: flex;
  gap: 8px;
  max-width: 560px;
  margin: 0 auto;
}

.search input {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 0 16px;
  font-size: 16px; /* 16px stops iOS zooming in on focus */
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.search button {
  min-height: 48px;
  padding: 0 20px;
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-text);
  background: var(--accent);
  border: 0;
  border-radius: var(--radius);
  cursor: pointer;
}

.status {
  max-width: 560px;
  margin: 16px auto 0;
  padding: 16px 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.status h2 {
  margin: 0 0 8px;
  font-size: 18px;
}

.status ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.status li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.status li .muted {
  margin-left: auto;
}

.muted {
  color: var(--text-muted);
  font-size: 14px;
}

.version {
  margin: 8px 0 0;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.dot--on { background: #3e8a5c; }
.dot--off { background: transparent; border: 2px solid var(--text-muted); }

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
