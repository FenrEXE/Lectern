<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { initials } from './format';
import { me } from './session';

// A slim top bar (name + your profile) and a bottom tab bar, like Audible's.
// The sign-in and setup pages show neither.
const route = useRoute();
const bare = computed(() => route.meta.bare === true);

const tabs = [
  { to: '/', label: 'Home', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/search', label: 'Search', icon: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM21 21l-5-5' },
  { to: '/library', label: 'Library', icon: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.8-1 3 15.5-3.8 1z' },
  { to: '/downloads', label: 'Downloads', icon: 'M12 3v12M7 10l5 5 5-5M4 21h16' },
];
</script>

<template>
  <div class="shell" :class="{ 'shell--bare': bare }">
    <header v-if="!bare && me" class="topbar">
      <RouterLink to="/" class="brand">
        <img src="/icon.svg" alt="" width="28" height="28" />
        <span>Lectern</span>
      </RouterLink>
      <RouterLink to="/settings" class="avatar" :style="{ background: me.color }" :aria-label="`${me.name}: profile and settings`">
        {{ initials(me.name) }}
      </RouterLink>
    </header>

    <main class="content">
      <RouterView />
    </main>

    <nav v-if="!bare && me" class="tabbar" aria-label="Main">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="tab"
        exact-active-class="tab--active"
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            :d="tab.icon"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>{{ tab.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100dvh;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 960px;
  margin: 0 auto;
  padding: calc(8px + env(safe-area-inset-top)) 16px 8px;
  background: var(--bg);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-family: ui-serif, Georgia, serif;
  font-size: 20px;
  font-weight: 600;
  text-decoration: none;
}

.brand img {
  border-radius: 7px;
}

.avatar {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  font-size: 15px;
  font-weight: 700;
  color: #f1e6cf;
  text-decoration: none;
  border-radius: 50%;
}

.content {
  max-width: 960px;
  margin: 0 auto;
  padding: 8px 16px calc(var(--tabbar-h) + 24px + env(safe-area-inset-bottom));
}

.shell--bare .content {
  padding-top: calc(24px + env(safe-area-inset-top));
  padding-bottom: 24px;
}

.tabbar {
  position: fixed;
  inset: auto 0 0 0;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--surface);
  border-top: 1px solid var(--border);
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 44px;
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: none;
}

.tab--active {
  color: var(--accent);
  font-weight: 600;
}
</style>
