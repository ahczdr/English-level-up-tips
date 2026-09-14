import { createApp } from 'vue'
import App from './app/App.vue'
import { createAppRouter } from './app/router'
import { installE2eBridge } from './data/e2e-clock'
import './styles.css'

// T14：E2E 测试时钟/种子入口仅存在于 VITE_E2E=true 构建；生产构建为 no-op
installE2eBridge()

const app = createApp(App)
app.use(createAppRouter())
app.mount('#app')
