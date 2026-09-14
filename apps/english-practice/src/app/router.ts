import { createRouter, createWebHashHistory } from 'vue-router';
import TodayPage from '../features/today/TodayPage.vue';
import ReviewPage from '../features/review/ReviewPage.vue';
import ProgressPage from '../features/progress/ProgressPage.vue';
import OnboardingPage from '../features/onboarding/OnboardingPage.vue';
import LearnPage from '../features/learn/LearnPage.vue';
import SessionPage from '../features/practice/SessionPage.vue';
import DownloadsPage from '../features/settings/DownloadsPage.vue';
import SettingsPage from '../features/settings/SettingsPage.vue';
import BackupPage from '../features/settings/BackupPage.vue';

export function createAppRouter() {
  return createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', redirect: '/today' },
      {
        path: '/today',
        name: 'today',
        component: TodayPage,
      },
      {
        path: '/review',
        name: 'review',
        component: ReviewPage,
      },
      {
        path: '/progress',
        name: 'progress',
        component: ProgressPage,
      },
      {
        path: '/onboarding',
        name: 'onboarding',
        component: OnboardingPage,
      },
      {
        path: '/learn',
        name: 'learn',
        component: LearnPage,
      },
      {
        path: '/session/:id',
        name: 'session',
        component: SessionPage,
      },
      {
        path: '/downloads',
        name: 'downloads',
        component: DownloadsPage,
      },
      {
        path: '/settings',
        name: 'settings',
        component: SettingsPage,
      },
      {
        path: '/backup',
        name: 'backup',
        component: BackupPage,
      },
      { path: '/:pathMatch(.*)*', redirect: '/today' },
    ],
  });
}
