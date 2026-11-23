import { createRouter, createWebHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';

// Pages. Everything except Home loads on first visit, keeping the first load small.
// meta.public: reachable without signing in. meta.admin: admins only.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Home' } },
    { path: '/search', name: 'search', component: () => import('./views/SearchView.vue'), meta: { title: 'Search' } },
    { path: '/library', name: 'library', component: () => import('./views/LibraryView.vue'), meta: { title: 'Library' } },
    { path: '/downloads', name: 'downloads', component: () => import('./views/DownloadsView.vue'), meta: { title: 'Downloads' } },
    { path: '/author/:name', name: 'author', component: () => import('./views/AuthorView.vue'), meta: { title: 'Author' } },
    { path: '/series/:name', name: 'series', component: () => import('./views/SeriesView.vue'), meta: { title: 'Series' } },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: 'Settings' } },
    {
      path: '/welcome',
      name: 'welcome',
      component: () => import('./views/WelcomeView.vue'),
      meta: { title: 'Sign in', public: true, bare: true },
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('./views/SetupView.vue'),
      meta: { title: 'Set up', public: true, bare: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = title && title !== 'Home' ? `${title} · Lectern` : 'Lectern';
});
