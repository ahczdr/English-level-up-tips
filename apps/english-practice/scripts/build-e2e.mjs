// CR29/CR65：E2E 构建编排。
// - SKIP_GATE=1 时跳过 typecheck/content:check（CI 已单独跑过 check，避免三连跑）；
// - VITE_E2E 在此处经 spawn env 注入，不再依赖 POSIX `VAR=x cmd` 前缀语法（Windows 本地可跑）。
import { spawnSync } from 'node:child_process'

const run = (command, args, extraEnv = {}) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (process.env.SKIP_GATE !== '1') {
  run('npm', ['run', 'typecheck'])
  run('npm', ['run', 'content:check'])
}
run('npm', ['run', 'content:build'])
run('node', ['scripts/sync-e2e-fixtures.mjs'])
run('npm', ['run', 'build:vite'], { VITE_E2E: 'true' })
