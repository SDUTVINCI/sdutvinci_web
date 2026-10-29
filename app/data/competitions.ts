/** 北京时间赛事/备赛目标；未确认日期保留 null，严禁沿用其它队伍日期。 */
export type CompetitionConfig = {
  name: string
  shortName?: string
  startsAt: string | null
  dateStatus: 'pending' | 'historical' | 'tentative' | 'confirmed' | 'target'
  referenceYear?: number
  enabled: boolean
  sourceUrl?: string
  referenceNote?: string
}

// 2026-10-29 核对官方通知；2027 正式节点未公布，采用上一赛季同期。
// 比赛为赛期首日（含裁判培训），不是首轮对局或开幕式时间；按当日零点计时。
export const competitions: CompetitionConfig[] = [
  {
    name: '2027 ROBOCON 中期检查', shortName: '中期检查',
    startsAt: '2027-04-20T23:59:00+08:00',
    dateStatus: 'historical', referenceYear: 2026, enabled: true,
    sourceUrl: 'https://www.robocon.org.cn/sys-nd/82.html',
    referenceNote: '按2026年4月20日23:59材料提交截止同期推算；非2027正式通知。'
  },
  {
    name: '2027 ROBOCON 比赛', shortName: '比赛倒计时',
    startsAt: '2027-07-09T00:00:00+08:00',
    dateStatus: 'historical', referenceYear: 2026, enabled: true,
    sourceUrl: 'https://www.robocon.org.cn/sys-nd/97.html',
    referenceNote: '按2026参赛手册赛期首日7月9日同期推算，以当日零点为备赛节点；非开赛时刻或2027正式赛程。'
  }
]
