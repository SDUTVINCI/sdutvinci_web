<script setup lang="ts">
type Member = Record<string, any>

const route = useRoute()
const slug = decodeURIComponent(String(route.params.slug ?? ''))

const { data: member } = await useAsyncData<Member | null>(`members:${slug}`, async () => {
  return queryCollection('members').where('name', '=', slug).first() as Promise<Member | null>
})

if (!member.value) {
  throw createError({
    statusCode: 404,
    statusMessage: '成员不存在'
  })
}

const { data: rawMembers } = await useAsyncData<Member[]>('members:related', () =>
  queryCollection('members').all() as Promise<Member[]>
)

useHead(() => ({
  title: `${member.value?.name || '成员'} | Vinci 机器人队`
}))

const cleanText = (value: unknown) =>
  String(value ?? '')
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<[^>]+>/g, '')
    .trim()

const splitPhrases = (value: unknown) =>
  cleanText(value)
    .split(/·|\/|,|，|;|；/)
    .map((item) => item.replace(/^\s*\d{2,4}\s*赛季\s*/, '').trim())
    .filter(Boolean)

const uniq = (items: string[]) => [...new Set(items)]

const splitSeason = (value: unknown) =>
  String(value ?? '')
    .split(/\/|,|，/)
    .map((part) => part.trim())
    .filter(Boolean)

const formatSeasonList = (value: unknown) => splitSeason(value).join('、')

const displayName = computed(() => String(member.value?.name || '成员'))
const roleText = computed(() => uniq(splitPhrases(member.value?.role)).join('，'))

const linkLabels: Record<string, string> = {
  github: 'GitHub',
  homepage: '主页',
  'home-page': '主页',
  blog: '博客',
  bilibili: 'Bilibili',
  'google-scholar': 'Google Scholar'
}

const externalLinks = computed(() =>
  Object.entries(member.value?.links ?? {})
    .filter(([, value]) => value)
    .map(([key, value]) => ({
      label: linkLabels[key] ?? key,
      href: String(value)
    }))
)

const groupLabel = (value: Member | null | undefined) => {
  const role = String(value?.role ?? '')
  const type = String(value?.type ?? '')
  if (type.includes('指导老师') || role.includes('指导老师')) return '指导老师'
  if (type.includes('团队负责人')) return '团队负责人'
  if (type.includes('机械') || role.includes('机械')) return '机械组'
  if (type.includes('控制') || role.includes('控制') || role.includes('电控')) return '控制组'
  if (type.includes('电路') || role.includes('电路')) return '电路组'
  if (type.includes('算法') || role.includes('算法')) return '算法组'
  if (type.includes('运营') || role.includes('运营')) return '运营组'
  if (value?.advisor) return '顾问'
  return '成员'
}

const relatedMembers = computed(() => {
  const current = member.value
  if (!current) return []

  const currentSeasons = new Set([...splitSeason(current.time), ...splitSeason(current.advisor)])
  const currentGroup = groupLabel(current)

  return [...(rawMembers.value ?? [])]
    .filter((item) => item.name !== current.name)
    .map((item) => {
      const seasons = [...splitSeason(item.time), ...splitSeason(item.advisor)]
      const seasonScore = seasons.some((season) => currentSeasons.has(season)) ? 2 : 0
      const groupScore = groupLabel(item) === currentGroup ? 1 : 0
      return { item, score: seasonScore + groupScore }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.name).localeCompare(String(b.item.name), 'zh-CN'))
    .slice(0, 3)
    .map(({ item }) => item)
})
</script>

<template>
  <main v-if="member">
    <section class="member-profile-hero">
      <div class="member-profile-photo">
        <img :src="member.image || '/images/logo.png'" :alt="`${displayName} 头像`">
      </div>

      <div class="member-profile-copy">
        <p class="eyebrow">{{ groupLabel(member) }}</p>
        <h1>{{ displayName }}</h1>
        <p v-if="roleText" class="profile-role">{{ roleText }}</p>

        <div class="profile-tags">
          <span v-if="member.time">{{ member.time }} 赛季</span>
          <span v-if="member.advisor">顾问 {{ formatSeasonList(member.advisor) }}</span>
          <span v-if="member.grade">{{ member.grade }} 级</span>
          <span v-if="member.affiliation">{{ member.affiliation }}</span>
        </div>

        <div v-if="externalLinks.length" class="profile-links">
          <a
            v-for="link in externalLinks"
            :key="link.href"
            :href="link.href"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ link.label }}
          </a>
        </div>
      </div>
    </section>

    <section class="member-profile-content">
      <article class="member-prose">
        <ContentRenderer :value="member" />
      </article>

      <aside v-if="relatedMembers.length" class="related-members">
        <div class="section-heading compact">
          <p class="eyebrow">Related</p>
          <h2>相关成员</h2>
        </div>
        <div class="related-member-list">
          <MemberCard
            v-for="item in relatedMembers"
            :key="item.name"
            :member="item"
            compact
          />
        </div>
      </aside>
    </section>
  </main>
</template>
