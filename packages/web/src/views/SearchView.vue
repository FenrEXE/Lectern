<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const query = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''));
</script>

<template>
  <h1>Search</h1>
  <p v-if="query">Smart search for “{{ query }}” is the next thing to build.</p>
  <p v-else>Smart search is the next thing to build.</p>
</template>
