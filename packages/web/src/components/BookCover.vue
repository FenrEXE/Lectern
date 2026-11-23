<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { coverSrc, initials as initialsOf } from '../format';

// A cover with a soft placeholder until it loads, and initials if it fails.
// `src` is the cover's original address; it's fetched through Lectern's cover
// cache as a small WebP. `width` is the largest size it's shown at.
const props = defineProps<{ src?: string; title: string; shape: 'square' | 'portrait'; width?: number }>();
const loaded = ref(false);
const failed = ref(false);
watch(
  () => props.src,
  () => {
    loaded.value = false;
    failed.value = false;
  },
);

const cached = computed(() => coverSrc(props.src, (props.width ?? 120) * 2));
const initials = computed(() => initialsOf(props.title));
</script>

<template>
  <div class="cover" :class="`cover--${shape}`">
    <img
      v-if="cached && !failed"
      :src="cached"
      alt=""
      loading="lazy"
      decoding="async"
      :class="{ shown: loaded }"
      @load="loaded = true"
      @error="failed = true"
    />
    <span v-if="!cached || failed" class="initials" aria-hidden="true">{{ initials }}</span>
  </div>
</template>

<style scoped>
.cover {
  position: relative;
  overflow: hidden;
  flex: none;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--green-700), var(--green-900));
}

.cover--square { aspect-ratio: 1; }
.cover--portrait { aspect-ratio: 2 / 3; }

img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.25s ease;
}

img.shown { opacity: 1; }

.initials {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: ui-serif, Georgia, serif;
  font-size: 1.4em;
  color: var(--cream-100);
}
</style>
