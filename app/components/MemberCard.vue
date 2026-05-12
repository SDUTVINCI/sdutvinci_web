<script setup lang="ts">
type Member = Record<string, any>

const props = defineProps<{
  member: Member
  compact?: boolean
}>()

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

const displayName = computed(() => String(props.member.title || '成员'))
const memberPath = computed(() => `/team/${encodeURIComponent(displayName.value)}`)

const seasonText = computed(() => {
  const time = props.member.time ? `${props.member.time} 赛季` : ''
  const advisor = props.member.advisor ? `顾问 ${formatSeasonList(props.member.advisor)}` : ''
  return [time, advisor].filter(Boolean).join(' / ')
})

const roleText = computed(() => uniq(splitPhrases(props.member.role)).join('，'))

const linkLabels: Record<string, string> = {
  github: 'GitHub',
  homepage: '主页',
  'home-page': '主页',
  blog: '博客',
  bilibili: 'Bilibili',
  'google-scholar': 'Google Scholar'
}

const externalLinks = computed(() =>
  Object.entries(props.member.links ?? {})
    .filter(([, value]) => value)
    .map(([key, value]) => ({
      label: linkLabels[key] ?? key,
      href: String(value)
    }))
)

const infoRows = computed(() => [
  { label: '职务', value: roleText.value },
  { label: '学院', value: props.member.affiliation },
  { label: '赛季', value: seasonText.value },
  { label: '年级', value: props.member.grade ? `${props.member.grade} 级` : '' }
].filter((item) => item.value))
</script>

<template>
  <article class="member-card" :class="{ compact }">
    <NuxtLink class="member-card-main" :to="memberPath">
      <div class="member-photo">
        <img :src="member.image || '/images/logo.png'" :alt="`${displayName} 头像`" loading="lazy">
      </div>

      <div class="member-card-body">
        <div class="member-card-head">
          <h3>{{ displayName }}</h3>
        </div>

        <div class="member-info-list">
          <div v-for="row in infoRows" :key="row.label" class="member-info-row">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </div>
    </NuxtLink>

    <div v-if="externalLinks.length && !compact" class="member-card-links">
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
  </article>
</template>
