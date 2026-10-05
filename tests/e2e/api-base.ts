const value = process.env.TONGYE_E2E_API_PORT || '8787'
if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) throw new Error('E2E API 端口须为1024–65535整数')
export const API_PORT = Number(value)
export const API_BASE = `http://localhost:${API_PORT}`
// Keep production SW tests beside this run's isolated UI, not another project.
const ui = new URL(process.env.TONGYE_E2E_BASE_URL || 'http://localhost:5173')
const productionPort = Number(ui.port) + 1
if (ui.protocol !== 'http:' || ui.hostname !== 'localhost' || !/^\d+$/.test(ui.port) || productionPort < 1024 || productionPort > 65535) throw new Error('E2E UI 须使用有效显式 localhost 端口，且下一端口可用')
export const PRODUCTION_PORT = productionPort
export const PRODUCTION_BASE = `http://localhost:${PRODUCTION_PORT}`
