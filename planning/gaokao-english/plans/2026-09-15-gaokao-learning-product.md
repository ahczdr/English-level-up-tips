# 高考英语个人学习工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复验收报告中的数据与课程流程缺陷，补齐高中三年课程目录，并把 Vue PWA 做成适合手机和平板使用的个人高考英语工具。

**Architecture:** 沿用 Vue 3 + TypeScript + Dexie + Vite PWA。学习日计算集中在 domain 层，题型草稿由 SessionPage 统一按 Answer 联合类型保存，课程目录作为静态、可审核的内容元数据进入现有 content pipeline。UI 只做信息层级和样式重构，不改变本地优先的数据边界。

**Tech Stack:** Vue 3, TypeScript, Dexie, Vitest, Playwright, Vite PWA, CSS custom properties.

**Implementation status (2026-09-15):** Tasks 1-5 are implemented and validated. Task 6 automated checks are complete; `content:release` remains intentionally failing until independent review and P07 quantity/coverage gates are satisfied. A dedicated Playwright case for choice/order exit-and-reentry is still a follow-up gap; the behavior is covered by the new component unit test and the existing touch-session E2E coverage.

---

## Task 1: 客观题草稿恢复

**Files:**

- Modify: `apps/english-practice/src/features/practice/SessionPage.vue`
- Test: `apps/english-practice/tests/unit/writing.spec.ts` or new `apps/english-practice/tests/unit/session-drafts.spec.ts`

- [ ] **Step 1: Write failing tests** for choice and order answer save/load through the component exit/re-entry path, asserting no Attempt is created.
- [ ] **Step 2: Run the focused Vitest file** and confirm the new tests fail because the current watcher/restorer only accepts gaps.
- [ ] **Step 3: Implement one draft adapter** that accepts `choice`, `order`, and `gaps`, schedules the existing `saveDraft`, and restores any valid Answer returned by `loadDraft`.
- [ ] **Step 4: Run the focused file and existing session-flow tests**; confirm all pass.
- [ ] **Step 5: Add Playwright coverage** for choice and order exit/re-entry, then run the focused E2E file.

## Task 2: 实际学习日与复习调度

**Files:**

- Modify: `apps/english-practice/src/data/migrations.ts`, `apps/english-practice/src/services/settings.ts`, `apps/english-practice/src/services/learning.ts`
- Test: `apps/english-practice/tests/unit/submit.spec.ts`, `apps/english-practice/tests/unit/session-flow.spec.ts`

- [ ] **Step 1: Add a failing cross-midnight test** creating a session on one Shanghai day and submitting after midnight, expecting Attempt.studyDay and review dueDay to use the submit clock.
- [ ] **Step 2: Run the focused test and verify it fails with the old session.studyDay.**
- [ ] **Step 3: Persist the session timeZone at creation with a backward-compatible default, and use `studyDayFor(clock.now(), session.timeZone)` for Attempt and scheduler input.**
- [ ] **Step 4: Run focused tests plus migrations/settings tests.**

## Task 3: 课程目录与首批高中三年内容

**Files:**

- Create: `apps/english-practice/content/curriculum/gaokao-three-years.json`
- Create: `apps/english-practice/src/domain/curriculum.ts`
- Modify: `apps/english-practice/src/content/types.ts`, `apps/english-practice/src/features/learn/LearnPage.vue`
- Test: `apps/english-practice/tests/unit/curriculum.spec.ts`

- [ ] **Step 1: Define the curriculum schema** for `高一基础`, `高二强化`, `高三冲刺`, nine exam sections, skill IDs, level, and review status.
- [ ] **Step 2: Write failing schema tests** requiring all three years, all nine sections, nonempty learning objectives, and transparent `draft` status for unreviewed items.
- [ ] **Step 3: Add the first curated content index** with topic units and links to existing pack item IDs; do not claim it satisfies release quantity gates.
- [ ] **Step 4: Implement domain parsing and render year/stage/topic labels in the course list.**
- [ ] **Step 5: Run content preview check and curriculum tests.**

## Task 4: 空库开始与课程更新

**Files:**

- Modify: `apps/english-practice/src/services/content.ts`, `apps/english-practice/src/features/learn/LearnPage.vue`, `apps/english-practice/src/features/settings/DownloadsPage.vue`
- Test: `apps/english-practice/tests/unit/content-install.spec.ts`, new E2E course-update scenario

- [ ] **Step 1: Write failing tests** for a visible “检查课程更新” action and an empty download page link into course preparation.
- [ ] **Step 2: Implement catalog comparison and an update list without deleting old pack records.**
- [ ] **Step 3: Make the empty download state route directly to `/learn`.**
- [ ] **Step 4: Run content/download tests and the update E2E scenario.**

## Task 5: 高中生移动端 UI

**Files:**

- Modify: `apps/english-practice/src/styles.css`, `apps/english-practice/src/features/today/TodayPage.vue`, `apps/english-practice/src/features/learn/LearnPage.vue`, `apps/english-practice/src/features/progress/ProgressPage.vue`, `apps/english-practice/src/app/App.vue`
- Test: `apps/english-practice/tests/e2e/mobile-layout.spec.ts` and focused page tests

- [ ] **Step 1: Add failing layout assertions** for the single primary CTA, minimum target size, and no horizontal overflow at 360px and 390px.
- [ ] **Step 2: Add design tokens** for ink, muted text, primary blue-violet, progress amber/green, surfaces, radius, and spacing; update global header/main/card/button states.
- [ ] **Step 3: Simplify the home hierarchy** to today goal, progress ring/summary, one CTA, and secondary links; expose student-facing Chinese labels for curriculum metadata.
- [ ] **Step 4: Improve course and progress cards** for touch, selected state, loading/empty/error/success feedback, and large text.
- [ ] **Step 5: Run mobile E2E and inspect screenshots at 360x640, 390x844, and 768x1024.**

## Task 6: Full validation and delivery notes

**Files:**

- Modify: `planning/gaokao-english/verification-log.md`, `planning/gaokao-english/device-matrix.md` only with verified automated evidence

- [ ] **Step 1: Run `npm run check`.**
- [ ] **Step 2: Run `npm run test:e2e`.**
- [ ] **Step 3: Run `npm run test:smoke` and verify the output is a normal production build without E2E bridge.**
- [ ] **Step 4: Run `npm run content:release` and retain its expected failure until independent content review and quantity gates are complete.**
- [ ] **Step 5: Run `git diff --check`, inspect changed files, and report remaining real-device and human-pilot boundaries.**
