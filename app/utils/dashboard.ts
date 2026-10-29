export { dashboardGridLayout, dashboardTaskPages, dashboardMemberPath, dashboardTaskState, dashboardTaskGroups, selectDashboardTasks, dashboardScoreboard, dashboardScoreLabel } from '../../utils/dashboard-data.mjs'

export type DashboardPerson = { key: string; name: string; avatar: string }
export type DashboardStatusIssue = { id: string; title: string; status: string }
export type DashboardTask = {
  id: string; title: string; group: string; groups?: string[]; assignees: DashboardPerson[]; publisher: string; publishers?: DashboardPerson[]
  deadline: number | null; completedAt: number | null; score: number | null; scoreInvalid?: boolean
  status: 'todo' | 'done'; statusMissing?: boolean; note: string
}
export type DashboardDevelopment = {
  enabled: boolean; unavailable: boolean; updatedAt?: number; configurationError?: boolean; syncing?: boolean
  organization?: { name: string; href: string; unavailable: boolean; updatedAt?: number; discoveredCount?: number; includedCount?: number; excludedCount?: number
    authenticated?: boolean; reason?: string; failureStage?: 'REQUEST' | 'PARSE' }
  contributors: { key?: string; name: string; memberName?: string; login?: string; count: number; avatar: string; href: string }[]
  events: { id: string; repo: string; actor: string; actorLogin?: string; actorHref?: string; action: string; at: number; href: string }[]
  sources?: { key: string; repo: string; href: string; fork?: boolean; pending?: boolean; unavailable: boolean; contributionsUnavailable: boolean; eventsUnavailable: boolean; updatedAt?: number
    authorContributions?: number; authorCount?: number; eventCount?: number; contributionsReason?: string; eventsReason?: string
    contributionsFailureStage?: 'REQUEST' | 'PARSE'; eventsFailureStage?: 'REQUEST' | 'PARSE' }[]
}
export type DashboardData = {
  tasks: DashboardTask[]; updatedAt: number; stale: boolean; refreshSeconds: number; demo?: boolean
  statusIssues?: DashboardStatusIssue[]
  development?: DashboardDevelopment
}
