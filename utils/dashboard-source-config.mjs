// 非敏感数据表标识；仅对已接通的 SDUT 任务表启用默认关联，凭证始终来自服务器环境。
const SDUT_REQUIRED = 'tblODdgBNZ6tNGRt'
const SDUT_OPTIONAL = 'tblaMqiIIS6UYIYZ'
const SDUT_MEMBERS = 'tblOCW8BSo1cZ51l'
const SDUT_WIKI = 'https://sdutvincirobot.feishu.cn/wiki/TBGiwbyFmimzpTkvCe0c9lP0nad'

export function dashboardSourceConfig(env) {
  const isSdut = env.FEISHU_BITABLE_TABLE_ID === SDUT_REQUIRED
  const table = (value, fallback) => value === 'off' ? '' : value || fallback
  const optional = table(env.FEISHU_OPTIONAL_TABLE_ID, isSdut ? SDUT_OPTIONAL : '')
  const members = table(env.FEISHU_MEMBERS_TABLE_ID, isSdut ? SDUT_MEMBERS : '')
  const sources = [{ kind: 'required', label: '每周必做', table: env.FEISHU_BITABLE_TABLE_ID, view: env.FEISHU_BITABLE_VIEW_ID || '' }]
  if (optional) sources.push({ kind: 'optional', label: '选做任务', table: optional, view: '' })
  if (new Set([...sources.map(source => source.table), ...(members ? [members] : [])]).size !== sources.length + Number(Boolean(members))) {
    throw new Error('INVALID_SOURCE_CONFIG')
  }
  // 只允许知识库页面入口，不把 Base token 或任何服务端下载凭证带到浏览器。
  const page = env.FEISHU_DASHBOARD_URL || (isSdut ? SDUT_WIKI : '')
  const wiki = /^https:\/\/[a-z\d-]+\.feishu\.cn\/wiki\/[A-Za-z0-9]+$/.test(page) ? page : ''
  return { sources, members, wiki }
}
