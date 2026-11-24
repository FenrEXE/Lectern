<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { MamStatsResponse } from '@lectern/shared';
import { api } from '../api';
import { ago, bytes } from '../format';

// The MAM account at a glance: unsatisfied torrents (downloads not yet seeded
// for 72 hours; MAM blocks new downloads at the limit) and the upload ratio
// (MAM expects at least 1). Shows Lectern's saved copy; MAM itself is asked
// hourly in the background, or by tapping refresh (at most every 5 minutes).
const data = ref<MamStatsResponse>();
const refreshing = ref(false);
const now = ref(Date.now());

const stats = computed(() => data.value?.stats ?? null);
const unsatShare = computed(() => {
  const u = stats.value?.unsat;
  return u && u.limit > 0 ? Math.min(1, u.count / u.limit) : 0;
});
// green below 80% of the limit, amber from 80%, red at the limit
const unsatLevel = computed(() => (unsatShare.value >= 1 ? 'bad' : unsatShare.value >= 0.8 ? 'warn' : 'ok'));
// red below 1 (MAM's minimum), amber just above it
const ratioLevel = computed(() => {
  const r = stats.value?.ratio;
  if (r === null || r === undefined) return 'ok';
  return r < 1 ? 'bad' : r < 1.2 ? 'warn' : 'ok';
});
const canRefresh = computed(() => !refreshing.value && now.value >= (data.value?.refreshAllowedAt ?? 0));

async function refresh(): Promise<void> {
  refreshing.value = true;
  try {
    data.value = await api.refreshMamStats();
  } finally {
    refreshing.value = false;
    now.value = Date.now();
  }
}

onMounted(async () => {
  try {
    data.value = await api.mamStats();
  } catch {
    data.value = undefined;
  }
});
</script>

<template>
  <section v-if="data" class="stats panel" aria-label="MAM account">
    <template v-if="stats">
      <div class="stat" :class="`stat--${unsatLevel}`">
        <span class="label">Unsatisfied</span>
        <span class="value">
          <template v-if="stats.unsat">{{ stats.unsat.count }}<small> / {{ stats.unsat.limit }}</small></template>
          <template v-else>–</template>
        </span>
        <span class="meter" aria-hidden="true"><span :style="{ width: `${unsatShare * 100}%` }" /></span>
        <span class="note">Seeding under 3 days</span>
      </div>
      <div class="stat" :class="`stat--${ratioLevel}`">
        <span class="label">Ratio</span>
        <span class="value">{{ stats.ratio === null ? '∞' : stats.ratio.toFixed(2) }}</span>
        <span class="note">↑ {{ bytes(stats.uploadedBytes) }} · ↓ {{ bytes(stats.downloadedBytes) }}</span>
        <span class="note">Keep it at 1 or above</span>
      </div>
    </template>
    <p v-else class="empty">MAM account stats appear here after Lectern’s first hourly check.</p>

    <div class="foot">
      <span>
        <template v-if="data.problem">Last check didn’t work: {{ data.problem }}</template>
        <template v-else-if="stats">Checked {{ ago(stats.checkedAt, now) }}</template>
      </span>
      <button type="button" class="refresh" :disabled="!canRefresh" @click="refresh">
        {{ refreshing ? 'Checking…' : 'Refresh' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  margin-bottom: 16px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  --level: #3e8a5c;
}

.stat--warn { --level: #b9832b; }
.stat--bad { --level: #b3412f; }

.label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.value {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--level);
  font-variant-numeric: tabular-nums;
}

.value small {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-muted);
}

.meter {
  height: 6px;
  margin: 4px 0 2px;
  overflow: hidden;
  background: var(--border);
  border-radius: 999px;
}

.meter span {
  display: block;
  height: 100%;
  background: var(--level);
  border-radius: inherit;
}

.note {
  font-size: 12px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.empty {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--text-muted);
}

.foot {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.refresh {
  min-height: 36px;
  padding: 0 12px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}

.refresh:disabled { opacity: 0.5; cursor: default; }

@media (prefers-color-scheme: dark) {
  .stat { --level: #6fbf8c; }
  .stat--warn { --level: #e0b25a; }
  .stat--bad { --level: #e08a7a; }
}
</style>
