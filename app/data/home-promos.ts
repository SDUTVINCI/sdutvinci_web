export type HomePromoTone = 'victory' | 'recruitment' | 'team'

export type HomePromoSlide = {
  kicker: string
  title: string
  highlight?: string
  summary: string
  image: string
  imageAlt: string
  href: string
  cta: string
  tone: HomePromoTone
  position?: string
}

// 首页宣传轮播只需要维护这里：数组顺序就是展示顺序，图片放在 public 目录后填写 / 开头的路径。
export const homePromoSlides: HomePromoSlide[] = [
  {
    kicker: '2026 · National First Prize',
    title: '国赛一等奖，属于每一个并肩作战的人',
    highlight: '国赛一等奖',
    summary: 'Vinci 机器人队在 2026 Robocon 排球赛中获得国赛一等奖，以赛场表现写下新的团队高光。',
    image: '/images/news/2026-robocon-volleyball/competition.jpg',
    imageAlt: 'Vinci 机器人队参加 2026 Robocon 排球赛',
    href: '/news/2026-07-16-robocon-volleyball-national-first-prize',
    cta: '阅读比赛新闻',
    tone: 'victory',
    position: 'center 56%'
  },
  {
    kicker: 'Recruitment · 2026',
    title: '把你的热爱，装进下一台机器人',
    summary: '机械、电控、算法、运营多方向开放加入。和一群认真做事的人，从第一次训练走到真实赛场。',
    image: '/images/joinus.jpg',
    imageAlt: 'Vinci 机器人队纳新活动合影',
    href: '/recruitment',
    cta: '查看纳新指南',
    tone: 'recruitment',
    position: 'center 48%'
  },
  {
    kicker: 'People of Vinci',
    title: '每一代成员，都在为下一程积蓄力量',
    summary: '认识机械、电路、控制、算法与运营方向的伙伴，查看 Vinci 历届成员与团队传承。',
    image: '/images/background_footer.png',
    imageAlt: 'Vinci 机器人队团队成员合影',
    href: '/team',
    cta: '认识团队成员',
    tone: 'team',
    position: 'center 48%'
  }
]

export const homePromoAutoplayMs = 6500
