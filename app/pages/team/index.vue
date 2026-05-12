<script setup lang="ts">
type Member = Record<string, any>

useHead({
  title: '成员 | 山东理工大学 Vinci 机器人队'
})

const { data: rawMembers } = await useAsyncData<Member[]>('members:list', () =>
  queryCollection('members').all() as Promise<Member[]>
)

const search = ref('')
const selectedSeason = ref('25')
const selectedGroup = ref('all')

const groupDefs = [
  { key: 'all', label: '全部' },
  { key: 'teachers', label: '指导老师' },
  { key: 'leaders', label: '团队负责人' },
  { key: 'mechanical', label: '机械组' },
  { key: 'control', label: '控制组' },
  { key: 'circuit', label: '电路组' },
  { key: 'algorithm', label: '算法组' },
  { key: 'operation', label: '运营组' },
  { key: 'advisors', label: '顾问' },
  { key: 'others', label: '其他' }
]

const visibleGroupDefs = groupDefs.filter((group) => group.key !== 'all')

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

const seasonTabs = computed(() => {
  const seasons = new Set<string>()

  for (const member of allMembers.value) {
    splitSeason(member.time).forEach((season) => seasons.add(season))
    splitSeason(member.advisor).forEach((season) => seasons.add(season))
  }

  return [
    { label: '全部赛季', value: 'all' },
    ...[...seasons]
      .sort((a, b) => Number(b) - Number(a))
      .map((season) => ({ label: `${season} 赛季`, value: season }))
  ]
})

const hasSeason = (member: Member, season: string) => {
  if (season === 'all') return true
  if (normalize(member.type).includes('指导老师') || normalize(member.role).includes('指导老师')) return true

  return splitSeason(member.time).includes(season) || splitSeason(member.advisor).includes(season)
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

  if (type.includes('指导老师') || role.includes('指导老师')) return 'teachers'
  if (isAdvisorForSeason(member, season)) return 'advisors'
  if (isLeaderForSeason(member, season) || type.includes('团队负责人')) return 'leaders'
  if (type.includes('机械') || role.includes('机械')) return 'mechanical'
  if (type.includes('控制') || role.includes('控制') || role.includes('电控')) return 'control'
  if (type.includes('电路') || role.includes('电路')) return 'circuit'
  if (type.includes('算法') || role.includes('算法')) return 'algorithm'
  if (type.includes('运营') || role.includes('运营')) return 'operation'
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
  visibleGroupDefs
    .map((group) => ({
      ...group,
      members: filteredMembers.value.filter((member) => groupFor(member) === group.key)
    }))
    .filter((group) => group.members.length)
)

const stats = computed(() => [
  { value: allMembers.value.length, label: '成员档案' },
  { value: filteredMembers.value.length, label: selectedSeason.value === 'all' ? '当前筛选' : `${selectedSeason.value} 赛季展示` },
  { value: allMembers.value.filter((member) => member.type === '指导老师').length, label: '指导老师' },
  { value: allMembers.value.filter((member) => member.advisor).length, label: '顾问记录' }
])
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
