import { describe, expect, it } from 'vitest'
import { deriveMemberRole, deriveMemberType, normalizeMemberPositions } from '../server/services/member-profile'
import { defaultGroupsForGrade } from '../server/services/member-options'
import { readFile } from 'node:fs/promises'
import { resolveMarkdownMediaUrls } from '../shared/utils/static-media'
import { MEMBER_COLLEGE_OPTIONS } from '../shared/constants/member-colleges'
import { WIKI_PDF_CSS } from '../server/services/wiki-pdf'

describe('成员选项、自动归类与 Markdown 图床', () => {
  it('按年级提供指定组别', () => {
    expect(defaultGroupsForGrade(2021)).toEqual(['机械组', '电控组', '运营组'])
    expect(defaultGroupsForGrade(2024)).toEqual(['机械组', '控制组', '电路组', '视觉算法组', '运营组'])
    expect(defaultGroupsForGrade(2025)).toEqual(['机械组', '嵌入式组', '软件算法组', '运营组'])
  })

  it('从多选职责推导类型，不接受任意职责', () => {
    expect(deriveMemberType(['队长', '组长'], '机械组')).toBe('团队负责人')
    expect(deriveMemberType(['指导老师'], null)).toBe('指导老师')
    expect(deriveMemberType(['成员'], '软件算法组')).toBe('软件算法组')
    expect(deriveMemberType(['顾问'], null)).toBe('顾问')
    expect(deriveMemberRole(['组长', '副队长'], '机械组')).toBe('机械组组长，副队长')
    expect(() => normalizeMemberPositions(['随便填写'])).toThrow('MEMBER_POSITION_INVALID')
  })

  it('为 Markdown 根路径图片补齐固定 CDN，不改绝对和协议相对 URL', () => {
    expect(resolveMarkdownMediaUrls('![](/images/a b.webp "图")\n<img src="/images/c.webp">\n![](https://example.com/x.png)'))
      .toContain('<img src="https://cdn.sdutvincirobot.top/images/c.webp">')
    expect(resolveMarkdownMediaUrls('![](/images/a.webp)')).toBe('![](https://cdn.sdutvincirobot.top/images/a.webp)')
    expect(resolveMarkdownMediaUrls('![](https://example.com/x.png)')).toBe('![](https://example.com/x.png)')
    expect(resolveMarkdownMediaUrls('![](/images/logo.png)')).toContain('https://cdn.sdutvincirobot.top/site-assets/images/logo-')
  })

  it('使用学校教学单位作为学院选择题，并以浏览器样式导出 A4 PDF', () => {
    expect(MEMBER_COLLEGE_OPTIONS).toContain('机械工程学院')
    expect(MEMBER_COLLEGE_OPTIONS).toContain('计算机科学与技术学院')
    expect(WIKI_PDF_CSS).toContain('@page { size: A4;')
    expect(WIKI_PDF_CSS).toContain('nav#TOC')
  })

  it('公开申请与 CMS 创建复用成员资料表单，并区分参赛和指导届次', async () => {
    const [form, fields, cmsMembers, cmsMemberEdit] = await Promise.all([
      readFile('app/components/MemberProfileApplicationForm.vue', 'utf8'),
      readFile('app/components/MemberProfileFields.vue', 'utf8'),
      readFile('app/pages/cms/members/index.vue', 'utf8'),
      readFile('app/pages/cms/members/[id].vue', 'utf8')
    ])
    expect(fields).toContain('参加过的赛季（可多选）')
    expect(fields).toContain('顾问 / 指导届次（可选、多选）')
    expect(fields).toContain('GitHub 链接（可选）')
    expect(fields).toContain('个人主页链接（可选）')
    expect(form).toContain('MemberProfileFields')
    expect(cmsMembers).toContain('MemberProfileApplicationForm')
    expect(cmsMembers).toContain('immediate-approval')
    expect(cmsMemberEdit).toContain('MemberProfileFields')
  })
})
