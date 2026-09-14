# T01 RED scaffold 静态审查 R1

结论：REQUEST_CHANGES。当前候选补丁不能作为有效 RED 基线直接采信；T01 未验收，T02 HOLD。

仅提取 `/private/tmp/gaokao-t01-scaffold-red-glm-response.json` 的 `choices[0].message.content`；未读取或输出 reasoning 字段，未应用产品补丁、未运行 npm 或调用其他模型。以下行号均为候选补丁各新增文件的文件内行号，不是已落盘源文件行号。

## 发现

1. **[P1] jsdom 尺寸断言形成永久假红灯。** `tests/unit/app.spec.ts:37-39` 用 getBoundingClientRect 断言 44px；当前安装的 jsdom 实现直接返回 width/height=0，业务实现正确也无法通过。单元测试还未导入实际入口 CSS，但导入也不能让 jsdom 获得布局能力。删除该单测中的布局断言并转入生产 preview 的真实浏览器冒烟，不能 mock 成 44 来通过。
2. **[P1] project references 与被引用配置不相容。** `tsconfig.json:27` 引用 tsconfig.node.json，后者无 composite 且在第 15 行设置 noEmit=true。当前 TypeScript 源码的引用校验会对有输入文件的此类父项目产生 TS6306/TS6310。修复引用结构，而非关闭 strict、排除应用/测试或忽略诊断；当前未实际执行 vue-tsc，此结论是补丁及已安装编译器源码审查，不伪称命令已失败。
3. **[P1] 失败路径不释放 wrapper/router，污染下一测试。** `tests/unit/app.spec.ts:24-27` 只清空 body/hash；第 40/52/68 行 unmount 在断言后，RED 缺按钮会提前抛出而跳过。第 71-77 行独立 router 也没有清理。应在创建时登记资源，在 afterEach 无条件 unmount、释放所有测试 router 的 history 监听，最后清理 DOM/URL。即便 helper 在 flushPromises 阶段失败也须可回收；清空 innerHTML 不等于 Vue unmount。
4. **[P2] 文字断言不等于可访问名称。** `tests/unit/app.spec.ts:31-36` 只取第一个 button 并检查 text；错误 aria-label/aria-labelledby、隐藏按钮或 role 覆盖仍可能通过。要求测试真实 button 角色和名称“开始今日练习”，不要通过删掉名称要求来消除 RED；如所选单测工具没有可访问名称计算能力，须明确能力边界，并在浏览器用真实 role/name 查询补证，不引入未经授权的依赖。
5. **[P2] 重复点击用例可把 no-op 当稳定空态。** `tests/unit/app.spec.ts:55-67` 只比较两次文本相同并排除若干关键词，按钮完全无反应也能单独通过；未核对点击后路由仍为 /today。第一次与重复点击后均须断言明确无课程空态、路由不进入虚假会话；关键词黑名单不能证明没有持久化写入，后续源码审查仍须检查无越界服务/存储调用。

补充异步要求：第 8/73 行 router.push 返回的 Promise 未 await；改为显式等待实际导航及挂载更新，不能只依赖 isReady/flushPromises 间接覆盖所有错误。URL 重置应避免主动排队新的 hash 导航事件；不得吞 router.onError、unhandled rejection 或 Vue 异常来制造干净输出。

## 给 GLM 的修正指令

你仍是 T01 全部产品代码和测试的作者。原 RED scaffold 尚未应用，package.json 已由主代理机械应用，npm install 在途。请依据以上 R1 仅返回修正后的完整 RED scaffold `apply_patch`，替代原未应用 scaffold，不返回针对尚不存在文件的 Update 补丁；不要重复新增或覆盖 package.json、lockfile，不执行或要求并发 npm install。

1. 修正测试隔离：统一可靠的 afterEach 资源清理，覆盖所有 wrapper 和 router，包括独立路由测试、失败断言及 helper 中途失败路径；清理顺序明确。使用现有 Vue Test Utils 清理能力或简单登记机制即可，不新增框架。
2. 单元测试只验证 jsdom 能真实支持的行为。把 44x44 布局测量从单测移出，并在交付说明列为浏览器验收待办；保留真实角色/名称、明确空态、重复操作和 hash 路由行为要求，修复重复点击 no-op 假阳性。
3. 消除不合法 TypeScript references。采用当前脚本可执行的简单 noEmit 检查结构，保证 src、tests 与 vite.config.ts 均有真实类型检查；不能只删 references 后让 Node/Vite 配置无人检查。若需最小扩展 typecheck 脚本，单独说明并提供针对已存在 package.json 的独立补丁，由主代理核对后机械应用；不改锁定依赖。
4. 保留可挂载的 TodayPage 最小 stub，只展示首页标题，不提前加入目标按钮/空态实现。根路由已实现的重定向用例应通过；缺按钮及其交互的目标用例应因业务行为缺失而失败。
5. 显式 await 导航和组件更新；不得用空 catch、全局忽略错误、跳过测试、allow-no-tests 或布局 mock 绕过上述问题。Vue/TS lint 配置须能实际解析本批文件，保留 strict。
6. 回传补丁及简短说明：修正文件、预期通过/失败用例、每个 RED 的业务原因，以及安装结束后由主代理执行的现有 typecheck/lint/test:unit 命令。任何安装或配置失败先回传给你修正，不算有效 RED。

主代理等待现有安装结束，再机械应用修正 scaffold 并执行检查。保存实际 cwd、Node/npm 版本、退出码、失败断言和用例数量；配置检查应通过，测试失败必须来自缺失的目标行为，且无清理/路由未处理异常。记录有效 RED 后，再交 GLM 生成最终实现补丁。R1 静态修正单不授权 T01 PASS 或 T02 派发。

## 本地只读依据

- jsdom `lib/jsdom/living/nodes/Element-impl.js:348-358`：getBoundingClientRect 的固定零值实现。
- TypeScript `lib/typescript.js:129508-129514`：非 composite/noEmit 被引用项目的诊断分支。
- Vue Test Utils `dist/vue-test-utils.cjs.js:8430-8445`：enableAutoUnmount 的 hook 清理与登记机制。
- Vue Router `dist/vue-router.mjs:72-81`：history.destroy 移除浏览器监听；第 1518-1527 行 app.unmount 的 router 订阅清理。

以上依赖均位于隔离应用 node_modules，仅只读检查，不代表在途 npm install 已成功结束。未运行实际 scaffold 测试、typecheck、lint、构建或浏览器。
