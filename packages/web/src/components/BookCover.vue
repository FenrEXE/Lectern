<script setup lang="ts">
import { ref } from 'vue';

// A cover with a soft placeholder until it loads, and initials if it fails.
const props = defineProps<{ src?: string; title: string; shape: 'square' | 'portrait' }>();
const loaded = ref(false);
const failed = ref(false);

const initials = props.title
  .split(/\s+/)
  .filter((w) => /^[\p{L}\p{N}]/u.test(w))
  .slice(0, 2)
  .map((w) => w[0]!.toUpperCase())
  .join('');
</script>

<template>
  <div class="cover" :class="`cover--${shape}`">
    <img
      v-if="src && !failed"
      :src="src"
      alt=""
      loading="lazy"
      decoding="async"
      :class="{ shown: loaded }"
      @load="loaded = true"
      @error="failed = true"
    />
    <span v-if="!src || failed" class="initials" aria-hidden="true">{{ initials }}</span>
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
