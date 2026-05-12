<script setup lang="ts">
useHead({
  title: '成果 | 山东理工大学 Vinci 机器人队'
})

const achievements = [
  {
    year: '2025',
    items: [
      '全国大学生机器人大赛 Robocon 正赛国赛三等奖',
      '全国大学生机器人大赛 Robocon 技能赛国赛二等奖',
      '全国大学生机器人大赛 Robocon 马术赛国赛二等奖',
      '全国大学生机器人大赛 Robocon 排球赛国赛二等奖'
    ]
  },
  {
    year: '2024',
    items: [
      '全国大学生机器人大赛 Robocon 正赛国赛三等奖',
      '全国大学生机器人大赛 Robocon 技能赛国赛二等奖',
      '全国大学生机器人大赛 Robocon 马术赛国赛三等奖'
    ]
  },
  {
    year: '2023',
    items: [
      '全国大学生机器人大赛 Robocon 正赛国赛三等奖',
      '全国大学生机器人大赛 Robocon 马术赛国赛三等奖'
    ]
  },
  {
    year: '2022',
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛二等奖'
    ]
  },
  {
    year: '2021',
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛二等奖'
    ]
  },
  {
    year: '2020',
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛二等奖'
    ]
  },
  {
    year: '2019',
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛二等奖'
    ]
  },
  {
    year: '2018',
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛一等奖',
      '荣获“感动校园”荣誉称号'
    ]
  },
  {
    year: '2017',
    items: [
      '全国大学生机器人大赛 Robocon 国赛三等奖',
      '全国大学生机器人大赛 RoboMaster 国赛三等奖'
    ]
  },
  {
    year: '2016',
    items: [
      '全国大学生机器人大赛 Robocon 省赛一等奖',
      '全国大学生机器人大赛 Robocon 国赛二等奖'
    ]
  }
]

const highlights = [
  { value: '2016-2025', label: '连续沉淀的赛事记录' },
  { value: '20+', label: '公开展示奖项条目' },
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
        <article v-for="achievement in achievements" :key="achievement.year" class="achievement-card">
          <div class="achievement-year">{{ achievement.year }}</div>
          <ul>
            <li v-for="item in achievement.items" :key="item">{{ item }}</li>
          </ul>
        </article>
      </div>
    </section>
  </main>
</template>
