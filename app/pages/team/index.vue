<script setup lang="ts">
type Member = Record<string, any>

const { data: rawMembers } = await usePublicContentQuery<Member[]>({
  key: 'members:list',
  database: async () => (
    await $fetch<{ items: Member[] }>('/api/v2/content/members')
  ).items
})
const { data: memberOptions } = await useFetch<{
  cohorts: Array<{ id: string, season: string, groups: string[] }>
}>('/api/member-options')

useContentSeo({
  title: '成员 | 山东理工大学 Vinci 机器人队',
  description: '按赛季、职责和专业方向浏览 Vinci 机器人队成员档案。',
  path: '/team'
})

const search = ref('')
const selectedGroup = ref('all')

const fixedGroupDefs = [
  { key: 'all', label: '全部' },
  { key: 'teachers', label: '指导老师' },
  { key: 'leaders', label: '团队负责人' }
]

const trailingGroupDefs = [
  { key: 'advisors', label: '顾问' },
  { key: 'others', label: '其他' }
]

const normalize = (value: unknown) => String(value ?? '').toLowerCase()
const splitSeason = (value: unknown) =>
  String(value ?? '')
    .split(/\/|,|，/)
    .map((part) => part.trim())
    .filter(Boolean)

const memberName = (member: Member) => String(member.name || '')

const allMembers = computed(() =>
  [...(rawMembers.value ?? [])].sort((a, b) => {
    const seasonDiff = Number(b.time ?? 0) - Number(a.time ?? 0)
    if (seasonDiff) return seasonDiff
    return memberName(a).localeCompare(memberName(b), 'zh-CN')
  })
)

const availableSeasons = computed(() => {
  const seasons = new Set<string>()

  for (const member of allMembers.value) {
    splitSeason(member.time).forEach((season) => seasons.add(season))
    splitSeason(member.advisor).forEach((season) => seasons.add(season))
  }

  return [...seasons].sort((a, b) => Number(b) - Number(a))
})

const selectedSeason = ref('all')

const configuredGroups = computed(() => {
  const cohorts = memberOptions.value?.cohorts ?? []
  const relevant = selectedSeason.value === 'all'
    ? cohorts
    : cohorts.filter(cohort => cohort.season === selectedSeason.value)
  return [...new Set(relevant.flatMap(cohort => cohort.groups))]
})

const groupDefs = computed(() => [
  ...fixedGroupDefs,
  ...configuredGroups.value.map(group => ({ key: `group:${group}`, label: group })),
  ...trailingGroupDefs
])

const visibleGroupDefs = computed(() => groupDefs.value.filter(group => group.key !== 'all'))

watch(configuredGroups, () => {
  if (!groupDefs.value.some(group => group.key === selectedGroup.value)) selectedGroup.value = 'all'
})

const seasonTabs = computed(() => {
  return [
    { label: '全部赛季', value: 'all' },
    ...availableSeasons.value.map((season) => ({ label: `${season} 赛季`, value: season }))
  ]
})

const hasSeason = (member: Member, season: string) => {
  if (season === 'all') return true

  const memberSeasons = [...splitSeason(member.time), ...splitSeason(member.advisor)]
  const isTeacher = normalize(member.type).includes('指导老师') || normalize(member.role).includes('指导老师')
  if (isTeacher && !memberSeasons.length) return true

  return memberSeasons.includes(season)
}

const isAdvisorForSeason = (member: Member, season: string) => {
  const advisorSeasons = splitSeason(member.advisor)
  if (!advisorSeasons.length) return false
  if (season === 'all') return selectedGroup.value === 'advisors'

  return advisorSeasons.includes(season) && !splitSeason(member.time).includes(season)
}

const isLeaderForSeason = (member: Member, season: string) => {
  if (!normalize(member.type).includes('团队负责人')) return false
  if (season === 'all') return true

  return splitSeason(member.time).includes(season)
}

const groupFor = (member: Member, season = selectedSeason.value) => {
  const role = normalize(member.role)
  const type = normalize(member.type)
  const group = normalize(member.group)

  if (type.includes('指导老师') || role.includes('指导老师')) return 'teachers'
  if (type.includes('顾问') || member.positions?.includes('顾问')) return 'advisors'
  if (isAdvisorForSeason(member, season)) return 'advisors'
  if (isLeaderForSeason(member, season) || type.includes('团队负责人')) return 'leaders'
  const exactGroup = configuredGroups.value.find(item => normalize(item) === group)
  if (exactGroup) return `group:${exactGroup}`

  // 兼容少量旧资料中的“控制组 / 电控组”异名，同时仍以当前赛季配置的名称展示。
  if (group === '控制组' || group === '电控组') {
    const compatibleGroup = configuredGroups.value.find(item => ['控制组', '电控组'].includes(item))
    if (compatibleGroup) return `group:${compatibleGroup}`
  }
  if (member.advisor) return 'advisors'
  return 'others'
}

const matchesSearch = (member: Member) => {
  const keyword = normalize(search.value).trim()
  if (!keyword) return true

  const haystack = [
    member.name,
    member.role,
    member.type,
    member.time,
    member.advisor,
    member.grade,
    member.affiliation
  ].map(normalize).join(' ')

  return haystack.includes(keyword)
}

const filteredMembers = computed(() =>
  allMembers.value.filter((member) => {
    const group = groupFor(member)
    const groupMatched = selectedGroup.value === 'all' || selectedGroup.value === group
    return hasSeason(member, selectedSeason.value) && groupMatched && matchesSearch(member)
  })
)

const groupedMembers = computed(() =>
  visibleGroupDefs.value
    .map((group) => ({
      ...group,
      members: filteredMembers.value.filter((member) => groupFor(member) === group.key)
    }))
    .filter((group) => group.members.length)
)

const isTeacher = (member: Member) =>
  normalize(member.type).includes('指导老师') || normalize(member.role).includes('指导老师')

const stats = computed(() => {
  const season = selectedSeason.value
  const teachers = allMembers.value.filter((member) =>
    isTeacher(member) && hasSeason(member, season)
  )
  const advisors = allMembers.value.filter((member) =>
    season === 'all'
      ? splitSeason(member.advisor).length > 0
      : splitSeason(member.advisor).includes(season)
  )

  return [
    { value: allMembers.value.length, label: '成员档案' },
    { value: filteredMembers.value.length, label: season === 'all' ? '当前筛选' : `${season} 赛季展示` },
    { value: teachers.length, label: season === 'all' ? '全部赛季指导老师' : `${season} 赛季指导老师` },
    { value: advisors.length, label: season === 'all' ? '全部赛季顾问记录' : `${season} 赛季顾问` }
  ]
})
</script>

<template>
  <main>
    <section class="page-hero members-hero">
      <div>
        <p class="eyebrow">Team Roster</p>
        <h1>成员</h1>
        <p>
          这里按赛季、职责和专业方向重新组织成员信息。成员档案字段已经规整，页面逻辑改成更适合浏览和筛选的结构。
        </p>
        <NuxtLink class="member-application-link" to="/team/apply">申请成员信息</NuxtLink>
      </div>
    </section>

    <section class="stats-band members-stats" aria-label="成员概览">
      <div v-for="item in stats" :key="item.label" class="stat-item">
        <strong>{{ item.value }}</strong>
        <span>{{ item.label }}</span>
      </div>
    </section>

    <section class="member-controls" aria-label="成员筛选">
      <div class="member-search">
        <label for="member-search">搜索成员</label>
        <input id="member-search" v-model="search" type="search" placeholder="姓名、学院、方向、赛季">
      </div>

      <div class="filter-row" aria-label="赛季筛选">
        <button
          v-for="season in seasonTabs"
          :key="season.value"
          class="filter-chip"
          :class="{ active: selectedSeason === season.value }"
          type="button"
          @click="selectedSeason = season.value"
        >
          {{ season.label }}
        </button>
      </div>

      <div class="filter-row" aria-label="方向筛选">
        <button
          v-for="group in groupDefs"
          :key="group.key"
          class="filter-chip"
          :class="{ active: selectedGroup === group.key }"
          type="button"
          @click="selectedGroup = group.key"
        >
          {{ group.label }}
        </button>
      </div>
    </section>

    <section class="member-directory" aria-label="成员列表">
      <div v-if="groupedMembers.length" class="member-groups">
        <section v-for="group in groupedMembers" :key="group.key" class="member-group">
          <div class="section-heading compact">
            <p class="eyebrow">{{ group.members.length }} people</p>
            <h2>{{ group.label }}</h2>
          </div>

          <div class="member-grid">
            <MemberCard v-for="member in group.members" :key="member.name" :member="member" />
          </div>
        </section>
      </div>

      <div v-else class="empty-state">
        没有匹配的成员。
      </div>
    </section>
  </main>
</template>
