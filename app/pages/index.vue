<script setup lang="ts">
import { homePromoAutoplayMs, homePromoSlides } from '~/data/home-promos'
import { roboconRecordedYearCount } from '~/data/robocon-achievements'

type Member = Record<string, any>

useHead({
  title: '山东理工大学 Vinci 机器人队'
})

const { data: rawMembers } = await useAsyncData<Member[]>('members:home-total', () =>
  queryCollection('members').all() as Promise<Member[]>
)

const totalMemberCount = computed(() => rawMembers.value?.length ?? 0)

const heroLinks = [
  { label: 'Bilibili', href: 'https://space.bilibili.com/471524675', external: true },
  { label: 'GitHub', href: 'https://github.com/SDUTVINCI', external: true },
  { label: '微信公众号', href: 'https://mp.weixin.qq.com/s/AAPWX2zOhJjA-s2MA-g2Ew', external: true },
  { label: '加入我们', href: '/recruitment', external: false }
]

const featureSections = [
  {
    kicker: '纳新专区',
    title: '加入一支真正把机器人做上赛场的队伍',
    text: [
      '如果你热爱机器人、编程、机械设计，或者只是想和一群志同道合的伙伴做点有趣的事，Vinci 机器人队欢迎你。',
      '在这里，你能接触前沿机器人技术，参与赛事与项目，并在真实协作里快速成长。'
    ],
    image: '/images/joinus.jpg',
    imageAlt: 'Vinci 机器人队纳新展示',
    href: '/recruitment',
    cta: '了解纳新'
  },
  {
    kicker: '高光时刻',
    title: '从省赛到国赛，持续打磨稳定的赛场表现',
    text: [
      '2016 至 2026 年，团队围绕 Robocon 主赛、技能赛、马术赛、排球赛持续参赛。',
      '近年多次获得国赛二等奖、三等奖，并在 2026 年获得 Robocon 排球赛国赛一等奖。'
    ],
    image: '/images/cheer.png',
    imageAlt: 'Vinci 机器人队赛场合影',
    href: '/research',
    cta: '查看成果'
  },
  {
    kicker: 'Wiki 知识库',
    title: '把踩过的坑、调好的环境和项目经验沉淀下来',
    text: [
      'Wiki 用来记录队伍训练、环境搭建、工具链配置和项目复盘，让新成员能沿着前人的路径更快上手。',
      '它不是单纯的展示页，而是日常真正会用到的工程手册：遇到问题先查，解决之后继续补充。'
    ],
    image: '/images/cooporate.jpg',
    imageAlt: 'Vinci 机器人队知识库资料展示',
    href: '/wiki',
    cta: '进入Wiki知识库'
  },
  {
    kicker: '项目展示',
    title: '机械、电控、算法、运营共同推进项目落地',
    text: [
      '作为多学科交叉的机器人团队，我们与企业、学校等多方面展开合作。',
      '队内项目训练从结构设计、嵌入式控制、视觉算法到工程管理完整展开。'
    ],
    image: '/images/projects.jpg',
    imageAlt: '机器人项目协作场景',
    href: '/projects',
    cta: '查看项目'
  },
  {
    kicker: '团队成员',
    title: '把不同专业的人放到同一张工作台前',
    text: [
      '这里聚集了机械、电路、嵌软、算法、运营多方向成员。',
      '队伍以赛季为节奏沉淀经验，也为新成员保留充分的上手机会。'
    ],
    image: '/images/background_footer.png',
    imageAlt: 'Vinci 机器人队团队展示',
    href: '/team',
    cta: '查看成员'
  },
  {
    kicker: '最新动态',
    title: '训练、比赛与校园活动中的 Vinci 风采',
    text: [
      '团队活跃于赛事、交流、招新与社会活动。',
      '新闻栏目将继续记录队伍建设、比赛进展和成员成长。'
    ],
    image: '/images/news.png',
    imageAlt: 'Vinci 机器人队新闻动态',
    href: '/news',
    cta: '查看新闻'
  }
]

const stats = computed(() => [
  { value: `${roboconRecordedYearCount} 年`, label: 'Robocon 参赛积累' },
  { value: '5 类', label: '机械、电控、算法等方向' },
  { value: String(totalMemberCount.value), label: '历史累计成员' },
  { value: '2026', label: 'Robocon 排球赛国赛一等奖' }
])
</script>

<template>
  <main>
    <section class="home-hero">
      <video
        class="hero-video"
        src="/images/backgroundvideo.mp4"
        poster="/images/background.jpg"
        autoplay
        muted
        loop
        playsinline
      />
      <div class="hero-shade" />

      <div class="hero-content">
        <p class="eyebrow">山东理工大学 Robocon 团队</p>
        <h1>Vinci 机器人队</h1>
        <p class="hero-summary">
          山东理工大学 Vinci 机器人队、机电创新学会，是以全国大学生机器人大赛 Robocon 为核心的创新团队，面向真实赛场培养队员的综合工程能力。
        </p>

        <div class="hero-actions" aria-label="常用链接">
          <a
            v-for="link in heroLinks"
            :key="link.label"
            class="button"
            :class="{ primary: link.label === '加入我们' }"
            :href="link.href"
            :target="link.external ? '_blank' : undefined"
            :rel="link.external ? 'noopener noreferrer' : undefined"
          >
            {{ link.label }}
          </a>
        </div>
      </div>
    </section>

    <section class="stats-band" aria-label="团队概览">
      <div v-for="stat in stats" :key="stat.label" class="stat-item">
        <strong>{{ stat.value }}</strong>
        <span>{{ stat.label }}</span>
      </div>
    </section>

    <HomePromoCarousel :slides="homePromoSlides" :autoplay-ms="homePromoAutoplayMs" />

    <section class="feature-stack" aria-label="首页内容">
      <article
        v-for="(section, index) in featureSections"
        :key="section.title"
        class="feature-row"
        :class="{ reversed: index % 2 === 1 }"
      >
        <div class="feature-media">
          <img :src="section.image" :alt="section.imageAlt">
        </div>

        <div class="feature-copy">
          <p class="eyebrow">{{ section.kicker }}</p>
          <h2>{{ section.title }}</h2>
          <p v-for="paragraph in section.text" :key="paragraph">
            {{ paragraph }}
          </p>
          <a class="text-link" :href="section.href">{{ section.cta }}</a>
        </div>
      </article>
    </section>
  </main>
</template>
