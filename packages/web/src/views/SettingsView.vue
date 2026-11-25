<script setup lang="ts">
import { ref } from 'vue';
import ConnectionsPanel from '../components/settings/ConnectionsPanel.vue';
import MyProfile from '../components/settings/MyProfile.vue';
import ProfilesPanel from '../components/settings/ProfilesPanel.vue';
import TidyPanel from '../components/settings/TidyPanel.vue';
import { isAdmin } from '../session';

// Your own profile for everyone; connections, profiles and Tidy up for admins.
const tab = ref<'me' | 'connections' | 'profiles' | 'tidy'>('me');
</script>

<template>
  <h1>Settings</h1>

  <div v-if="isAdmin" class="segmented tabs" role="group" aria-label="Settings sections">
    <button type="button" :aria-pressed="tab === 'me'" @click="tab = 'me'">You</button>
    <button type="button" :aria-pressed="tab === 'connections'" @click="tab = 'connections'">Connections</button>
    <button type="button" :aria-pressed="tab === 'profiles'" @click="tab = 'profiles'">Profiles</button>
    <button type="button" :aria-pressed="tab === 'tidy'" @click="tab = 'tidy'">Tidy up</button>
  </div>

  <MyProfile v-if="tab === 'me'" />
  <ConnectionsPanel v-else-if="tab === 'connections'" />
  <ProfilesPanel v-else-if="tab === 'profiles'" />
  <TidyPanel v-else />
</template>

<style scoped>
h1 {
  margin: 8px 0 14px;
  font-size: 30px;
}

.tabs {
  max-width: 100%;
  margin-bottom: 16px;
  overflow-x: auto;
}

.tabs button { white-space: nowrap; }
</style>
