export const contentImportClassifications = [
  'safe_change',
  'auto_merge',
  'content_conflict',
  'new_article',
  'move_or_rename',
  'deletion_proposal',
  'path_conflict',
  'invalid_file',
  'unknown_syntax',
  'high_risk_syntax'
  ,'member_safe_change'
  ,'member_auto_merge'
  ,'member_conflict'
  ,'member_deletion_proposal'
  ,'member_sensitive_rejected'
  ,'member_invalid'
] as const

export type ContentImportClassification = typeof contentImportClassifications[number]
export type ContentImportItemStatus = 'pending' | 'imported' | 'skipped' | 'blocked'

export const CONTENT_IMPORT_HIGH_RISK_CONFIRMATION = '确认强制导入高风险内容'

export interface CmsContentImportItem {
  id: string
  ordinal: number
  changeType: 'added' | 'modified' | 'renamed' | 'removed' | 'invalid'
  classification: ContentImportClassification
  targetType: 'article' | 'member'
  importable: boolean
  highRiskForceEligible: boolean
  oldPath: string | null
  newPath: string | null
  articleId: string | null
  baseRevisionId: string | null
  currentRevisionId: string | null
  memberId: string | null
  baseMemberRevisionId: string | null
  currentMemberRevisionId: string | null
  memberProposalId: string | null
  proposedArticleId: string | null
  baseSha256: string | null
  currentSha256: string | null
  proposedSha256: string | null
  mergedSha256: string | null
  warningCodes: string[]
  conflictDetails: Record<string, unknown>
  status: ContentImportItemStatus
  draftId: string | null
  importedAt: string | null
  hasBase: boolean
  hasCurrent: boolean
  hasProposed: boolean
  hasMerged: boolean
}

export interface CmsContentImportRun {
  id: string
  repositoryId: string
  pullRequestNumber: number
  baseCommitHash: string
  headCommitHash: string
  baseSnapshotSha256: string
  prAuthorLabel: string | null
  status: 'dry_run' | 'partially_imported' | 'imported' | 'failed'
  itemCount: number
  importableCount: number
  importedCount: number
  conflictCount: number
  startedAt: string
  completedAt: string | null
  externalActions: Array<{
    id: string
    action: 'comment' | 'close'
    status: 'processing' | 'succeeded' | 'failed'
    errorCode: string | null
    createdAt: string
  }>
  items: CmsContentImportItem[]
}
