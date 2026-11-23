<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, type FolderListing } from '../../api';

// Pick a folder on the server by tapping through it, instead of typing a path.
const props = defineProps<{ start?: string }>();
const emit = defineEmits<{ pick: [path: string]; close: [] }>();

const dialog = ref<HTMLDialogElement>();
const listing = ref<FolderListing>();
const error = ref<string>();

async function open(path: string): Promise<void> {
  error.value = undefined;
  try {
    listing.value = await api.admin.folders(path);
  } catch (err) {
    error.value = (err as Error).message;
    if (!listing.value && path !== '/') await open('/');
  }
}

const join = (base: string, name: string) => (base.endsWith('/') ? base + name : `${base}/${name}`);

onMounted(() => {
  dialog.value?.showModal();
  void open(props.start || '/');
});

function choose(): void {
  if (listing.value) emit('pick', listing.value.path);
  dialog.value?.close();
}
</script>

<template>
  <dialog ref="dialog" class="picker" aria-labelledby="picker-title" @close="emit('close')">
    <div class="picker__body">
      <h3 id="picker-title">Choose a folder</h3>
      <p class="path">{{ listing?.path ?? '…' }}</p>
      <p v-if="error" class="msg-error">{{ error }}</p>

      <ul class="folders">
        <li v-if="listing?.parent">
          <button type="button" class="folder" @click="open(listing.parent!)">↑ Up one level</button>
        </li>
        <li v-for="name in listing?.folders ?? []" :key="name">
          <button type="button" class="folder" @click="open(join(listing!.path, name))">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M3 6h6l2 2h10v10H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            </svg>
            {{ name }}
          </button>
        </li>
        <li v-if="listing && listing.folders.length === 0" class="empty">No folders inside.</li>
      </ul>

      <p v-if="listing && !listing.writable" class="msg-error">Lectern can’t write to this folder, so books couldn’t be filed here.</p>

      <div class="btn-row">
        <button type="button" class="btn btn--primary" :disabled="!listing?.writable" @click="choose">Use this folder</button>
        <button type="button" class="btn btn--quiet" @click="dialog?.close()">Cancel</button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.picker {
  width: min(560px, 100%);
  max-width: 100%;
  max-height: 85dvh;
  margin: auto auto 0;
  padding: 0;
  color: var(--text);
  background: var(--bg);
  border: 0;
  border-radius: 20px 20px 0 0;
}

@media (min-width: 700px) {
  .picker { margin: auto; border-radius: 20px; }
}

.picker::backdrop { background: rgb(0 0 0 / 0.5); }

.picker__body { padding: 20px 20px calc(20px + env(safe-area-inset-bottom)); }

h3 { margin: 0 0 6px; font-size: 20px; }

.path {
  margin: 0 0 10px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 13px;
  word-break: break-all;
  color: var(--text-muted);
}

.folders {
  max-height: 46dvh;
  margin: 0 0 12px;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.folder {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  font: inherit;
  text-align: left;
  color: var(--text);
  background: var(--surface);
  border: 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.empty {
  padding: 12px;
  font-size: 14px;
  color: var(--text-muted);
}
</style>
