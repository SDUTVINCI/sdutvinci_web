export interface FooterPartner {
  name: string
  role: string
  logo: string
  href: string
  logoClass: string
}

export interface FooterPartnerGroup {
  id: string
  eyebrow: string
  title: string
  items: FooterPartner[]
}

const sponsorAsset = (filename: string) =>
  `https://cdn.sdutvincirobot.top/site-assets/images/sponsors/${filename}`

export const footerPartnerGroups: FooterPartnerGroup[] = [
  {
    id: 'organizations',
    eyebrow: 'ORGANIZATIONS & PLATFORM',
    title: '组织与平台',
    items: [
      {
        name: '山东理工大学',
        role: '所属高校',
        logo: sponsorAsset('sdut-logo-blue.webp'),
        href: 'https://www.sdut.edu.cn/',
        logoClass: 'footer-partner-logo-wide'
      },
      {
        name: '机电创新学会',
        role: '所属社团',
        logo: sponsorAsset('EMIS.webp'),
        href: 'https://mecenter.sdut.edu.cn/2023/0620/c11250a489303/page.htm',
        logoClass: 'footer-partner-logo-symbol'
      },
      {
        name: '智能机器人创新实践基地',
        role: '实践平台',
        logo: sponsorAsset('IRI_Lab.webp'),
        href: 'https://mecenter.sdut.edu.cn/2023/0619/c11252a489230/page.htm',
        logoClass: 'footer-partner-logo-lab'
      }
    ]
  },
  {
    id: 'partners',
    eyebrow: 'COMPETITION & PARTNERS',
    title: '赛事与合作支持',
    items: [
      {
        name: '全国大学生机器人大赛 ROBOCON',
        role: '核心赛事',
        logo: sponsorAsset('robocon-logo.webp'),
        href: 'https://www.robocon.org.cn/',
        logoClass: 'footer-partner-logo-wide'
      },
      {
        name: '宇树科技',
        role: '合作伙伴',
        logo: sponsorAsset('unitree-logo.webp'),
        href: 'https://www.unitree.com/cn/',
        logoClass: 'footer-partner-logo-wordmark'
      },
      {
        name: '库犸科技 MAMMOTION',
        role: '合作伙伴',
        logo: sponsorAsset('kuma-technology-logo.webp'),
        href: 'https://mammotion.com/cn/',
        logoClass: 'footer-partner-logo-wordmark'
      }
    ]
  }
]
