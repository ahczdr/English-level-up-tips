/* eslint-disable no-var -- 环境注入的全局变量需要 var 声明 */
// T16：构建期注入的全局常量（vite.config define）
declare var __APP_VERSION__: string | undefined
declare var __BUILD_SHA__: string | undefined
