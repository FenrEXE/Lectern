import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { loadSession, me, setupNeeded } from './session';
import './styles.css';

// Sign-in check before every page. It lives here rather than in router.ts
// because session.ts needs the router too (to send people to the sign-in page).
router.beforeEach(async (to) => {
  await loadSession();
  if (setupNeeded.value) return to.name === 'setup' ? true : { name: 'setup' };
  if (to.name === 'setup') return { name: me.value ? 'home' : 'welcome' };
  if (!me.value && !to.meta.public) return { name: 'welcome', query: to.fullPath === '/' ? {} : { next: to.fullPath } };
  if (me.value && to.name === 'welcome') return { name: 'home' };
  return true;
});

createApp(App).use(router).mount('#app');
