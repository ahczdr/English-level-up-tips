# english-practice

高考英语练习 PWA：Vue 3 + TypeScript + Dexie（IndexedDB）+ Vite PWA，本地优先，内容包经 `content/` 管线打包与校验。

## 命令

```bash
npm ci                 # 安装依赖（Node 24）
npm run check          # 内容门禁 + typecheck + lint + 单元测试
npm run test:e2e       # E2E 构建 + 三引擎浏览器测试 + 离线套件
npm run test:smoke     # 发布构建 + 冒烟（precache 仅 shell、无 E2E 桥、SW 注册）
npm run content:build  # 生成 public/content-packs 与 content-catalog.json
npm run content:release# 发布门禁（exit 78 = 审核缺项/题量缺口暂缓；其余错误硬失败）
```

## 结构速览

- `content/`：作者内容源（inbox 留档 → items/resources/units 结构化 → pack-manifests 打包清单）
- `public/content-packs/`：构建产物，只保留当前 manifest 版本；同版本内容不可变，改内容必须提升版本号
- `src/services/`：学习/内容/下载/写作服务（统一 Result 错误协议）
- `src/domain/`：计划器、调度、成长统计、判分（纯函数）
- `src/data/`：Dexie schema 与迁移（v3 起 per-profile 曝光账本 exposureLog）

架构、CI、BUILD_SHA 约定与发布流程见仓库根 `MAINTENANCE.md`；评审与验证记录见 `planning/gaokao-english/`。
