export const reviewHistoryKinds = ['article', 'member_application', 'member_profile', 'account_registration'] as const
export const reviewHistoryActions = ['approved', 'rejected', 'published', 'failed'] as const
export type ReviewHistoryKind = typeof reviewHistoryKinds[number]
export type ReviewHistoryAction = typeof reviewHistoryActions[number]
export const reviewHistoryKindLabels: Record<ReviewHistoryKind, string> = {
  article: '文章', member_application: '新成员申请', member_profile: '成员资料', account_registration: '账号注册'
}
export const reviewHistoryActionLabels: Record<ReviewHistoryAction, string> = {
  approved: '审核通过', rejected: '已驳回', published: '已发布', failed: '操作失败'
}
export interface ReviewHistoryEntry {
  id: string
  kind: ReviewHistoryKind
  targetId: string
  title: string
  action: ReviewHistoryAction
  actorUserId: string | null
  actorLabel: string
  submitterLabel: string
  note: string | null
  batchId: string | null
  legacy: boolean
  createdAt: string
}
export interface ReviewHistoryPage {
  items: ReviewHistoryEntry[]
  total: number
  page: number
  pageSize: number
  reviewers: Array<{ id: string, label: string }>
}
export interface ReviewHistoryDetail {
  entry: ReviewHistoryEntry
  operation: string | null
  changes: Array<{ field: string, before: string, after: string }>
}
