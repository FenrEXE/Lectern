<script setup lang="ts">
import { ref } from 'vue';
import ConnectionsPanel from '../components/settings/ConnectionsPanel.vue';
import MyProfile from '../components/settings/MyProfile.vue';
import ProfilesPanel from '../components/settings/ProfilesPanel.vue';
import { isAdmin } from '../session';

// Your own profile for everyone; connections and profiles for admins.
const tab = ref<'me' | 'connections' | 'profiles'>('me');
</script>

<template>
  <h1>Settings</h1>

  <div v-if="isAdmin" class="segmented tabs" role="group" aria-label="Settings sections">
    <button type="button" :aria-pressed="tab === 'me'" @click="tab = 'me'">You</button>
    <button type="button" :aria-pressed="tab === 'connections'" @click="tab = 'connections'">Connections</button>
    <button type="button" :aria-pressed="tab === 'profiles'" @click="tab = 'profiles'">Profiles</button>
  </div>

  <MyProfile v-if="tab === 'me'" />
  <ConnectionsPanel v-else-if="tab === 'connections'" />
  <ProfilesPanel v-else />
</template>

<style scoped>
h1 {
  margin: 8px 0 14px;
  font-size: 30px;
}

.tabs {
  margin-bottom: 16px;
}
</style>
