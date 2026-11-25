<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { LANGUAGES, type MediaKind, type Profile } from '@lectern/shared';
import { api, type AbsLibrary, type ProfileInput } from '../../api';
import FolderPicker from './FolderPicker.vue';

// The form for one profile, used both to add a profile and to change one.
const props = defineProps<{
  profile?: Profile;
  absLibraries: AbsLibrary[];
  busy: boolean;
  isSelf?: boolean;
}>();
const emit = defineEmits<{ save: [input: ProfileInput]; cancel: []; remove: [] }>();

const kinds: Array<{ kind: MediaKind; label: string }> = [
  { kind: 'audiobook', label: 'Audiobooks' },
  { kind: 'ebook', label: 'Ebooks' },
];

const form = reactive({
  name: props.profile?.name ?? '',
  password: '',
  role: props.profile?.role ?? ('member' as 'admin' | 'member'),
  defaultKind: props.profile?.defaultKind ?? ('audiobook' as MediaKind),
  language: props.profile?.language ?? 'english',
  libraries: {
    audiobook: {
      dir: props.profile?.libraries.audiobook.dir ?? '',
      absLibraryId: props.profile?.libraries.audiobook.absLibraryId ?? '',
    },
    ebook: {
      dir: props.profile?.libraries.ebook.dir ?? '',
      absLibraryId: props.profile?.libraries.ebook.absLibraryId ?? '',
    },
  },
});

const picking = ref<MediaKind>();

// For each library folder: will books be hardlinked there, or copied?
// Checked for real (a tiny test file), shortly after the folder changes.
const linkCheck = reactive<Partial<Record<MediaKind, { result: string; message: string }>>>({});
const linkTimers: Partial<Record<MediaKind, ReturnType<typeof setTimeout>>> = {};
for (const k of ['audiobook', 'ebook'] as const) {
  watch(
    () => form.libraries[k].dir,
    (dir) => {
      clearTimeout(linkTimers[k]);
      delete linkCheck[k];
      if (!dir?.startsWith('/')) return;
      linkTimers[k] = setTimeout(async () => {
        try {
          linkCheck[k] = await api.admin.hardlinkCheck(dir);
        } catch {
          delete linkCheck[k];
        }
      }, 600);
    },
    { immediate: true },
  );
}
const confirmRemove = ref(false);
const prefix = `p${props.profile?.id ?? 'new'}`;

function submit(): void {
  const input: ProfileInput = {
    name: form.name,
    role: form.role,
    defaultKind: form.defaultKind,
    language: form.language,
    libraries: form.libraries,
  };
  if (form.password) input.password = form.password;
  emit('save', input);
}
</script>

<template>
  <form class="editor" @submit.prevent="submit">
    <div class="grid">
      <div class="field">
        <label :for="`${prefix}-name`">Name</label>
        <input :id="`${prefix}-name`" v-model="form.name" class="input" maxlength="40" required autocomplete="off" />
      </div>
      <div class="field">
        <label :for="`${prefix}-pw`">{{ profile ? 'New password' : 'Password' }}</label>
        <input
          :id="`${prefix}-pw`"
          v-model="form.password"
          class="input"
          type="password"
          autocomplete="new-password"
          minlength="8"
          :required="!profile"
          :placeholder="profile ? 'Leave blank to keep' : 'At least 8 characters'"
        />
      </div>
      <div class="field">
        <label :for="`${prefix}-role`">Role</label>
        <select :id="`${prefix}-role`" v-model="form.role" class="input">
          <option value="member">Member</option>
          <option value="admin">Admin (also manages settings)</option>
        </select>
        <p class="field-hint">Everyone can search and add books. Admins can also change connections and profiles.</p>
      </div>
      <div class="field">
        <label :for="`${prefix}-kind`">Searches for</label>
        <select :id="`${prefix}-kind`" v-model="form.defaultKind" class="input">
          <option value="audiobook">Audiobooks</option>
          <option value="ebook">Ebooks</option>
        </select>
      </div>
      <div class="field">
        <label :for="`${prefix}-language`">Book language</label>
        <select :id="`${prefix}-language`" v-model="form.language" class="input">
          <option v-for="l in LANGUAGES" :key="l.id" :value="l.id">{{ l.label }}</option>
          <option value="any">Any language</option>
        </select>
      </div>
    </div>

    <fieldset v-for="k in kinds" :key="k.kind" class="library">
      <legend>{{ k.label }} library</legend>
      <div class="field">
        <label :for="`${prefix}-${k.kind}-dir`">Folder books are filed into</label>
        <div class="with-button">
          <input
            :id="`${prefix}-${k.kind}-dir`"
            v-model="form.libraries[k.kind].dir"
            class="input"
            autocomplete="off"
            spellcheck="false"
            placeholder="Not set: adding is off"
          />
          <button type="button" class="btn btn--quiet" @click="picking = k.kind">Browse</button>
        </div>
        <p
          v-if="linkCheck[k.kind]"
          class="field-hint link-check"
          :class="{ 'link-check--ok': linkCheck[k.kind]!.result === 'linked', 'link-check--bad': linkCheck[k.kind]!.result === 'copy' }"
        >
          {{ linkCheck[k.kind]!.message }}
        </p>
      </div>
      <div class="field">
        <label :for="`${prefix}-${k.kind}-abs`">Audiobookshelf library to scan</label>
        <select :id="`${prefix}-${k.kind}-abs`" v-model="form.libraries[k.kind].absLibraryId" class="input">
          <option value="">None</option>
          <option v-for="lib in absLibraries" :key="lib.id" :value="lib.id">
            {{ lib.name }}{{ lib.folders.length ? ` (${lib.folders.join(', ')})` : '' }}
          </option>
          <option
            v-if="form.libraries[k.kind].absLibraryId && !absLibraries.some((l) => l.id === form.libraries[k.kind].absLibraryId)"
            :value="form.libraries[k.kind].absLibraryId"
          >
            {{ form.libraries[k.kind].absLibraryId }}
          </option>
        </select>
        <p class="field-hint">Audiobookshelf shows its own folder paths, which can differ from Lectern’s.</p>
      </div>
    </fieldset>

    <div class="btn-row">
      <button type="submit" class="btn btn--primary" :disabled="busy">{{ profile ? 'Save' : 'Add profile' }}</button>
      <button type="button" class="btn btn--quiet" :disabled="busy" @click="emit('cancel')">Cancel</button>
      <template v-if="profile && !isSelf">
        <button v-if="!confirmRemove" type="button" class="btn btn--danger push" :disabled="busy" @click="confirmRemove = true">
          Remove
        </button>
        <button v-else type="button" class="btn btn--danger push" :disabled="busy" @click="emit('remove')">
          Tap again to remove {{ profile.name }}
        </button>
      </template>
    </div>

    <FolderPicker
      v-if="picking"
      :start="form.libraries[picking].dir || '/'"
      @pick="(p) => (form.libraries[picking!].dir = p)"
      @close="picking = undefined"
    />
  </form>
</template>

<style scoped>
.editor {
  padding-top: 12px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0 14px;
}

.library {
  margin: 4px 0 12px;
  padding: 12px 14px 2px;
  border: 1px solid var(--border);
  border-radius: 12px;
}

.library legend {
  padding: 0 6px;
  font-weight: 600;
}

.with-button {
  display: flex;
  gap: 8px;
}

.with-button .input {
  flex: 1;
  min-width: 0;
}

.push {
  margin-left: auto;
}
.link-check--ok { color: #3e8a5c; }
.link-check--bad { color: #b3412f; font-weight: 600; }

@media (prefers-color-scheme: dark) {
  .link-check--ok { color: #6fbf8c; }
  .link-check--bad { color: #e08a7a; }
}
</style>
