import { normalizeDashboardRecords } from '../../utils/dashboard-data.mjs'

export function dashboardFixtures(now = Date.now()) {
  const names = ['示例成员甲', '示例成员乙', '示例成员丙', '示例成员丁', '示例成员戊']
  const groups = ['机械组', '电控组', '硬件组', '算法组', '运营组']
  const titles = ['完成底盘结构检查', '整理电机调试记录', '验证电源保护电路', '测试目标识别模型', '准备招新宣传素材',
    '整理装配清单', '复查控制参数', '更新硬件接口文档', '整理测试问题', '完成赛前安全检查', '归档本周测试记录', '更新团队资料']
  const records = titles.map((title, index) => ({
    record_id: `demo-${index + 1}`,
    fields: {
      任务名称: title, 所属组别: groups[index % 5],
      执行人: [{ id: `person-${index % 5}`, name: names[index % 5] }, ...(index === 0 ? [{ id: 'person-1', name: names[1] }] : [])],
      发布人: [{ id: 'publisher', name: '示例负责人' }], 截止时间: index === 6 ? undefined : now + (index === 7 || index === 8 ? -1 : 1) * (index + 1) * 3600_000,
      分值: index === 10 ? undefined : index === 11 ? '待核定' : [5, '4', '3'][index % 3], 完成状态: index >= 9 ? '已完成' : '未完成',
      完成时间: index >= 9 ? now - index * 60_000 : undefined,
      备注: index === 0 ? '本地演示：检查连接与装配情况，并整理测试记录。' : ''
    }
  }))
  return { records, data: {
    development: {
      enabled: true, unavailable: false, syncing: false, updatedAt: now,
      organization: { name: 'SDUTVINCI', href: 'https://github.com/SDUTVINCI', unavailable: false, discoveredCount: 2, includedCount: 2, excludedCount: 0, updatedAt: now },
      sources: ['robot-control', 'robot-vision'].map((name,index) => ({ key: `demo-${index}`, repo: `SDUTVINCI/${name}`, href: `https://github.com/SDUTVINCI/${name}`, unavailable: false, contributionsUnavailable: false, eventsUnavailable: false, updatedAt: now })),
      contributors: [{ key: 'demo-code-1', name: 'example-a', login: 'example-a', count: 24, avatar: '', href: 'https://github.com/example-a' }, { key: 'demo-code-2', name: 'example-b', login: 'example-b', count: 12, avatar: '', href: 'https://github.com/example-b' }],
      events: [{ id: 'demo-event', repo: 'SDUTVINCI/robot-control', actor: 'example-a', actorLogin: 'example-a', actorHref: 'https://github.com/example-a', action: '推送了代码', at: now - 60_000, href: 'https://github.com/SDUTVINCI/robot-control' }]
    },
    demo: true, tasks: normalizeDashboardRecords(records), updatedAt: now, stale: false, refreshSeconds: 30,
  } }
}
