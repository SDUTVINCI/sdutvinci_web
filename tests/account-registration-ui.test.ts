import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('账号注册界面', () => {
  it('登录页提供成员搜索、只读稳定 ID、资料申请入口和审核提示', async () => {
    const [page, picker, styles] = await Promise.all([
      readFile('app/pages/cms/login.vue', 'utf8'),
      readFile('app/components/cms/AccountRegistrationMemberPicker.vue', 'utf8'),
      readFile('app/assets/css/cms.css', 'utf8')
    ])
    expect(page).toContain('申请注册')
    expect(page).toContain('CmsAccountRegistrationMemberPicker')
    expect(page).toContain('readonly')
    expect(page).toContain('to="/team/apply"')
    expect(page).toContain('cms-registration-profile-link')
    expect(page).toContain('联系 Vinci 机器人队管理员')
    expect(page).toContain('注册默认获得普通成员身份')
    expect(page).toContain("selectedRegistrationMember?.registrationStatus === 'pending' && !registrationSuccess")
    expect(picker).toContain('搜索姓名或稳定 ID')
    expect(picker).toContain('registered')
    expect(picker).toContain('pending')
    expect(styles).toContain(':root[data-theme="light"] .cms-login-input-readonly input')
    expect(styles).toContain('-webkit-text-fill-color: color-mix(in srgb, var(--ink) 82%, var(--cyan))')
    expect(styles).toContain(':root[data-theme="light"] .cms-registration-member-selected em')
  })

  it('账号管理页集中审核注册并明确创建普通成员账号', async () => {
    const page = await readFile('app/pages/cms/users.vue', 'utf8')
    expect(page).toContain('注册申请审核')
    expect(page).toContain('/api/cms/account-registration-applications')
    expect(page).toContain('通过并创建普通成员账号')
    expect(page).toContain("reviewRegistration(application, 'reject')")
  })
})
