<script setup lang="ts">
import { ref } from 'vue';
import { LANGUAGES, type MediaKind } from '@lectern/shared';
import { api } from '../../api';
import { initials } from '../../format';
import { me, signedIn, signOut } from '../../session';

// Everyone's own settings: what to search by default, password, sign out.
const savingKind = ref(false);
const current = ref('');
const next = ref('');
const again = ref('');
const pwMessage = ref<{ ok: boolean; text: string }>();
const pwBusy = ref(false);

async function setKind(kind: MediaKind): Promise<void> {
  if (!me.value || me.value.defaultKind === kind) return;
  savingKind.value = true;
  try {
    signedIn(await api.updateMe({ defaultKind: kind }));
  } finally {
    savingKind.value = false;
  }
}

const savingLanguage = ref(false);

async function setLanguage(event: Event): Promise<void> {
  const language = (event.target as HTMLSelectElement).value;
  savingLanguage.value = true;
  try {
    signedIn(await api.updateMe({ language }));
  } finally {
    savingLanguage.value = false;
  }
}

async function changePassword(): Promise<void> {
  pwMessage.value = undefined;
  if (next.value !== again.value) {
    pwMessage.value = { ok: false, text: 'The new passwords don’t match.' };
    return;
  }
  pwBusy.value = true;
  try {
    signedIn(await api.updateMe({ currentPassword: current.value, newPassword: next.value }));
    pwMessage.value = { ok: true, text: 'Password changed. Other devices have been signed out.' };
    current.value = next.value = again.value = '';
  } catch (err) {
    pwMessage.value = { ok: false, text: (err as Error).message };
  } finally {
    pwBusy.value = false;
  }
}
</script>

<template>
  <section v-if="me" class="panel">
    <div class="who">
      <span class="avatar" :style="{ background: me.color }" aria-hidden="true">{{ initials(me.name) }}</span>
      <div>
        <h2>{{ me.name }}</h2>
        <span class="tag">{{ me.role === 'admin' ? 'Admin' : 'Member' }}</span>
      </div>
    </div>

    <div class="field">
      <span id="kind-label" class="field-label">Search for</span>
      <div class="segmented" role="group" aria-labelledby="kind-label">
        <button type="button" :aria-pressed="me.defaultKind === 'audiobook'" :disabled="savingKind" @click="setKind('audiobook')">
          Audiobooks
        </button>
        <button type="button" :aria-pressed="me.defaultKind === 'ebook'" :disabled="savingKind" @click="setKind('ebook')">
          Ebooks
        </button>
      </div>
      <p class="field-hint">What Search shows first. You can always switch on the Search page.</p>
    </div>

    <div class="field">
      <label for="my-language">Book language</label>
      <select id="my-language" class="input" :value="me.language" :disabled="savingLanguage" @change="setLanguage">
        <option v-for="l in LANGUAGES" :key="l.id" :value="l.id">{{ l.label }}</option>
        <option value="any">Any language</option>
      </select>
      <p class="field-hint">Search, author and series pages only show books in this language.</p>
    </div>

    <details class="password">
      <summary>Change password</summary>
      <form @submit.prevent="changePassword">
        <input type="text" autocomplete="username" :value="me.name" hidden readonly />
        <div class="field">
          <label for="pw-current">Current password</label>
          <input id="pw-current" v-model="current" class="input" type="password" autocomplete="current-password" required />
        </div>
        <div class="field">
          <label for="pw-new">New password</label>
          <input id="pw-new" v-model="next" class="input" type="password" autocomplete="new-password" minlength="8" required />
        </div>
        <div class="field">
          <label for="pw-again">New password again</label>
          <input id="pw-again" v-model="again" class="input" type="password" autocomplete="new-password" minlength="8" required />
        </div>
        <button type="submit" class="btn btn--primary" :disabled="pwBusy">Change password</button>
        <p v-if="pwMessage" :class="pwMessage.ok ? 'msg-ok' : 'msg-error'" role="status">{{ pwMessage.text }}</p>
      </form>
    </details>

    <div class="btn-row">
      <button type="button" class="btn btn--quiet" @click="signOut">Sign out</button>
    </div>
  </section>
</template>

<style scoped>
.who {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.who h2 {
  margin: 0 0 4px;
  font-size: 22px;
}

.avatar {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  font-family: ui-serif, Georgia, serif;
  font-size: 22px;
  font-weight: 600;
  color: #f1e6cf;
  border-radius: 16px;
}

.password {
  margin: 4px 0 12px;
}

.password summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  font-weight: 600;
  cursor: pointer;
}

.password form {
  padding-top: 8px;
}
</style>
