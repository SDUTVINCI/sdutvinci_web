<script setup lang="ts">
import { dashboardBrand as site, dashboardSeason } from '~/data/dashboard'
import { competitions, type CompetitionConfig } from '~/data/competitions'
import { roboconPartner } from '~/data/footer-partners'
import { prepareCompetitions, competitionTimeLeft } from '~/utils/competitions'
import { dashboardCodeProfile, dashboardCohortRanking } from '../../../utils/dashboard-members.mjs'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'
import { dashboardGridLayout, dashboardTaskPages, dashboardTaskState, dashboardTaskGroups, selectDashboardTasks, dashboardScoreboard, type DashboardData, type DashboardTask, type DashboardStatusIssue } from '~/utils/dashboard'
import { DASHBOARD_PREFERENCES_KEY, dashboardPreferences, readDashboardPreferences } from '../../../utils/dashboard-experience.mjs'

definePageMeta({ layout: 'dashboard', middleware: 'site-auth' })
useHead({ title: `任务看板 | ${site.shortName}`, meta: [{ name: 'robots', content: 'noindex, nofollow' }], bodyAttrs: { class: 'dashboard-tech' } })
const route = useRoute()
const router = useRouter()
const { session, loaded: sessionLoaded } = useCmsSession()
const screen = ref(false)
const showSyncDetails = ref(false)
const fixedGridHeight = ref<number | null>(null)
const fullscreen = ref(false)
const displayMessage = ref('')
const selectedTaskId = ref<string | null>(null)
const showCompletion = ref(false)
const showStatusIssues = ref(false)
const failedStatusIssues = shallowRef<DashboardStatusIssue[]>([])
const viewportFitsScreen = ref(false)
const desktopPagination = ref(false)
const fixedScreen = computed(() => screen.value && viewportFitsScreen.value)
const paginated = computed(() => desktopPagination.value || fixedScreen.value)
const data = shallowRef<DashboardData | null>(null)
const phase = ref('loading')
const message = ref('')
const loading = ref(false)
const selectedStatus = ref('pending')
const selectedGroup = ref('all')
const selectedWeek = ref('all')
const selectedRanking = ref('all')
const rankingOptions = [
  { value: 'all', label: '总榜' },
  { value: 'senior', label: '老登榜' },
  { value: 'junior', label: '小登榜' }
]
const search = ref('')
const currentTime = ref(0)
const pageIndex = ref(0)
const autoRotate = ref(true)
const taskList = ref<HTMLElement | null>(null)
const dashboardPage = ref<HTMLElement | null>(null)
const layout = ref({ columns: 1, rows: 2, size: 2 })

type BoardMember = { name: string; memberKey: string; image: string; path: string; links?: Record<string, string | null> }
const { data: memberData, status: memberStatus } = await useFetch<{ items: BoardMember[] }>('/api/v2/content/members', { server: false, lazy: true })
const memberProfile = (name: string) => {
  const matches = (memberData.value?.items || []).filter(member => member.name === name)
  const member = matches.length === 1 ? matches[0] : undefined
  return { href: member ? `/team/${encodeURIComponent(member.memberKey)}` : '', image: member ? resolveStaticMediaUrl(member.image) : '' }
}
const codeProfile = (person: { name: string; href?: string; login?: string; memberName?: string }) => dashboardCodeProfile(person, memberData.value?.items || [], site.logo)
let layoutObserver: ResizeObserver | undefined
let layoutFrame = 0
let request: AbortController | undefined
let pollTimer: ReturnType<typeof setTimeout> | undefined
let clockTimer: ReturnType<typeof setInterval> | undefined
let lastRotation = 0
let preferencesLoaded = false
let ownsFullscreen = false
let disposed = false
let generation = 0

const eventReferenceLabel = (event: CompetitionConfig) => {
  if (event.dateStatus === 'historical') return `${event.referenceYear}同期参考`
  return { pending: '日期待定', target: '备赛目标', tentative: '暂定', confirmed: '已确认' }[event.dateStatus]
}
const competitionSchedule = prepareCompetitions(competitions).filter(event => event.enabled)
const eventCountdowns = computed(() => competitionSchedule.map(event => ({ ...event, ...competitionTimeLeft(event.target, currentTime.value) })))
const formatEventTime = (value: number) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
}).format(value)

const tasks = computed(() => data.value?.tasks || [])
const missingStatusCount = computed(() => tasks.value.filter(task => task.statusMissing).length)
const groups = computed(() => [...new Set<string>(tasks.value.flatMap(dashboardTaskGroups))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const weeks = computed(() => [...new Set(tasks.value.flatMap(task => task.week ? [task.week] : []))].sort((a, b) => a - b))
const scopedTasks = computed<DashboardTask[]>(() => selectDashboardTasks(tasks.value, { status: 'all', group: selectedGroup.value, week: selectedWeek.value, search: search.value, now: currentTime.value }))
const counts = computed(() => ({
  pending: scopedTasks.value.filter(task => task.status !== 'done').length,
  overdue: scopedTasks.value.filter(task => dashboardTaskState(task, currentTime.value) === 'overdue').length,
  done: scopedTasks.value.filter(task => task.status === 'done').length
}))
const statuses = computed(() => [
  { value: 'pending', label: '未完成', count: counts.value.pending },
  ...(['todo', 'progress', 'review'] as const).map(value => ({ value, label: { todo: '未开始', progress: '进行中', review: '待验收' }[value], count: scopedTasks.value.filter(task => task.status === value).length })),
  { value: 'overdue', label: '已逾期', count: counts.value.overdue },
  { value: 'done', label: '已完成', count: counts.value.done }
])
const visibleTasks = computed<DashboardTask[]>(() => selectDashboardTasks(tasks.value, {
  status: selectedStatus.value, group: selectedGroup.value, week: selectedWeek.value, search: search.value, now: currentTime.value
}))
const pageSize = computed(() => layout.value.size)
const taskPages = computed(() => dashboardTaskPages(visibleTasks.value.length, layout.value.columns, layout.value.rows))
const pages = computed(() => paginated.value ? Math.max(1, taskPages.value.length) : 1)
const pageTasks = computed(() => paginated.value ? visibleTasks.value.slice(taskPages.value[pageIndex.value]?.start || 0, taskPages.value[pageIndex.value]?.end || layout.value.size) : visibleTasks.value)
const rankedTasks = computed<DashboardTask[]>(() => selectDashboardTasks(tasks.value, { status: 'all', group: selectedGroup.value, week: selectedWeek.value }))
const scoreboard = computed(() => dashboardScoreboard(rankedTasks.value))
const cohortRanking = computed(() => dashboardCohortRanking(scoreboard.value.rows, tasks.value, selectedRanking.value))
const rankingLabel = computed(() => rankingOptions.find(option => option.value === selectedRanking.value)?.label || '总榜')
const activeTask = computed(() => tasks.value.find(task => task.id === selectedTaskId.value))
const statusIssues = computed(() => failedStatusIssues.value.length ? failedStatusIssues.value : data.value?.statusIssues || [])
const overlayOpen = computed(() => Boolean(activeTask.value || showCompletion.value || showStatusIssues.value))
const completionScope = computed(() => `${selectedGroup.value === 'all' ? '全部组别' : selectedGroup.value} · ${selectedWeek.value === 'all' ? '全部周次' : selectedWeek.value === 'missing' ? '未填周次' : `第${selectedWeek.value}周`}${search.value.trim() ? ' · 当前关键词筛选' : ''}`)
const development = computed(() => data.value?.development)
const developmentEvents = computed(() => development.value?.events || [])
const updateInterrupted = computed(() => Boolean(data.value && (data.value.stale || message.value || currentTime.value - data.value.updatedAt > 90_000)))
const formatTime = (value?: number | null) => value ? new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
}).format(value) : '未设置'
const clock = computed(() => currentTime.value ? new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}).format(currentTime.value) : '')

watch([selectedStatus, selectedGroup, selectedWeek, search, paginated, pageSize], () => { pageIndex.value = 0; lastRotation = currentTime.value })
watch(pages, value => { pageIndex.value = Math.min(pageIndex.value, value - 1) })
watch(activeTask, task => { if (!task) selectedTaskId.value = null })
watch(statusIssues, issues => { if (!issues.length) showStatusIssues.value = false })
watch(data, value => { if (!value) { selectedTaskId.value = null; showCompletion.value = false } })
watch([selectedGroup, selectedStatus, selectedWeek, screen, autoRotate], () => {
  if (!import.meta.client || !preferencesLoaded) return
  try {
    localStorage.setItem(DASHBOARD_PREFERENCES_KEY, JSON.stringify(dashboardPreferences({
      version: 1, group: selectedGroup.value, status: selectedStatus.value, week: selectedWeek.value, screen: screen.value, autoRotate: autoRotate.value
    })))
  } catch { displayMessage.value = '浏览器未允许保存显示偏好，设置仅本次有效。' }
}, { flush: 'post' })
// 静态页首次水合会暂时恢复预渲染地址；路由就绪后同步最终的查询参数。
watch(() => route.query.screen, () => {
  if (!import.meta.client) return
  const explicit = new URLSearchParams(window.location.search).get('screen')
  if (explicit !== null) screen.value = explicit === '1'
  document.body.classList.toggle('dashboard-screen', screen.value)
}, { flush: 'post' })

function scheduleRefresh() {
  clearTimeout(pollTimer)
  if (disposed || ['login', 'closed'].includes(phase.value)) return
  pollTimer = setTimeout(() => { if (!document.hidden) void refresh(); else scheduleRefresh() }, 30_000)
}

async function refresh() {
  if (loading.value || disposed) return
  const ticket = ++generation
  loading.value = true
  const controller = new AbortController()
  request = controller
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const result = await fetch('/api/dashboard', { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' })
    const body = result.headers.get('Content-Type')?.includes('application/json') ? await result.json() : null
    if (ticket !== generation || disposed) return
    failedStatusIssues.value = []
    if (result.status === 401) {
      await redirectToLogin()
      return
    }
    if (result.status === 404 || body?.code === 'NOT_CONFIGURED') {
      data.value = null
      phase.value = 'closed'
      message.value = '看板尚未开放，请联系团队负责人。'
      return
    }
    if (!result.ok || !Array.isArray(body?.tasks)) {
      if (body?.reason === 'INVALID_TASK_STATUS') {
        failedStatusIssues.value = body.statusIssues || []
        throw new Error('INVALID_TASK_STATUS')
      }
      throw new Error('DATA_UNAVAILABLE')
    }
    const entering = !data.value
    data.value = body
    if (selectedGroup.value !== 'all' && !groups.value.includes(selectedGroup.value)) selectedGroup.value = 'all'
    phase.value = 'ready'
    message.value = ''
    if (entering) {
      await nextTick()
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    }
  } catch (error) {
    if (!disposed && ticket === generation) {
      phase.value = data.value ? 'ready' : 'error'
      message.value = data.value ? '更新暂时中断，正在显示上次结果。'
        : error instanceof Error && error.message === 'INVALID_TASK_STATUS'
          ? '飞书任务的完成状态无法识别，请检查“完成状态/完成情况”字段。'
          : '暂时无法获取任务，请稍后重试。'
    }
  } finally {
    clearTimeout(timeout)
    if (ticket === generation) {
      loading.value = false
      scheduleRefresh()
    }
  }
}

async function redirectToLogin() {
  if (phase.value === 'login' || disposed) return
  phase.value = 'login'
  generation++
  request?.abort()
  loading.value = false
  data.value = null
  selectedTaskId.value = null
  showCompletion.value = false
  showStatusIssues.value = false
  failedStatusIssues.value = []
  message.value = ''
  clearTimeout(pollTimer)
  session.value = null
  sessionLoaded.value = true
  await navigateTo({ path: '/cms/login', query: { redirect: route.fullPath } }, { replace: true })
}

watch(session, value => { if (!value) void redirectToLogin() }, { flush: 'sync' })

function setScreen(value: boolean) {
  screen.value = value
  document.body.classList.toggle('dashboard-screen', screen.value)
  lastRotation = currentTime.value
  if (new URLSearchParams(window.location.search).has('screen')) void router.replace({ query: { ...route.query, screen: value ? '1' : '0' } })
}
const toggleScreen = () => setScreen(!screen.value)
function openTask(id: string) { showCompletion.value = false; selectedTaskId.value = id }
function openCard(event: MouseEvent, id: string) {
  if (!(event.target instanceof Element) || event.target.closest('a, button, input, select')) return
  openTask(id)
}
async function toggleFullscreen() {
  displayMessage.value = ''
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else {
      setScreen(true)
      if (!document.documentElement.requestFullscreen || !document.fullscreenEnabled) throw new Error('UNAVAILABLE')
      await document.documentElement.requestFullscreen()
      ownsFullscreen = true
    }
  } catch { displayMessage.value = '浏览器未能切换全屏，可继续使用大屏模式。' }
}
const syncFullscreen = () => {
  fullscreen.value = Boolean(document.fullscreenElement)
  if (!fullscreen.value) ownsFullscreen = false
  void nextTick(resizeScreen)
}
function escapeFullscreen(event: KeyboardEvent) {
  if (event.key === 'Escape' && !overlayOpen.value && ownsFullscreen && document.fullscreenElement) {
    event.preventDefault()
    void document.exitFullscreen().catch(() => { displayMessage.value = '暂时无法退出全屏，请使用浏览器的退出全屏操作。' })
  }
}
function resetDisplay() {
  search.value = ''
  selectedGroup.value = 'all'
  selectedRanking.value = 'all'
  selectedStatus.value = 'pending'
  selectedWeek.value = 'all'
  autoRotate.value = true
  setScreen(false)
  displayMessage.value = '已恢复默认显示设置。'
}

const resumeRefresh = () => {
  if (document.hidden) return
  currentTime.value = Date.now()
  if (!['login', 'closed'].includes(phase.value)) void refresh()
}
const resizeScreen = () => {
  if (!layoutFrame) layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; measureScreen() })
}
const measureScreen = () => {
  const candidate = screen.value && window.matchMedia('(min-width: 1200px) and (min-height: 700px)').matches
  // 先按固定大屏样式实测，避免普通模式较大的间距误判为没有空间。
  dashboardPage.value?.classList.toggle('is-fixed-screen', candidate)
  const developmentPanel = dashboardPage.value?.querySelector<HTMLElement>('.dashboard-development')
  let developmentReserve = developmentPanel ? Math.min(260, Math.max(160, window.innerHeight * .18)) + 16 : 0
  // 桌面大屏保持在视口内，空间不足时减少固定行数，不能退回整页滚动。
  viewportFitsScreen.value = candidate
  dashboardPage.value?.classList.toggle('is-fixed-screen', fixedScreen.value)
  desktopPagination.value = window.matchMedia('(min-width: 1000px)').matches
  const rankPanel = dashboardPage.value?.querySelector<HTMLElement>('.dashboard-scoreboard')
  const rankViewport = rankPanel?.querySelector<HTMLElement>('.dashboard-scroll-viewport')
  const rankStyle = rankPanel && getComputedStyle(rankPanel)
  // 空任务/单行任务时也给榜单保留按钮、说明和两行人员的空间。
  const minimumRankingHeight = rankPanel && rankViewport && rankStyle
    ? rankViewport.getBoundingClientRect().top - rankPanel.getBoundingClientRect().top
      + Number.parseFloat(rankStyle.paddingBottom) + Number.parseFloat(rankStyle.borderBottomWidth)
      + (Number.parseFloat(rankStyle.fontSize) || 16) * 7
    : 0
  if (!taskList.value) {
    const panel = dashboardPage.value?.querySelector<HTMLElement>('.dashboard-tasks')
    const style = panel && getComputedStyle(panel)
    fixedGridHeight.value = fixedScreen.value && developmentPanel && panel && style ? Math.ceil(Math.max(minimumRankingHeight,
      [...panel.children].reduce((total, element) => {
        const childStyle = getComputedStyle(element)
        return total + element.getBoundingClientRect().height + (Number.parseFloat(childStyle.marginTop) || 0) + (Number.parseFloat(childStyle.marginBottom) || 0)
      }, 0) + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth)
    )) : null

    return
  }
  const box = taskList.value.getBoundingClientRect()
  // 桌面普通模式用独立的视口预算分页，不使用完整任务列表的高度，避免反馈增长；窄屏连续滚动。
  const fontSize = Number.parseFloat(getComputedStyle(taskList.value).fontSize) || 16
  const gap = fixedScreen.value ? 10 : 14
  const columns = dashboardGridLayout(box.width, 0, gap, fontSize).columns
  const cardHeight = Number.parseFloat(getComputedStyle(taskList.value).gridAutoRows) || fontSize * 11
  const grid = dashboardPage.value?.querySelector<HTMLElement>('.dashboard-grid')
  const panel = taskList.value.closest<HTMLElement>('.dashboard-tasks')
  const pager = panel?.querySelector<HTMLElement>('.dashboard-pagination')
  // 以页面边界计算独立预算，不再从已经收紧的列表高度反推容量，避免越算越少。
  const panelStyle = panel && getComputedStyle(panel)
  const panelBottom = panelStyle ? Number.parseFloat(panelStyle.paddingBottom) + Number.parseFloat(panelStyle.borderBottomWidth) : 0
  const chrome = panel ? box.top - panel.getBoundingClientRect().top + (pager?.getBoundingClientRect().height || 0) + panelBottom : 0
  const available = dashboardPage.value && grid ? dashboardPage.value.getBoundingClientRect().bottom - grid.getBoundingClientRect().top : 0
  let height = fixedScreen.value ? Math.max(0, available - developmentReserve - chrome) : Math.max(300, Math.min(window.innerHeight * .62, 900))
  const minimumHeight = visibleTasks.value.length > columns ? cardHeight * 2 + gap : cardHeight
  // 优先给足两行的高度，研发区可降至其160px可读下限；与当前页文字长短无关。
  if (fixedScreen.value && developmentPanel && height < minimumHeight) {
    developmentReserve = Math.min(developmentReserve, Math.max(176, available - chrome - minimumHeight))
    height = Math.max(0, available - developmentReserve - chrome)
  }
  layout.value = dashboardGridLayout(box.width, height, gap, fontSize, cardHeight)
  const usedRows = Math.min(layout.value.rows, Math.max(1, Math.ceil(visibleTasks.value.length / layout.value.columns)))
  // 尾页也保留相同面板高度，翻页不重新分配空间或改变每页容量。
  fixedGridHeight.value = fixedScreen.value && developmentPanel ? Math.ceil(Math.max(minimumRankingHeight, chrome + usedRows * cardHeight + (usedRows - 1) * gap)) : null
}
watch(taskList, (element, previous) => {
  if (previous) layoutObserver?.unobserve(previous)
  if (element) layoutObserver?.observe(element)
  void nextTick(resizeScreen)
}, { flush: 'post' })
watch([screen, showSyncDetails], () => { void nextTick(resizeScreen) })
watch([data, memberStatus, selectedRanking, selectedGroup, selectedWeek, search, selectedStatus, () => visibleTasks.value.length], () => { void nextTick(resizeScreen) }, { flush: 'post' })
onMounted(() => {
  currentTime.value = Date.now()
  lastRotation = currentTime.value
  let saved = readDashboardPreferences(null)
  try { saved = readDashboardPreferences(localStorage.getItem(DASHBOARD_PREFERENCES_KEY)) } catch { /* 显示仍可正常使用。 */ }
  selectedGroup.value = saved.group
  selectedStatus.value = saved.status
  selectedWeek.value = saved.week
  autoRotate.value = saved.autoRotate
  const explicit = new URLSearchParams(window.location.search).get('screen')
  screen.value = explicit === null ? saved.screen : explicit === '1'
  preferencesLoaded = true
  layoutObserver = new ResizeObserver(resizeScreen)
  if (taskList.value) layoutObserver.observe(taskList.value)
  resizeScreen()
  document.body.classList.toggle('dashboard-screen', screen.value)
  clockTimer = setInterval(() => {
    if (document.hidden) return
    currentTime.value = Date.now()
    if (fixedScreen.value && autoRotate.value && !overlayOpen.value && !document.hidden && pages.value > 1 && currentTime.value - lastRotation >= 15_000) {
      pageIndex.value = (pageIndex.value + 1) % pages.value
      lastRotation = currentTime.value
    }
  }, 1000)
  document.addEventListener('visibilitychange', resumeRefresh)
  window.addEventListener('resize', resizeScreen)
  document.addEventListener('fullscreenchange', syncFullscreen)
  document.addEventListener('keydown', escapeFullscreen)
  syncFullscreen()
  void refresh()
})
onBeforeUnmount(() => {
  layoutObserver?.disconnect()
  cancelAnimationFrame(layoutFrame)
  disposed = true
  data.value = null
  request?.abort()
  clearTimeout(pollTimer)
  clearInterval(clockTimer)
  document.removeEventListener('visibilitychange', resumeRefresh)
  window.removeEventListener('resize', resizeScreen)
  document.removeEventListener('fullscreenchange', syncFullscreen)
  document.removeEventListener('keydown', escapeFullscreen)
  if (ownsFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  document.body.classList.remove('dashboard-screen')
})
</script>

<template>
  <main ref="dashboardPage" class="dashboard-page" :style="{ '--dashboard-grid-height': fixedGridHeight === null ? undefined : `${fixedGridHeight}px` }" :class="{ 'is-screen': screen, 'is-fixed-screen': fixedScreen, 'is-paginated': paginated, 'is-gated': !data, 'has-development-layout': fixedGridHeight !== null }">
    <header class="dashboard-heading">
      <NuxtLink class="dashboard-identity" to="/" :aria-label="`${site.university}${site.shortName}，返回首页`">
        <span class="dashboard-insignia"><img :src="site.logo" :alt="site.logoAlt" width="96" height="96"></span>
        <div><strong class="dashboard-team-name"><span>{{ site.university }}</span><span>{{ site.shortName }}</span></strong><span class="dashboard-brand-caption">{{ site.englishName }}</span></div>
      </NuxtLink>
      <div class="dashboard-heading-center">
        <div class="dashboard-title-block"><p class="eyebrow">ROBOCON · 北京时间</p><h1>任务看板</h1></div>
        <section v-if="eventCountdowns.length" class="dashboard-heading-competitions" aria-label="赛事倒计时">
          <article v-for="event in eventCountdowns" :key="event.name" class="dashboard-heading-event" :class="{ 'is-reached': event.state === 'reached' }">
            <div class="dashboard-heading-event-info">
              <h2 :aria-label="event.name"><img class="dashboard-event-logo" :src="roboconPartner.logo" alt="CURC 全国大学生机器人大赛与 ROBOCON 标志" width="1931" height="656"><span>{{ event.shortName || event.name }}</span></h2>
              <div class="dashboard-heading-event-meta">
                <time v-if="event.target !== null" :datetime="event.startsAt || undefined" :title="`${formatEventTime(event.target)} · 北京时间 · ${event.referenceNote || ''}`">{{ formatEventTime(event.target) }}</time>
                <component :is="event.sourceUrl ? 'a' : 'span'" class="dashboard-event-reference" :class="event.dateStatus"
                  :href="event.sourceUrl || undefined" :target="event.sourceUrl ? '_blank' : undefined" :rel="event.sourceUrl ? 'noopener noreferrer' : undefined"
                  :title="event.referenceNote" :aria-label="`${event.name}：${eventReferenceLabel(event)}${event.sourceUrl ? '，查看官方参考' : ''}`">
                  {{ eventReferenceLabel(event) }}<span v-if="event.sourceUrl" aria-hidden="true"> ↗</span>
                </component>
              </div>
            </div>
            <div class="dashboard-heading-event-count">
              <template v-if="event.state === 'counting'"><span class="visually-hidden">{{ event.dateStatus === 'target' ? '距离最终形态目标' : event.dateStatus === 'historical' ? '距离参考日期' : '距离赛事' }}</span><strong>{{ event.days }}<small> 天</small></strong><span>{{ event.clock }}</span></template>
              <strong v-else>{{ event.state === 'pending' ? '日期待定' : event.state === 'waiting' ? '正在校时…' : '已到达节点' }}</strong>
            </div>
          </article>
        </section>

      </div>
      <div class="dashboard-header-controls">
        <p class="dashboard-clock">{{ clock || '任务进展，一目了然。' }}</p>
        <div class="dashboard-actions">
        <span class="dashboard-connection" :class="{ 'is-online': phase === 'ready' && !updateInterrupted }"><i aria-hidden="true" />{{ loading ? '正在同步' : phase === 'ready' ? updateInterrupted ? '等待更新' : '数据已同步' : phase === 'login' ? '请先登录' : '暂未连接' }}</span>
        <button type="button" :disabled="loading" @click="refresh">{{ loading ? '更新中…' : '刷新' }}</button>
        <button type="button" :aria-pressed="screen" @click="toggleScreen">{{ screen ? '退出大屏' : '大屏模式' }}</button>
        <button type="button" :aria-pressed="fullscreen" @click="toggleFullscreen">{{ fullscreen ? '退出全屏' : '浏览器全屏' }}</button>
        </div>
      </div>
    </header>
    <p v-if="displayMessage" class="dashboard-notice" role="status">{{ displayMessage }}</p>

    <section v-if="!data" class="dashboard-gate" aria-live="polite">
      <div class="dashboard-radar" aria-hidden="true"><span /><i /></div>
      <h2>{{ phase === 'loading' ? '正在读取任务…' : phase === 'closed' ? '看板尚未开放' : '暂时无法更新' }}</h2>
      <p>{{ message || '稍等片刻，正在获取最新进展。' }}</p>
      <button v-if="statusIssues.length" type="button" @click="showStatusIssues = true">查看 {{ statusIssues.length }} 项状态异常</button>
      <button v-if="phase === 'error'" type="button" :disabled="loading" @click="refresh">重新加载</button>
    </section>

    <template v-else>
      <p v-if="data.demo" class="dashboard-notice">本地演示数据</p>
      <p v-if="data.lookupUnavailable" class="dashboard-notice dashboard-warning" role="status">部门或成员身份暂未同步，请检查飞书应用的字段只读权限及查找引用设置；身份未确认的人员仅列总榜。</p>
      <p v-if="updateInterrupted" role="status" class="dashboard-notice dashboard-warning">{{ message || '更新暂时中断，正在显示上次结果。' }} 上次更新 {{ formatTime(data.updatedAt) }}</p>
      <p v-if="missingStatusCount || statusIssues.length" role="status" class="dashboard-notice dashboard-warning"><template v-if="missingStatusCount">{{ missingStatusCount }} 项状态未填写，暂按未完成展示、不计分。</template><template v-if="statusIssues.length">{{ statusIssues.length }} 项状态无法识别，暂未纳入统计。<button type="button" class="dashboard-text-button" @click="showStatusIssues = true">查看异常任务 →</button></template></p>
      <div class="dashboard-toolbar">
        <div class="dashboard-filters">
          <div class="dashboard-query"><label for="task-week" class="visually-hidden">周次</label><select id="task-week" v-model="selectedWeek"><option value="all">全部周次</option><option v-for="week in weeks" :key="week" :value="String(week)">第{{ week }}周</option><option value="missing">未填周次</option></select><label for="task-search" class="visually-hidden">搜索任务</label><input id="task-search" v-model="search" type="search" placeholder="搜索任务、执行人或备注"><label for="task-group" class="visually-hidden">组别</label><select id="task-group" v-model="selectedGroup"><option value="all">全部组别</option><option v-for="group in groups" :key="group" :value="group">{{ group }}</option></select></div>
          <p class="dashboard-update"><span :class="{ interrupted: updateInterrupted }" />{{ updateInterrupted ? '等待更新' : '自动更新中' }} · {{ formatTime(data.updatedAt) }} <button type="button" class="dashboard-text-button" @click="resetDisplay">重置显示</button></p>
        </div>
        <section class="dashboard-stats" aria-label="任务概览">
          <div><span>待办任务</span><strong>{{ counts.pending }}</strong></div>
          <div class="dashboard-overdue"><span>已逾期</span><strong>{{ counts.overdue }}</strong></div>
          <div><span>已完成</span><strong>{{ counts.done }}</strong><button type="button" class="dashboard-text-button dashboard-trend-trigger" aria-label="查看完成趋势" @click="selectedTaskId = null; showCompletion = true">完成趋势 →</button></div>
        </section>
      </div>
      <div class="dashboard-grid">
        <section class="dashboard-panel dashboard-tasks" aria-label="任务列表">
          <div class="dashboard-panel-heading"><h2>任务进展</h2><span>{{ visibleTasks.length }} 项</span></div>
          <div class="dashboard-tabs" aria-label="任务状态筛选"><button v-for="status in statuses" :key="status.value" type="button" :aria-pressed="selectedStatus === status.value" :class="{ active: selectedStatus === status.value }" @click="selectedStatus = status.value">{{ status.label }} <span>{{ status.count }}</span></button></div>
          <div v-if="pageTasks.length" ref="taskList" class="dashboard-task-list" :style="{ '--dashboard-columns': layout.columns, '--dashboard-rows': layout.rows }">
            <article v-for="task in pageTasks" :key="task.id" class="dashboard-task" :class="dashboardTaskState(task, currentTime)" @click="openCard($event, task.id)">
              <DashboardTaskContent :task="task" :current-time="currentTime" :paginated="paginated" :profile-for="memberProfile" @open="openTask" />
            </article>
          </div>
          <div v-else class="dashboard-empty">{{ tasks.length ? '没有匹配的任务。' : '暂无任务，新的进展会显示在这里。' }}</div>
          <div v-if="paginated && pageTasks.length" class="dashboard-pagination" aria-label="任务分页"><button type="button" aria-label="上一页任务" :disabled="pages === 1" @click="pageIndex = (pageIndex + pages - 1) % pages">上一页</button><span>{{ pageIndex + 1 }} / {{ pages }} <small>每页 {{ pageSize }} 项</small></span><button type="button" aria-label="下一页任务" :disabled="pages === 1" @click="pageIndex = (pageIndex + 1) % pages">下一页</button><button v-if="fixedScreen" type="button" :disabled="pages === 1" :aria-pressed="autoRotate" @click="autoRotate = !autoRotate">{{ autoRotate ? '暂停轮播' : '继续轮播' }}</button></div>
        </section>

        <aside class="dashboard-ranks" aria-label="个人积分统计">
          <section class="dashboard-panel dashboard-scoreboard">
            <DashboardAutoScroll :key="`${selectedRanking}:${selectedGroup}`" :label="`个人${rankingLabel}`" :suspended="overlayOpen" heading-class="dashboard-panel-heading">
            <template #heading><h2>个人积分榜</h2></template>
            <template #description>
              <div class="dashboard-ranking-switch" role="group" aria-label="积分榜切换"><button v-for="option in rankingOptions" :key="option.value" type="button" :aria-pressed="selectedRanking === option.value" @click="selectedRanking = option.value">{{ option.label }}</button></div>
              <p class="dashboard-score-scope">{{ dashboardSeason }}赛季 · {{ selectedGroup === 'all' ? '全部组别' : selectedGroup }}<template v-if="selectedWeek !== 'all'"> · {{ selectedWeek === 'missing' ? '未填周次' : `第${selectedWeek}周` }}</template><br>仅已完成任务计分<template v-if="cohortRanking.unmatchedCount"> · {{ cohortRanking.unmatchedCount }}人身份未确认，仅列总榜</template></p>
              <p v-if="scoreboard.missingScoreCount || scoreboard.invalidScoreCount || scoreboard.unassignedCount" class="dashboard-score-warning" role="status">已完成任务中，<template v-if="scoreboard.missingScoreCount">{{ scoreboard.missingScoreCount }}项未设分；</template><template v-if="scoreboard.invalidScoreCount">{{ scoreboard.invalidScoreCount }}项分值异常；</template><template v-if="scoreboard.unassignedCount">{{ scoreboard.unassignedCount }}项未分配负责人；</template>以上情况不产生对应积分。</p>
            </template>
            <ol v-if="cohortRanking.rows.length" class="dashboard-rank-list"><li v-for="person in cohortRanking.rows" :key="person.key" :style="{ '--rank-width': `${person.score / (cohortRanking.rows[0]?.score || 1) * 100}%` }"><span class="dashboard-rank-number">{{ String(person.rank).padStart(2, '0') }}</span><DashboardMember class="dashboard-rank-name" :person="person" :profile="memberProfile(person.name)" /><div class="dashboard-rank-total"><strong>{{ person.score }}<small> 分</small></strong><small>已完成 {{ person.doneCount }} 项</small></div></li></ol>
            <p v-else class="dashboard-empty">{{ selectedRanking === 'all' ? '暂无任务人员' : `暂无${rankingLabel}任务人员` }}</p>
            </DashboardAutoScroll>
          </section>
        </aside>
      </div>


      <section v-if="development?.enabled" class="dashboard-panel dashboard-development" aria-label="研发动态">
        <div class="dashboard-panel-heading"><h2>研发动态 <small class="dashboard-code-platform">GitHub</small></h2><div class="dashboard-development-controls"><span>{{ development.configurationError ? '仓库配置待检查' : development.syncing ? '分批同步中，当前为部分结果' : development.unavailable ? '部分数据暂不可用' : `更新于 ${formatTime(development.updatedAt)}` }}</span><button v-if="development.organization || development.sources?.length" type="button" class="dashboard-text-button" :aria-expanded="showSyncDetails" aria-controls="dashboard-sync-details" @click="showSyncDetails = !showSyncDetails">{{ showSyncDetails ? '收起同步详情 ↑' : '同步详情 ↓' }}</button></div></div>
        <div v-if="showSyncDetails" id="dashboard-sync-details">
          <p v-if="development.organization" class="dashboard-code-scope"><a :href="development.organization.href" target="_blank" rel="noopener noreferrer">{{ development.organization.name }}</a><span>{{ development.organization.unavailable ? '组织列表更新中断' : development.organization.includedCount === 0 ? '当前可读取范围内没有纳入的代码仓库' : '组织代码仓库' }}</span><span v-if="development.organization.includedCount !== undefined">已同步 {{ development.sources?.filter(source => !source.pending && !source.unavailable).length || 0 }} / {{ development.organization.includedCount }}<template v-if="development.organization.excludedCount"> · 已排除 {{ development.organization.excludedCount }}</template></span><time v-if="development.organization.updatedAt">列表更新 {{ formatTime(development.organization.updatedAt) }}</time></p>
          <ul v-if="development.sources?.length" class="dashboard-code-sources" aria-label="代码仓库同步状态" tabindex="0"><li v-for="source in development.sources" :key="source.key" :class="{ 'is-unavailable': source.unavailable || source.pending }"><a :href="source.href" target="_blank" rel="noopener noreferrer">{{ source.repo }}</a><small v-if="source.fork">Fork</small><span>{{ source.pending ? (source.unavailable ? '等待同步 · 部分失败' : '等待同步') : source.unavailable ? '更新中断' : '已同步' }}</span><time v-if="source.updatedAt" :datetime="new Date(source.updatedAt).toISOString()">{{ formatTime(source.updatedAt) }}</time></li></ul>
        </div>
        <div class="dashboard-development-grid">
          <DashboardAutoScroll label="代码贡献榜" :suspended="overlayOpen"><template #heading><h3>代码贡献榜 <small>{{ development.syncing ? '部分仓库 · 提交次数' : '提交次数' }}</small></h3></template><ol v-if="development.contributors.length" class="dashboard-code-ranks"><li v-for="person in development.contributors" :key="person.key || person.name"><DashboardCodeContributor :person="person" :profile="codeProfile(person)" /></li></ol><p v-else class="dashboard-empty">{{ development.syncing ? '正在同步贡献记录' : development.unavailable ? '暂时无法读取贡献记录' : '暂无贡献记录' }}</p></DashboardAutoScroll>
          <DashboardAutoScroll label="最近更新" :suspended="overlayOpen"><template #heading><h3>最近更新</h3></template><ul v-if="developmentEvents.length" class="dashboard-events"><li v-for="event in developmentEvents" :key="event.id"><time>{{ formatTime(event.at) }}</time><div class="dashboard-event-content"><DashboardCodeIdentity :profile="codeProfile({ name: event.actor, href: event.actorHref, login: event.actorLogin })" /><span>{{ event.action }}</span><a class="dashboard-event-repo" :href="event.href" target="_blank" rel="noopener noreferrer">{{ event.repo }} <span aria-hidden="true">↗</span></a></div></li></ul><p v-else class="dashboard-empty">{{ development.syncing ? '正在同步研发动态' : development.unavailable ? '暂时无法读取研发动态' : '暂无研发动态' }}</p></DashboardAutoScroll>
        </div>
      </section>
    </template>
    <DashboardTaskDetails v-if="activeTask" :task="activeTask" :now="currentTime" :profile-for="memberProfile" @close="selectedTaskId = null" />
    <DashboardCompletion v-if="data && showCompletion" :tasks="scopedTasks" :now="currentTime" :scope="completionScope" @close="showCompletion = false" />
    <DashboardDialog v-if="showStatusIssues" :open="true" labelledby="dashboard-status-issues-title" @close="showStatusIssues = false">
      <header class="dashboard-dialog-heading"><p class="eyebrow">任务状态检查</p><button type="button" autofocus aria-label="关闭状态异常" @click="showStatusIssues = false">关闭 ×</button></header>
      <h2 id="dashboard-status-issues-title">{{ statusIssues.length }} 项任务状态待确认</h2>
      <p>以下任务的“完成状态/完成情况”无法识别，暂未纳入任务和积分统计。请在飞书核对，当前支持“未开始”“进行中”“待验收”“已完成”（兼容旧“未完成”）；修改后随下一次同步更新。状态为空的任务按未完成展示，不在此列表中。</p>
      <dl class="dashboard-detail-fields"><div v-for="issue in statusIssues" :key="issue.id"><dt>{{ issue.title }}</dt><dd>当前状态：{{ issue.status || '未填写' }}</dd></div></dl>
    </DashboardDialog>
  </main>
</template>

<style src="~/assets/css/dashboard.css" />
