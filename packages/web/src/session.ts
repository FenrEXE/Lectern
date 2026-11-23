// Who's signed in, shared by every page.
import { computed, ref } from 'vue';
import type { MediaKind, Profile } from '@lectern/shared';
import { api, whenSignedOut } from './api';
import { router } from './router';

export const me = ref<Profile | null>(null);
export const setupNeeded = ref(false);
export const isAdmin = computed(() => me.value?.role === 'admin');
/** Audiobooks or ebooks, starting from the profile's own default. */
export const defaultKind = computed<MediaKind>(() => me.value?.defaultKind ?? 'audiobook');

let loaded: Promise<void> | undefined;

/** Ask the server who's signed in (once; later calls reuse the answer). */
export function loadSession(force = false): Promise<void> {
  if (!loaded || force) {
    loaded = api.me().then(
      (res) => {
        me.value = res.me;
        setupNeeded.value = res.setupNeeded;
      },
      () => {
        me.value = null;
      },
    );
  }
  return loaded;
}

export function signedIn(profile: Profile): void {
  me.value = profile;
  setupNeeded.value = false;
  loaded = Promise.resolve();
}

export async function signOut(): Promise<void> {
  await api.logout().catch(() => undefined);
  me.value = null;
  loaded = Promise.resolve();
  await router.push('/welcome');
}

// A session that ran out mid-use sends you back to the sign-in page.
whenSignedOut(() => {
  if (!me.value) return;
  me.value = null;
  void router.push({ path: '/welcome', query: { next: router.currentRoute.value.fullPath } });
});
