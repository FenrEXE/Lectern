<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { signedIn } from '../session';

// First run only: create the admin profile. It needs the setup code Lectern
// prints in its log, so only whoever runs the server can claim it.
const router = useRouter();
const code = ref('');
const showProfiles = ref(true);
const name = ref('');
const password = ref('');
const confirm = ref('');
const error = ref<string>();
const busy = ref(false);

async function submit(): Promise<void> {
  error.value = undefined;
  if (password.value !== confirm.value) {
    error.value = 'The two passwords don’t match.';
    return;
  }
  busy.value = true;
  try {
    const res = await api.setup({
      code: code.value.trim(),
      name: name.value.trim(),
      password: password.value,
      showProfiles: showProfiles.value,
    });
    if (res.me) signedIn(res.me);
    await router.replace({ name: 'settings' });
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="setup">
    <img src="/icon.svg" alt="" width="72" height="72" class="logo" />
    <h1>Welcome to Lectern</h1>
    <p class="lead">Create your profile. As the first one, it’s the admin: you’ll connect MAM, qBittorrent and Audiobookshelf next, and add profiles for everyone else.</p>

    <form class="card" @submit.prevent="submit">
      <label for="code">Setup code</label>
      <input id="code" v-model="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" required />
      <p class="hint">Lectern prints it in its log when it starts, for example with <code>docker logs lectern</code>.</p>

      <label for="name">Your name</label>
      <input id="name" v-model="name" autocomplete="username" autocapitalize="words" maxlength="40" required />

      <label for="password">Password</label>
      <input id="password" v-model="password" type="password" autocomplete="new-password" minlength="8" required />
      <p class="hint">At least 8 characters.</p>

      <label for="confirm">Password again</label>
      <input id="confirm" v-model="confirm" type="password" autocomplete="new-password" minlength="8" required />

      <label class="check">
        <input v-model="showProfiles" type="checkbox" />
        <span>Show profile names on the sign-in page</span>
      </label>
      <p class="hint">Easier at home. Turn it off if Lectern can be reached from outside your home; people will type their name instead. You can change this later in Settings.</p>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" class="primary" :disabled="busy">{{ busy ? 'Creating…' : 'Create admin profile' }}</button>
    </form>
  </section>
</template>

<style scoped>
.setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 480px;
  margin: 0 auto;
  padding-top: 4vh;
  text-align: center;
}

.logo { border-radius: 16px; }

h1 {
  margin: 14px 0 6px;
  font-size: 30px;
}

.lead {
  margin: 0 0 20px;
  color: var(--text-muted);
  line-height: 1.5;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  padding: 20px;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
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

.hint {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.hint code {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.check {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin-top: 8px;
  font-weight: 600;
}

.check input {
  width: 22px;
  min-height: 22px;
  margin: 0;
  accent-color: var(--accent);
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

@media (prefers-color-scheme: dark) {
  .error { color: #e08a7a; }
}
</style>
