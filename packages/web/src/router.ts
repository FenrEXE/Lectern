import { createRouter, createWebHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';

// The four bottom tabs. Search, Library and Downloads load on first visit,
// which keeps the first page load small.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'Home' } },
    { path: '/search', name: 'search', component: () => import('./views/SearchView.vue'), meta: { title: 'Search' } },
    { path: '/library', name: 'library', component: () => import('./views/LibraryView.vue'), meta: { title: 'Library' } },
    { path: '/downloads', name: 'downloads', component: () => import('./views/DownloadsView.vue'), meta: { title: 'Downloads' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = title && title !== 'Home' ? `${title} · Lectern` : 'Lectern';
});
