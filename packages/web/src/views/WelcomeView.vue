<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ProfileCard } from '@lectern/shared';
import { api } from '../api';
import { initials } from '../format';
import { signedIn } from '../session';

// "Who's reading?" Tap your profile, then enter your password.
// If the admin has hidden names, you type your name instead.
const route = useRoute();
const router = useRouter();

const profiles = ref<ProfileCard[]>();
const chosen = ref<ProfileCard | null>(null);
const name = ref('');
const password = ref('');
const error = ref<string>();
const busy = ref(false);
const passwordBox = ref<HTMLInputElement>();

onMounted(async () => {
  try {
    profiles.value = (await api.profiles()).profiles;
  } catch {
    profiles.value = [];
  }
});

async function pick(p: ProfileCard): Promise<void> {
  chosen.value = p;
  name.value = p.name;
  password.value = '';
  error.value = undefined;
  await nextTick();
  passwordBox.value?.focus();
}

function back(): void {
  chosen.value = null;
  error.value = undefined;
}

async function submit(): Promise<void> {
  if (!name.value.trim() || !password.value) return;
  busy.value = true;
  error.value = undefined;
  try {
    const res = await api.login(name.value.trim(), password.value);
    if (res.me) signedIn(res.me);
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    await router.replace(next);
  } catch (err) {
    error.value = (err as Error).message;
    password.value = '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="welcome">
    <img src="/icon.svg" alt="" width="72" height="72" class="logo" />
    <h1>Lectern</h1>

    <p v-if="!profiles" class="muted">Loading…</p>

    <!-- Step 1: pick a profile -->
    <template v-else-if="profiles.length && !chosen">
      <p class="lead">Who’s reading?</p>
      <ul class="profiles">
        <li v-for="p in profiles" :key="p.id">
          <button type="button" class="profile" @click="pick(p)">
            <span class="profile__avatar" :style="{ background: p.color }" aria-hidden="true">{{ initials(p.name) }}</span>
            <span class="profile__name">{{ p.name }}</span>
          </button>
        </li>
      </ul>
    </template>

    <!-- Step 2: password (or name and password when names are hidden) -->
    <form v-else class="card" @submit.prevent="submit">
      <div v-if="chosen" class="chosen">
        <span class="profile__avatar profile__avatar--small" :style="{ background: chosen.color }" aria-hidden="true">
          {{ initials(chosen.name) }}
        </span>
        <span class="chosen__name">{{ chosen.name }}</span>
        <button type="button" class="link" @click="back">Not you?</button>
      </div>
      <template v-else>
        <label for="name">Your name</label>
        <input id="name" v-model="name" autocomplete="username" autocapitalize="words" required />
      </template>

      <label for="password">Password</label>
      <input
        id="password"
        ref="passwordBox"
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
      />
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" class="primary" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
    </form>
  </section>
</template>

<style scoped>
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 520px;
  margin: 0 auto;
  padding-top: 6vh;
  text-align: center;
}

.logo { border-radius: 16px; }

h1 {
  margin: 14px 0 4px;
  font-size: 34px;
}

.lead {
  margin: 8px 0 24px;
  font-size: 20px;
  color: var(--text-muted);
}

.muted { color: var(--text-muted); }

.profiles {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 20px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 112px;
  padding: 8px;
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  border-radius: var(--radius);
  cursor: pointer;
}

.profile:hover .profile__avatar { transform: scale(1.04); }

.profile__avatar {
  display: grid;
  place-items: center;
  width: 88px;
  height: 88px;
  font-family: ui-serif, Georgia, serif;
  font-size: 32px;
  font-weight: 600;
  color: #f1e6cf;
  border-radius: 24px;
  transition: transform 0.15s ease;
}

.profile__avatar--small {
  width: 40px;
  height: 40px;
  font-size: 16px;
  border-radius: 12px;
}

.profile__name {
  font-size: 16px;
  font-weight: 600;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: 20px;
  padding: 20px;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.chosen {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.chosen__name {
  flex: 1;
  font-size: 18px;
  font-weight: 600;
}

label {
  margin-top: 4px;
  font-size: 14px;
  font-weight: 600;
}

input {
  min-height: 48px;
  padding: 0 14px;
  font-size: 16px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.error {
  margin: 4px 0 0;
  color: #b3412f;
}

.primary {
  min-height: 50px;
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

.primary:disabled { opacity: 0.6; }

.link {
  min-height: 44px;
  padding: 0 4px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--green-500);
  background: none;
  border: 0;
  cursor: pointer;
}

@media (prefers-color-scheme: dark) {
  .error { color: #e08a7a; }
  .link { color: #8fbf9f; }
}
</style>
