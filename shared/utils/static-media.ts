const staticMediaUrls: Readonly<Record<string, string>> = {
  '/images/background.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/background-6c09ec06.webp',
  '/images/background_footer.png': 'https://cdn.sdutvincirobot.top/site-assets/images/background_footer-03b5c48e.webp',
  '/images/cheer.png': 'https://cdn.sdutvincirobot.top/site-assets/images/cheer-2f0a891b.webp',
  '/images/cooporate.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/cooporate-34c74ea5.webp',
  '/images/joinus.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/joinus-1ff5973e.webp',
  '/images/logo.png': 'https://cdn.sdutvincirobot.top/site-assets/images/logo-e355a71c.webp',
  '/images/logo_black.png': 'https://cdn.sdutvincirobot.top/site-assets/images/logo_black-e355a71c.webp',
  '/images/member_photo/冯平川.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%86%AF%E5%B9%B3%E5%B7%9D-6264efd0.webp',
  '/images/member_photo/刘业晗.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%88%98%E4%B8%9A%E6%99%97-6c6cfccf.webp',
  '/images/member_photo/卢湘东.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%8D%A2%E6%B9%98%E4%B8%9C-0e5ea60b.webp',
  '/images/member_photo/商芷晨.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%95%86%E8%8A%B7%E6%99%A8-296dbe56.webp',
  '/images/member_photo/孙亚诚.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%AD%99%E4%BA%9A%E8%AF%9A-0fbcfe9c.webp',
  '/images/member_photo/孙凯臣.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%AD%99%E5%87%AF%E8%87%A3-e7872b8a.webp',
  '/images/member_photo/宫金良.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%AE%AB%E9%87%91%E8%89%AF-844424a5.webp',
  '/images/member_photo/尚凡兴.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%B0%9A%E5%87%A1%E5%85%B4-9f40be1b.webp',
  '/images/member_photo/崔功岩.png': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%B4%94%E5%8A%9F%E5%B2%A9-2a57bb7f.webp',
  '/images/member_photo/崔启文.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%B4%94%E5%90%AF%E6%96%87-20bf4f60.webp',
  '/images/member_photo/巩丽.png': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%B7%A9%E4%B8%BD-25fc726f.webp',
  '/images/member_photo/张丽敏.png': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%BC%A0%E4%B8%BD%E6%95%8F-52964e0b.webp',
  '/images/member_photo/张彦斐.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%BC%A0%E5%BD%A6%E6%96%90-300d7799.webp',
  '/images/member_photo/张爱煜.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%BC%A0%E7%88%B1%E7%85%9C-f6010b39.webp',
  '/images/member_photo/张益豪.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%BC%A0%E7%9B%8A%E8%B1%AA-d5952078.webp',
  '/images/member_photo/张长飞.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%BC%A0%E9%95%BF%E9%A3%9E-681ab325.webp',
  '/images/member_photo/房梓豪.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E6%88%BF%E6%A2%93%E8%B1%AA-6f61aa68.webp',
  '/images/member_photo/曹启硕.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E6%9B%B9%E5%90%AF%E7%A1%95-696146df.webp',
  '/images/member_photo/李坤.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E6%9D%8E%E5%9D%A4-249daadf.webp',
  '/images/member_photo/杨智伟.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E6%9D%A8%E6%99%BA%E4%BC%9F-6d7e1d46.webp',
  '/images/member_photo/林沼君.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E6%9E%97%E6%B2%BC%E5%90%9B-2c8fb363.webp',
  '/images/member_photo/王子铭.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E7%8E%8B%E5%AD%90%E9%93%AD-887e8929.webp',
  '/images/member_photo/王燕华.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E7%8E%8B%E7%87%95%E5%8D%8E-07222e5b.webp',
  '/images/member_photo/王虓.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E7%8E%8B%E8%99%93-b1fa6df2.webp',
  '/images/member_photo/穆化仓.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E7%A9%86%E5%8C%96%E4%BB%93-04223e86.webp',
  '/images/member_photo/苏利昊.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E8%8B%8F%E5%88%A9%E6%98%8A-cc41f15d.webp',
  '/images/member_photo/董佳辉.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E8%91%A3%E4%BD%B3%E8%BE%89-72aeb357.webp',
  '/images/member_photo/薛金鸽.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E8%96%9B%E9%87%91%E9%B8%BD-c983ae40.webp',
  '/images/member_photo/邹昌迪.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E9%82%B9%E6%98%8C%E8%BF%AA-a9615dfc.webp',
  '/images/member_photo/陈厚瑞.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E9%99%88%E5%8E%9A%E7%91%9E-20a3175c.webp',
  '/images/member_photo/韩文凯.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E9%9F%A9%E6%96%87%E5%87%AF-0d06dd60.webp',
  '/images/member_photo/骆富涵.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E9%AA%86%E5%AF%8C%E6%B6%B5-a9b3a663.webp',
  '/images/news.png': 'https://cdn.sdutvincirobot.top/site-assets/images/news-17867632.webp',
  '/images/news/2026-robocon-volleyball/arena-lineup.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/news/2026-robocon-volleyball/arena-lineup-4620302d.webp',
  '/images/news/2026-robocon-volleyball/competition.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/news/2026-robocon-volleyball/competition-1a5d978f.webp',
  '/images/news/2026-robocon-volleyball/event.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/news/2026-robocon-volleyball/event-af0c6901.webp',
  '/images/news/2026-robocon-volleyball/knockout-schedule.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/news/2026-robocon-volleyball/knockout-schedule-b08b88da.webp',
  '/images/news/2026-robocon-volleyball/national-first-prize.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/news/2026-robocon-volleyball/national-first-prize-aead21a8.webp',
  '/images/news/2026-robocon-volleyball/official-poster.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/news/2026-robocon-volleyball/official-poster-6ff894c0.webp',
  '/images/news/2026-robocon-volleyball/opening.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/news/2026-robocon-volleyball/opening-8eba4c79.webp',
  '/images/news/2026-robocon-volleyball/quarterfinal-xjtu-7-8.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/news/2026-robocon-volleyball/quarterfinal-xjtu-7-8-e6ab095c.webp',
  '/images/news/2026-robocon-volleyball/round-of-16-nanchang-8-6.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/news/2026-robocon-volleyball/round-of-16-nanchang-8-6-c42fbab9.webp',
  '/images/news/2026-robocon-volleyball/team.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/news/2026-robocon-volleyball/team-fa528c2b.webp',
  '/images/news/xhorse-0.webp': 'https://cdn.sdutvincirobot.top/site-assets/images/news/xhorse-0-185fd0dc.webp',
  '/images/news/xhorse-1.webp': 'https://cdn.sdutvincirobot.top/site-assets/images/news/xhorse-1-570537de.webp',
  '/images/news/xhorse-2.webp': 'https://cdn.sdutvincirobot.top/site-assets/images/news/xhorse-2-a4ba84a8.webp',
  '/images/news/xhorse-3.webp': 'https://cdn.sdutvincirobot.top/site-assets/images/news/xhorse-3-6bd0c148.webp',
  '/images/news/xhorse-4.webp': 'https://cdn.sdutvincirobot.top/site-assets/images/news/xhorse-4-c1604c79.webp',
  '/images/projects.jpg': 'https://cdn.sdutvincirobot.top/site-assets/images/projects-f3c31763.webp',
  '/images/backgroundvideo.mp4': 'https://cdn.sdutvincirobot.top/site-assets/videos/backgroundvideo-2f423f1d.mp4'
}

const splitUrlSuffix = (value: string) => {
  const suffixStart = value.search(/[?#]/)
  return suffixStart < 0
    ? { path: value, suffix: '' }
    : { path: value.slice(0, suffixStart), suffix: value.slice(suffixStart) }
}

export function resolveStaticMediaUrl(value: string): string
export function resolveStaticMediaUrl(value: null): null
export function resolveStaticMediaUrl(value: undefined): undefined
export function resolveStaticMediaUrl(value: string | null | undefined): string | null | undefined
export function resolveStaticMediaUrl(value: string | null | undefined) {
  if (!value) return value
  const { path, suffix } = splitUrlSuffix(value)
  let legacyPath = path
  try {
    legacyPath = decodeURI(path)
  } catch {
    // Malformed escapes cannot match a registered legacy path; preserve them.
  }
  const resolved = staticMediaUrls[legacyPath]
  return resolved ? `${resolved}${suffix}` : value
}

export const registeredStaticMediaPaths = Object.freeze(Object.keys(staticMediaUrls))
