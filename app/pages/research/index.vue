<script setup lang="ts">
import {
  roboconAchievements,
  roboconAwardEntryCount,
  roboconYearRange
} from '~/data/robocon-achievements'

useContentSeo({
  title: 'ROBOCON 赛事成果 | 山东理工大学 Vinci 机器人队',
  description: '查看山东理工大学 Vinci 机器人队历年 ROBOCON 参赛记录与获奖成果，了解机械、电控、算法与团队协作的赛场实践。',
  path: '/research'
})

const highlights = [
  { value: roboconYearRange, label: '连续沉淀的赛事记录' },
  { value: String(roboconAwardEntryCount), label: '公开展示奖项条目' },
  { value: 'Robocon', label: '核心赛事方向' }
]
</script>

<template>
  <main>
    <section class="page-hero research-hero">
      <div>
        <p class="eyebrow">多方面综合发展</p>
        <h1>我们的成果</h1>
        <p>
          Vinci 机器人队以全国大学生机器人大赛 Robocon 为主线，在长期训练和赛场反馈中积累机械、电控、算法与协作经验。
        </p>
      </div>
    </section>

    <section class="stats-band research-stats" aria-label="成果概览">
      <div v-for="item in highlights" :key="item.label" class="stat-item">
        <strong>{{ item.value }}</strong>
        <span>{{ item.label }}</span>
      </div>
    </section>

    <section class="achievement-section">
      <div class="section-heading">
        <p class="eyebrow">历史成绩</p>
        <h2>Robocon 赛场记录</h2>
      </div>

      <div class="achievement-timeline">
        <article v-for="achievement in roboconAchievements" :key="achievement.year" class="achievement-card">
          <div class="achievement-year">{{ achievement.year }}</div>
          <ul>
            <li v-for="item in achievement.items" :key="item">{{ item }}</li>
          </ul>
        </article>
      </div>
    </section>
  </main>
</template>
