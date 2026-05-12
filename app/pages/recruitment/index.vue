<script setup lang="ts">
useHead({
  title: '纳新 | 山东理工大学 Vinci 机器人队'
})

const quickLinks = [
  {
    label: '填写报名表',
    text: '提交基础信息后，我们会根据招新安排联系你参加面试或技术交流。',
    href: 'https://docs.qq.com/form/page/DTk9Ha0hsTHpwa0FL',
    external: true
  },
  {
    label: '查看团队介绍',
    text: '通过飞书文档了解训练方向、队伍结构和 Robocon 赛事内容。',
    href: 'https://sdutvincirobot.feishu.cn/wiki/HjNWwwrSCirI2gkXI7XcNMIXnUh?from=from_copylink',
    external: true
  },
  {
    label: '加入咨询群',
    text: 'QQ群 1033839949，适合先咨询方向、时间投入和报名安排。',
    href: 'https://qm.qq.com/q/Obiyw4DIkO',
    external: true
  }
]

const tracks = [
  {
    title: '机械结构',
    text: '从方案设计、建模、加工到装配调试，把想法变成能上场的机器人机构。'
  },
  {
    title: '电控与嵌入式',
    text: '围绕驱动、传感器、通信和控制逻辑，完成机器人稳定运行的底层能力。'
  },
  {
    title: '视觉与算法',
    text: '结合目标识别、定位、路径规划和策略设计，让机器人在规则内更聪明地行动。'
  },
  {
    title: '运营与工程协作',
    text: '参与资料沉淀、赛事沟通、宣传组织和项目管理，支撑团队长期运转。'
  }
]

const expectations = [
  '对机器人、机械、电子、编程、算法或赛事运营有持续兴趣',
  '愿意投入训练时间，能在反复调试中保持耐心',
  '重视团队协作，也愿意为自己的任务负责到底'
]

const process = [
  {
    step: '01',
    title: '报名登记',
    text: '填写报名表，留下基本信息、感兴趣方向和联系方式。'
  },
  {
    step: '02',
    title: '交流面试',
    text: '通过面试或技术交流确认方向匹配度，也帮助你了解真实训练节奏。'
  },
  {
    step: '03',
    title: '预备训练',
    text: '进入预备队员阶段，参与基础培训、小任务和组内协作。'
  },
  {
    step: '04',
    title: '进入项目',
    text: '跟随赛季任务逐步承担机器人设计、调试、运营或赛事支持工作。'
  }
]
</script>

<template>
  <main>
    <section class="page-hero recruitment-hero">
      <div>
        <p class="eyebrow">Join Vinci</p>
        <h1>加入我们</h1>
        <p>
          Vinci 机器人队欢迎所有热爱机器人和工程实践的同学。这里有真实赛场、长期训练和一群愿意把复杂问题拆开做透的人。
        </p>
      </div>
    </section>

    <section class="recruitment-intro">
      <div class="join-copy">
        <p class="eyebrow">Robocon Team</p>
        <h2>把课堂知识推进到真实机器人上</h2>
        <p>
          你可以从零开始学习机械设计、电控调试、嵌入式开发、视觉算法或团队运营，也可以带着已有经验加入项目。我们更看重持续投入、协作意识和解决问题的韧性。
        </p>
        <div class="join-actions">
          <a
            class="action-button primary"
            href="https://docs.qq.com/form/page/DTk9Ha0hsTHpwa0FL"
            target="_blank"
            rel="noopener noreferrer"
          >
            立即报名
          </a>
          <a
            class="action-button"
            href="https://qm.qq.com/q/Obiyw4DIkO"
            target="_blank"
            rel="noopener noreferrer"
          >
            加入咨询群
          </a>
        </div>
      </div>

      <div class="join-photo">
        <img src="/images/joinus.jpg" alt="Vinci 机器人队纳新展示">
      </div>
    </section>

    <section class="quick-link-grid" aria-label="纳新入口">
      <a
        v-for="link in quickLinks"
        :key="link.label"
        class="quick-link-card"
        :href="link.href"
        :target="link.external ? '_blank' : undefined"
        :rel="link.external ? 'noopener noreferrer' : undefined"
      >
        <strong>{{ link.label }}</strong>
        <span>{{ link.text }}</span>
      </a>
    </section>

    <section class="recruitment-section">
      <div class="section-heading">
        <p class="eyebrow">方向选择</p>
        <h2>你可以从这些方向开始</h2>
      </div>

      <div class="track-grid">
        <article v-for="track in tracks" :key="track.title" class="track-card">
          <h3>{{ track.title }}</h3>
          <p>{{ track.text }}</p>
        </article>
      </div>
    </section>

    <section class="recruitment-split">
      <div class="expectation-panel">
        <p class="eyebrow">我们希望你</p>
        <h2>保持好奇，也愿意落到细节</h2>
        <ul>
          <li v-for="item in expectations" :key="item">{{ item }}</li>
        </ul>
      </div>

      <div class="process-list">
        <article v-for="item in process" :key="item.step" class="process-item">
          <span>{{ item.step }}</span>
          <div>
            <h3>{{ item.title }}</h3>
            <p>{{ item.text }}</p>
          </div>
        </article>
      </div>
    </section>

    <section class="embedded-doc-section">
      <div class="section-heading">
        <p class="eyebrow">团队介绍</p>
        <h2>飞书文档</h2>
      </div>

      <iframe
        class="embedded-doc"
        src="https://sdutvincirobot.feishu.cn/wiki/HjNWwwrSCirI2gkXI7XcNMIXnUh?from=from_copylink"
        loading="lazy"
        title="Vinci 机器人队团队介绍"
      />
    </section>
  </main>
</template>
