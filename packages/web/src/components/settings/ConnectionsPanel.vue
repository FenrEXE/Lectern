<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api, type SettingView, type TestResult } from '../../api';

// Admin: how Lectern reaches MAM, qBittorrent, Audiobookshelf and the book
// info services. Values from the .env file show as defaults; anything saved
// here wins. Secrets are never shown again once saved, only their last few
// characters, and are replaced by typing a new one.

type Service = 'mam' | 'qbittorrent' | 'audiobookshelf' | 'google';

interface FieldDef {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  advanced?: boolean;
}

interface GroupDef {
  id: Service;
  title: string;
  lead: string;
  fields: FieldDef[];
}

const REGIONS = [
  ['us', 'United States'],
  ['uk', 'United Kingdom'],
  ['ca', 'Canada'],
  ['au', 'Australia'],
  ['de', 'Germany'],
  ['fr', 'France'],
  ['it', 'Italy'],
  ['es', 'Spain'],
  ['in', 'India'],
  ['jp', 'Japan'],
].map(([value, label]) => ({ value: value!, label: label! }));

const groups: GroupDef[] = [
  {
    id: 'mam',
    title: 'MyAnonamouse',
    lead: 'Lectern searches and downloads with this session. Make a dedicated one in MAM → Preferences → Security, locked to your VPN’s network.',
    fields: [
      { key: 'MAM_ID', label: 'Session cookie (mam_id)', hint: 'Paste just the value. Lectern keeps it refreshed after that.' },
    ],
  },
  {
    id: 'qbittorrent',
    title: 'qBittorrent',
    lead: 'Where Lectern sends downloads, and watches them finish.',
    fields: [
      { key: 'QB_URL', label: 'Web UI address', placeholder: 'http://localhost:8080', hint: 'Changing it? Type the password again too.' },
      { key: 'QB_USER', label: 'Username', hint: 'Leave both blank if qBittorrent skips sign-in for local addresses.' },
      { key: 'QB_PASS', label: 'Password' },
      { key: 'QB_CATEGORY', label: 'Category for Lectern’s downloads', placeholder: 'lectern' },
      { key: 'QB_SAVE_PATH', label: 'Save downloads to', hint: 'As qBittorrent sees it. Blank uses qBittorrent’s default.' },
      {
        key: 'QB_PATH_FROM',
        label: 'qBittorrent’s path…',
        hint: 'Only if qBittorrent and Lectern see the downloads under different paths.',
        advanced: true,
      },
      { key: 'QB_PATH_TO', label: '…is this path for Lectern', advanced: true },
    ],
  },
  {
    id: 'audiobookshelf',
    title: 'Audiobookshelf',
    lead: 'Lectern tells Audiobookshelf to scan after filing a book. Each profile picks its own library below.',
    fields: [
      { key: 'ABS_URL', label: 'Address', placeholder: 'http://audiobookshelf:80', hint: 'Changing it? Type the API key again too.' },
      { key: 'ABS_API_KEY', label: 'API key', hint: 'Audiobookshelf → Settings → API Keys. Use an admin’s key so every library is visible.' },
    ],
  },
  {
    id: 'google',
    title: 'Book information',
    lead: 'Where titles, series, covers and descriptions come from. Audible and Open Library need nothing; Google Books works best with your own key.',
    fields: [
      { key: 'GOOGLE_BOOKS_API_KEY', label: 'Google Books API key', hint: 'Free from Google Cloud. Without one, Google’s shared limit often runs out.' },
      { key: 'AUDIBLE_REGION', label: 'Audible store', options: REGIONS },
    ],
  },
];

const views = ref<Record<string, SettingView>>({});
const draft = reactive<Record<string, string>>({});
const busy = ref<Service>();
const results = reactive<Partial<Record<Service, TestResult & { saved?: boolean }>>>({});
const loadError = ref<string>();

// The VPN check for MAM is shown, but only the environment can change it.
const mamInterface = ref<string | null>();

function absorb(list: SettingView[]): void {
  views.value = Object.fromEntries(list.map((s) => [s.key, s]));
  for (const s of list) draft[s.key] = s.secret ? '' : (s.value ?? '');
}

onMounted(async () => {
  try {
    const loaded = await api.admin.settings();
    mamInterface.value = loaded.mamInterface;
    absorb(loaded.settings);
  } catch (err) {
    loadError.value = (err as Error).message;
  }
});

/** The changes in one group: edited values, and secrets with something typed. */
function changesIn(group: GroupDef): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of group.fields) {
    const view = views.value[f.key];
    if (!view) continue;
    const value = draft[f.key] ?? '';
    if (view.secret ? value !== '' : value !== (view.value ?? '')) out[f.key] = value;
  }
  return out;
}

const dirty = computed(() => Object.fromEntries(groups.map((g) => [g.id, Object.keys(changesIn(g)).length > 0])));

async function save(group: GroupDef, thenTest: boolean): Promise<void> {
  busy.value = group.id;
  delete results[group.id];
  try {
    const changes = changesIn(group);
    if (Object.keys(changes).length) absorb((await api.admin.saveSettings({ values: changes })).settings);
    if (thenTest) results[group.id] = await api.admin.test(group.id);
    else results[group.id] = { ok: true, message: 'Saved.', saved: true };
  } catch (err) {
    results[group.id] = { ok: false, message: (err as Error).message };
  } finally {
    busy.value = undefined;
  }
}

/** Forget the value saved here, so the .env value (or the default) applies again. */
async function reset(group: GroupDef, key: string): Promise<void> {
  busy.value = group.id;
  try {
    absorb((await api.admin.saveSettings({ values: { [key]: null } })).settings);
    results[group.id] = { ok: true, message: 'Back to the .env value.', saved: true };
  } catch (err) {
    results[group.id] = { ok: false, message: (err as Error).message };
  } finally {
    busy.value = undefined;
  }
}

function sourceLabel(v?: SettingView): string | undefined {
  if (!v) return undefined;
  if (v.source === 'environment') return 'from .env';
  if (v.source === 'saved') return 'saved here';
  return undefined;
}
</script>

<template>
  <p v-if="loadError" class="msg-error">Couldn’t load settings: {{ loadError }}</p>

  <section v-for="group in groups" :key="group.id" class="panel">
    <h3>{{ group.title }}</h3>
    <p class="panel-lead">{{ group.lead }}</p>
    <p v-if="group.id === 'mam' && mamInterface !== undefined" class="vpn" :class="{ 'vpn--off': !mamInterface }">
      <template v-if="mamInterface">Only contacts MAM while the <strong>{{ mamInterface }}</strong> VPN connection is up.</template>
      <template v-else>No VPN check is set, so MAM could be contacted from your home address.</template>
      Set with <code>MAM_REQUIRE_INTERFACE</code> in Lectern’s environment.
    </p>

    <form @submit.prevent="save(group, true)">
      <template v-for="f in group.fields" :key="f.key">
        <details v-if="f.advanced && f.key === group.fields.find((x) => x.advanced)?.key" class="advanced">
          <summary>Different paths for downloads</summary>
          <div v-for="a in group.fields.filter((x) => x.advanced)" :key="a.key" class="field">
            <label :for="a.key">{{ a.label }}</label>
            <input :id="a.key" v-model="draft[a.key]" class="input" autocomplete="off" />
            <p v-if="a.hint" class="field-hint">{{ a.hint }}</p>
          </div>
        </details>

        <div v-else-if="!f.advanced" class="field">
          <div class="label-row">
            <label :for="f.key">{{ f.label }}</label>
            <span v-if="sourceLabel(views[f.key])" class="tag">{{ sourceLabel(views[f.key]) }}</span>
            <button
              v-if="views[f.key]?.source === 'saved'"
              type="button"
              class="reset"
              :disabled="busy === group.id"
              @click="reset(group, f.key)"
            >
              Reset
            </button>
          </div>

          <select v-if="f.options" :id="f.key" v-model="draft[f.key]" class="input">
            <!-- Nothing chosen yet: show what Lectern uses by default (the first option). -->
            <option v-if="!views[f.key]?.isSet" value="">{{ f.options[0]?.label }} (default)</option>
            <option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <input
            v-else-if="views[f.key]?.secret"
            :id="f.key"
            v-model="draft[f.key]"
            class="input"
            type="password"
            autocomplete="off"
            :placeholder="views[f.key]?.isSet ? `Set${views[f.key]?.hint ? ' ' + views[f.key]?.hint : ''} · type to replace` : 'Not set'"
          />
          <input
            v-else
            :id="f.key"
            v-model="draft[f.key]"
            class="input"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :placeholder="f.placeholder"
          />
          <p v-if="f.hint" class="field-hint">{{ f.hint }}</p>
        </div>
      </template>

      <div class="btn-row">
        <button type="submit" class="btn btn--primary" :disabled="busy === group.id">
          {{ busy === group.id ? 'Working…' : dirty[group.id] ? 'Save and test' : 'Test connection' }}
        </button>
        <button v-if="dirty[group.id]" type="button" class="btn btn--quiet" :disabled="busy === group.id" @click="save(group, false)">
          Save only
        </button>
      </div>
      <p v-if="results[group.id]" :class="results[group.id]!.ok ? 'msg-ok' : 'msg-error'" role="status">
        {{ results[group.id]!.ok && !results[group.id]!.saved ? '✓ ' : '' }}{{ results[group.id]!.message }}
      </p>
    </form>
  </section>
</template>

<style scoped>
.label-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.label-row label {
  font-size: 14px;
  font-weight: 600;
}

.reset {
  min-height: 32px;
  padding: 0 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--green-500);
  background: none;
  border: 0;
  cursor: pointer;
}

.vpn {
  margin: 0 0 14px;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.45;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.vpn code { font-size: 12px; }
.vpn--off { border-color: #b3412f; }

.advanced {
  margin: 0 0 12px;
}

.advanced summary {
  min-height: 40px;
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
}

@media (prefers-color-scheme: dark) {
  .reset { color: #8fbf9f; }
}
</style>
