import { pinyin } from 'pinyin-pro'
import { cmsAccountPattern } from '../../shared/types/cms-auth'

export const memberKeyFromName = (name: string) => {
  const key = pinyin(name.trim(), {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive'
  })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

  if (!cmsAccountPattern.test(key)) {
    throw new Error(`无法从姓名“${name}”生成有效成员 ID`)
  }
  return key
}

export const allocateMemberKey = (base: string, used: Set<string>) => {
  let suffix = 0
  let candidate = base
  while (used.has(candidate)) {
    suffix += 1
    candidate = `${base}${suffix}`
  }
  used.add(candidate)
  return candidate
}
