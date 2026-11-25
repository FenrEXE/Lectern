<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { TidyItem, TidyRunResponse, TidyStatus } from '@lectern/shared';
import { api, type AbsLibrary } from '../../api';

// Tidy up: check a whole Audiobookshelf library against Audible, then fix the
// books you pick. Details only (title, author, series, narrator, ASIN, year,
// a missing cover); files and folders are never moved. Every run can be undone.
const data = ref<TidyRunResponse>();
const libraries = ref<AbsLibrary[]>([]);
const libraryId = ref('');
const error = ref<string>();
const selected = ref(new Set<number>());
const confirming = ref<'apply' | 'undo'>();
let timer: ReturnType<typeof setTimeout> | undefined;
// Which run the selection was made for, so a new scan starts fresh.
let selectionFor: number | undefined;

const run = computed(() => data.value?.run ?? null);
const working = computed(() => !!run.value && ['scanning', 'applying', 'undoing'].includes(run.value.status));
const byStatus = (s: TidyStatus) => (data.value?.items ?? []).filter((i) => i.status === s);
const canFix = computed(() => byStatus('fix'));
const unsure = computed(() => byStatus('unsure'));
const notFound = computed(() => [...byStatus('not-found'), ...byStatus('error')]);
const pickable = computed(() => [...canFix.value, ...unsure.value].filter((i) => !i.appliedAt || i.undoneAt));
const picked = computed(() => pickable.value.filter((i) => selected.value.has(i.id)));

const fieldNames: Record<string, string> = {
  title: 'Title',
  authors: 'Author',
  narrators: 'Narrator',
  series: 'Series',
  asin: 'ASIN',
  publishedYear: 'Year',
  cover: 'Cover',
};

async function load(): Promise<void> {
  clearTimeout(timer);
  try {
    data.value = await api.admin.tidy();
    error.value = undefined;
    // Fresh results: tick every confident fix; "needs a look" stays unticked.
    if (run.value && run.value.status === 'ready' && selectionFor !== run.value.id) {
      selectionFor = run.value.id;
      selected.value = new Set(canFix.value.filter((i) => !i.appliedAt).map((i) => i.id));
    }
  } catch (err) {
    error.value = (err as Error).message;
  }
  if (working.value) timer = setTimeout(load, 2000);
}

async function scan(): Promise<void> {
  error.value = undefined;
  try {
    await api.admin.tidyScan(libraryId.value);
    selectionFor = undefined;
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function apply(): Promise<void> {
  if (!run.value) return;
  confirming.value = undefined;
  try {
    await api.admin.tidyApply(run.value.id, picked.value.map((i) => i.id));
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

/** Undo just one book. */
async function undoOne(item: TidyItem): Promise<void> {
  if (!run.value) return;
  try {
    await api.admin.tidyUndo(run.value.id, [item.id]);
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function undo(): Promise<void> {
  if (!run.value) return;
  confirming.value = undefined;
  try {
    await api.admin.tidyUndo(run.value.id);
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

/** Tick or untick every book in a group that can still be fixed. */
function setAll(items: TidyItem[], on: boolean): void {
  const next = new Set(selected.value);
  for (const i of items) {
    if (i.appliedAt && !i.undoneAt) continue;
    if (on) next.add(i.id);
    else next.delete(i.id);
  }
  selected.value = next;
}

function toggle(item: TidyItem): void {
  const next = new Set(selected.value);
  if (next.has(item.id)) next.delete(item.id);
  else next.add(item.id);
  selected.value = next;
}

const label = (i: TidyItem) => i.current.title || i.path || i.itemId;
const state = (i: TidyItem) => (i.error ? i.error : i.undoneAt ? 'Undone' : i.appliedAt ? 'Fixed' : undefined);

onMounted(async () => {
  void load();
  try {
    libraries.value = (await api.admin.absLibraries()).filter((l) => l.mediaType === 'book');
    libraryId.value = run.value?.libraryId ?? libraries.value[0]?.id ?? '';
  } catch (err) {
    error.value = `Couldn’t list Audiobookshelf libraries: ${(err as Error).message}`;
  }
});
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <section class="panel">
    <h3>Tidy up a library</h3>
    <p class="panel-lead">
      Checks every book in an Audiobookshelf library against Audible and lists what’s wrong: titles, authors, series and book
      numbers, narrators, missing covers. Scanning changes nothing. You pick what to fix, and every run can be undone. Files and
      folders are never moved.
    </p>

    <div class="field">
      <label for="tidy-library">Library</label>
      <select id="tidy-library" v-model="libraryId" class="input" :disabled="working">
        <option v-for="l in libraries" :key="l.id" :value="l.id">{{ l.name }}</option>
      </select>
    </div>
    <button type="button" class="btn btn--primary" :disabled="!libraryId || working" @click="scan">Scan (changes nothing)</button>
    <p v-if="error" class="msg-error">{{ error }}</p>
  </section>

  <section v-if="run" class="panel">
    <h3>{{ run.libraryName }}</h3>
    <template v-if="run.status === 'scanning'">
      <p>Checking {{ run.scanned }} of {{ run.total || '…' }} books…</p>
      <progress :value="run.scanned" :max="run.total || 1" />
      <p class="muted small">One Audible lookup at a time, so a big library takes a few minutes. You can leave this page.</p>
    </template>
    <template v-else>
      <p v-if="run.status === 'applying'" class="working">Fixing books in Audiobookshelf…</p>
      <p v-else-if="run.status === 'undoing'" class="working">Putting books back as they were…</p>
      <p v-if="run.message" class="msg-error">{{ run.message }}</p>
      <ul class="summary">
        <li><strong>{{ run.counts.fix }}</strong> can be fixed</li>
        <li><strong>{{ run.counts.unsure }}</strong> need a look</li>
        <li><strong>{{ run.counts.ok }}</strong> already right</li>
        <li><strong>{{ run.counts['not-found'] + run.counts.error }}</strong> not found</li>
      </ul>
    </template>
  </section>

  <template v-if="run && run.status !== 'scanning'">
    <section v-for="group in [
      { title: 'Can be fixed', hint: 'Clearly the same book on Audible. Ticked to start with.', items: canFix },
      { title: 'Need a look', hint: 'Probably the right book, but check before ticking.', items: unsure },
    ]" v-show="group.items.length" :key="group.title" class="panel">
      <h3>{{ group.title }} <span class="count">{{ group.items.length }}</span></h3>
      <p class="panel-lead">{{ group.hint }}</p>
      <div class="bulk">
        <button type="button" class="btn btn--quiet" :disabled="working" @click="setAll(group.items, true)">Tick all</button>
        <button type="button" class="btn btn--quiet" :disabled="working" @click="setAll(group.items, false)">Untick all</button>
      </div>
      <ul class="items">
        <li v-for="i in group.items" :key="i.id" class="item">
          <label class="item__head">
            <input
              type="checkbox"
              :checked="selected.has(i.id)"
              :disabled="working || (!!i.appliedAt && !i.undoneAt)"
              @change="toggle(i)"
            />
            <span>
              <span class="item__title">{{ label(i) }}</span>
              <span class="muted small">{{ i.current.authors.join(', ') }}<template v-if="i.path"> · {{ i.path }}</template></span>
            </span>
            <span v-if="state(i)" class="tag" :class="{ 'tag--bad': i.error }">{{ state(i) }}</span>
          </label>
          <button v-if="i.appliedAt && !i.undoneAt" type="button" class="btn btn--quiet undo-one" :disabled="working" @click="undoOne(i)">
            Undo this book
          </button>
          <p v-if="i.reason" class="muted small reason">{{ i.reason }}</p>
          <dl class="changes">
            <template v-for="c in i.changes" :key="c.field">
              <dt>{{ fieldNames[c.field] }}</dt>
              <dd><span class="from">{{ c.from }}</span> → <span class="to">{{ c.to }}</span></dd>
            </template>
          </dl>
        </li>
      </ul>
    </section>

    <details v-if="notFound.length" class="panel">
      <summary>Not found or couldn’t check ({{ notFound.length }})</summary>
      <ul class="plain">
        <li v-for="i in notFound" :key="i.id">
          <strong>{{ label(i) }}</strong> <span class="muted small">— {{ i.reason }}</span>
        </li>
      </ul>
    </details>

    <div class="actions panel">
      <template v-if="confirming === 'apply'">
        <p>Change {{ picked.length }} book{{ picked.length === 1 ? '' : 's' }} in Audiobookshelf? You can undo this afterwards.</p>
        <button type="button" class="btn btn--primary" @click="apply">Yes, fix {{ picked.length }}</button>
        <button type="button" class="btn" @click="confirming = undefined">Cancel</button>
      </template>
      <template v-else-if="confirming === 'undo'">
        <p>Put all {{ run.applied }} fixed book{{ run.applied === 1 ? '' : 's' }} back exactly as they were?</p>
        <button type="button" class="btn btn--primary" @click="undo">Yes, undo</button>
        <button type="button" class="btn" @click="confirming = undefined">Cancel</button>
      </template>
      <template v-else>
        <button type="button" class="btn btn--primary" :disabled="working || picked.length === 0" @click="confirming = 'apply'">
          Fix {{ picked.length }} selected
        </button>
        <button v-if="run.applied" type="button" class="btn" :disabled="working" @click="confirming = 'undo'">
          Undo this run ({{ run.applied }})
        </button>
      </template>
    </div>
  </template>
</template>

<style scoped>
progress {
  width: 100%;
  height: 8px;
  accent-color: var(--green-500);
}

.muted { color: var(--text-muted); }
.small { font-size: 13px; }
.working { font-weight: 600; }

.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.summary strong { font-size: 20px; }

.count {
  margin-left: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
}

.items {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.item__head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}

.item__head > span:nth-child(2) {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}

.item__head input {
  width: 22px;
  height: 22px;
  margin: 1px 0 0;
  flex: none;
  accent-color: var(--accent);
}

.item__title { font-weight: 600; }
.reason { margin: 6px 0 0 32px; }

.changes {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 8px 0 0 32px;
  font-size: 14px;
}

.changes dt { font-weight: 600; color: var(--text-muted); }
.changes dd { margin: 0; overflow-wrap: anywhere; }
.from { color: var(--text-muted); text-decoration: line-through; }
.to { font-weight: 600; }

.tag--bad { color: #b3412f; border-color: #b3412f; }

.plain {
  margin: 10px 0 0;
  padding-left: 18px;
}

.plain li { margin-bottom: 4px; }

.actions {
  position: sticky;
  bottom: calc(72px + env(safe-area-inset-bottom));
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.actions p { flex-basis: 100%; margin: 0; }
.bulk {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.undo-one {
  min-height: 36px;
  margin: 6px 0 0 32px;
  font-size: 13px;
}
</style>
