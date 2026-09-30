export interface FooterPartner {
  name: string
  role: string
  logo: string
  href: string
  logoClass: string
}

export interface FooterPartnerGroup {
  id: string
  title: string
  items: FooterPartner[]
}

const sponsorAsset = (filename: string) =>
  `https://cdn.sdutvinci.cn/site-assets/images/sponsors/${filename}`

// 新上传文件使用版本参数，避开 CDN 边缘节点缓存的“对象不存在”响应。
const newSponsorAsset = (filename: string) => `${sponsorAsset(filename)}?v=20260930`

const school: FooterPartner = {
  name: '山东理工大学',
  role: '所属高校',
  logo: sponsorAsset('sdut-logo-blue.webp'),
  href: 'https://www.sdut.edu.cn/',
  logoClass: 'footer-partner-logo-wide footer-partner-logo-school'
}

const organizations: FooterPartner[] = [
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
    logo: `${sponsorAsset('IRI_Lab.webp')}?v=20260813-transparent`,
    href: 'https://mecenter.sdut.edu.cn/2023/0619/c11252a489230/page.htm',
    logoClass: 'footer-partner-logo-lab'
  }
]

const competition: FooterPartner = {
  name: '全国大学生机器人大赛 ROBOCON',
  role: '核心赛事',
  logo: sponsorAsset('robocon-logo.webp'),
  href: 'https://www.robocon.org.cn/',
  logoClass: 'footer-partner-logo-wide footer-partner-logo-competition'
}

// 首页与页脚共用此列表。新增合作伙伴时在这里补齐名称、身份、Logo 和页面链接。
export const sponsorPartners: FooterPartner[] = [
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
  },
  {
    name: '大疆创新 DJI',
    role: '合作伙伴',
    logo: newSponsorAsset('dji-logo.webp'),
    href: 'https://www.dji.com/cn',
    logoClass: 'footer-partner-logo-wordmark'
  },
  {
    name: '萝马车圈',
    role: '合作伙伴',
    logo: newSponsorAsset('roma-club-logo.webp'),
    href: 'https://rcbbs.top/',
    logoClass: 'footer-partner-logo-wordmark'
  },
  {
    name: '超核电子 HiPNUC',
    role: '合作伙伴',
    logo: newSponsorAsset('hipnuc-logo.webp'),
    href: 'https://www.hipnuc.com/',
    logoClass: 'footer-partner-logo-wordmark'
  },
  {
    name: '嘉立创',
    role: '合作伙伴',
    logo: newSponsorAsset('jlc-logo.webp'),
    href: 'https://www.jlc.com/',
    logoClass: 'footer-partner-logo-wide'
  },
  {
    name: '臻碳工坊',
    role: '合作伙伴',
    logo: newSponsorAsset('zhentan-workshop-logo.webp'),
    href: 'https://space.bilibili.com/371929474',
    logoClass: 'footer-partner-logo-symbol'
  },
  {
    name: '格瑞普电池 GREPOW',
    role: '合作伙伴',
    logo: newSponsorAsset('grepow-logo.webp'),
    href: 'https://www.grepow.cn/',
    logoClass: 'footer-partner-logo-grepow'
  },
  {
    name: 'MPS 芯源系统',
    role: '合作伙伴',
    logo: newSponsorAsset('mps-logo.webp'),
    href: 'https://www.monolithicpower.cn/',
    logoClass: 'footer-partner-logo-wordmark'
  },
  {
    name: '创芯工坊',
    role: '合作伙伴',
    logo: newSponsorAsset('icworkshop-logo.webp'),
    href: 'https://www.icworkshop.com/',
    logoClass: 'footer-partner-logo-symbol'
  }
]

export const homeAffiliations: FooterPartner[] = [school, ...organizations, competition]

export const footerPartnerGroups: FooterPartnerGroup[] = [
  {
    id: 'school',
    title: '指导与依托',
    items: [school]
  },
  {
    id: 'organizations',
    title: '组织与实践平台',
    items: organizations
  },
  {
    id: 'partners',
    title: '赛事与合作支持',
    items: [competition, ...sponsorPartners]
  }
]
