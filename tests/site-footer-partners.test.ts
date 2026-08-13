import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { footerPartnerGroups } from '../app/data/footer-partners'

describe('网站 Footer 合作与支持', () => {
  it('区分组织平台、核心赛事和合作伙伴，并链接官方页面', () => {
    expect(footerPartnerGroups).toHaveLength(2)
    expect(footerPartnerGroups.flatMap(group => group.items)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '山东理工大学', role: '所属高校', href: 'https://www.sdut.edu.cn/' }),
      expect.objectContaining({ name: '机电创新学会', role: '所属社团' }),
      expect.objectContaining({ name: '智能机器人创新实践基地', role: '实践平台' }),
      expect.objectContaining({ name: '全国大学生机器人大赛 ROBOCON', href: 'https://www.robocon.org.cn/' }),
      expect.objectContaining({ name: '宇树科技', href: 'https://www.unitree.com/cn/' }),
      expect.objectContaining({ name: '库犸科技 MAMMOTION', href: 'https://mammotion.com/cn/' })
    ]))
    expect(footerPartnerGroups.flatMap(group => group.items).every(item =>
      item.logo.startsWith('https://cdn.sdutvincirobot.top/site-assets/images/sponsors/')
    )).toBe(true)
  })

  it('整项 Logo 可点击，显示中文名称和身份，并提供紧凑响应式布局', async () => {
    const [component, footerStyles, responsiveStyles] = await Promise.all([
      readFile('app/components/SiteFooter.vue', 'utf8'),
      readFile('app/assets/css/footer.css', 'utf8'),
      readFile('app/assets/css/responsive.css', 'utf8')
    ])
    expect(component).toContain('class="footer-partner-card"')
    expect(component).toContain('target="_blank"')
    expect(component).toContain('rel="noopener noreferrer"')
    expect(component).toContain('{{ item.name }}')
    expect(component).toContain('{{ item.role }}')
    expect(component).toContain('to="/contact"')
    expect(footerStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(footerStyles).not.toMatch(/\.footer-partner-grid\s*\{[^}]*border/)
    expect(footerStyles).not.toMatch(/\.footer-partner-logo\s*\{[^}]*background/)
    expect(footerStyles).not.toContain('.footer-partner-card + .footer-partner-card')
    expect(footerStyles).toContain(':root[data-theme="dark"] .footer-partner-logo .footer-partner-logo-wordmark')
    expect(footerStyles).toContain('.footer-partner-card:focus-visible')
    expect(responsiveStyles).toMatch(/@media \(max-width: 620px\)[\s\S]*\.footer-partner-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/)
  })
})
