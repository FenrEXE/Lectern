<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Profile } from '@lectern/shared';
import { api, type AbsLibrary, type ProfileInput } from '../../api';
import { initials } from '../../format';
import { me, signedIn } from '../../session';
import ProfileEditor from './ProfileEditor.vue';

// Admin: everyone who uses Lectern, and where each person's books go.
const profiles = ref<Profile[]>([]);
const absLibraries = ref<AbsLibrary[]>([]);
const absNote = ref<string>();
const editing = ref<number | 'new'>();
const busy = ref(false);
const error = ref<string>();
const showProfiles = ref(true);

onMounted(async () => {
  profiles.value = await api.admin.users();
  showProfiles.value = (await api.admin.settings()).options.showProfiles;
  try {
    absLibraries.value = await api.admin.absLibraries();
  } catch (err) {
    absNote.value = `Couldn’t list Audiobookshelf libraries: ${(err as Error).message}`;
  }
});

function libraryName(id?: string): string | undefined {
  if (!id) return undefined;
  return absLibraries.value.find((l) => l.id === id)?.name ?? id;
}

async function save(input: ProfileInput): Promise<void> {
  busy.value = true;
  error.value = undefined;
  try {
    if (editing.value === 'new') {
      profiles.value.push(await api.admin.addUser(input));
    } else if (editing.value !== undefined) {
      const updated = await api.admin.updateUser(editing.value, input);
      profiles.value = profiles.value.map((p) => (p.id === updated.id ? updated : p));
      if (updated.id === me.value?.id) signedIn(updated);
    }
    editing.value = undefined;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function remove(id: number): Promise<void> {
  busy.value = true;
  error.value = undefined;
  try {
    await api.admin.removeUser(id);
    profiles.value = profiles.value.filter((p) => p.id !== id);
    editing.value = undefined;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function toggleShowProfiles(): Promise<void> {
  const next = !showProfiles.value;
  showProfiles.value = next;
  await api.admin.saveSettings({ options: { showProfiles: next } });
}
</script>

<template>
  <section class="panel">
    <h3>Profiles</h3>
    <p class="panel-lead">Each person signs in to their own profile, and their books go to their own library.</p>
    <p v-if="absNote" class="field-hint">{{ absNote }}</p>

    <ul class="people">
      <li v-for="p in profiles" :key="p.id" class="person">
        <div class="person__row">
          <span class="avatar" :style="{ background: p.color }" aria-hidden="true">{{ initials(p.name) }}</span>
          <div class="person__text">
            <span class="person__name">
              {{ p.name }}
              <span v-if="p.role === 'admin'" class="tag">Admin</span>
              <span v-if="p.id === me?.id" class="tag">You</span>
            </span>
            <span class="person__libs">
              Audiobooks:
              {{ p.libraries.audiobook.dir ? libraryName(p.libraries.audiobook.absLibraryId) ?? p.libraries.audiobook.dir : 'not set' }}
              · Ebooks:
              {{ p.libraries.ebook.dir ? libraryName(p.libraries.ebook.absLibraryId) ?? p.libraries.ebook.dir : 'not set' }}
            </span>
          </div>
          <button
            v-if="editing !== p.id"
            type="button"
            class="btn btn--quiet"
            :aria-label="`Edit ${p.name}`"
            @click="editing = p.id"
          >
            Edit
          </button>
        </div>
        <ProfileEditor
          v-if="editing === p.id"
          :profile="p"
          :abs-libraries="absLibraries"
          :busy="busy"
          :is-self="p.id === me?.id"
          @save="save"
          @cancel="editing = undefined"
          @remove="remove(p.id)"
        />
      </li>
    </ul>

    <p v-if="error" class="msg-error" role="alert">{{ error }}</p>

    <div v-if="editing === 'new'" class="new">
      <h4>New profile</h4>
      <ProfileEditor :abs-libraries="absLibraries" :busy="busy" @save="save" @cancel="editing = undefined" />
    </div>
    <div v-else class="btn-row">
      <button type="button" class="btn" @click="editing = 'new'">Add a profile</button>
    </div>
  </section>

  <section class="panel">
    <h3>Sign-in page</h3>
    <label class="switch">
      <input type="checkbox" :checked="showProfiles" @change="toggleShowProfiles" />
      <span>Show profile names to pick from</span>
    </label>
    <p class="field-hint">Turn off if Lectern is reachable by people outside your home; they’ll have to type a name instead.</p>
  </section>
</template>

<style scoped>
.people {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}

.person {
  padding: 12px 0;
  border-top: 1px solid var(--border);
}

.person__row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  font-family: ui-serif, Georgia, serif;
  font-size: 17px;
  font-weight: 600;
  color: #f1e6cf;
  border-radius: 12px;
}

.person__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.person__name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.person__libs {
  font-size: 13px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.new {
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.new h4 {
  margin: 0;
  font-size: 16px;
}

.switch {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  font-weight: 600;
}

.switch input {
  width: 22px;
  height: 22px;
  accent-color: var(--green-500);
}
</style>
