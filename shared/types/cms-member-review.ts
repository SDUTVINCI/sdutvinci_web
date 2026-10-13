export const CMS_MEMBER_REVIEW_MAX_ITEMS = 50
export const CMS_MEMBER_REVIEW_CONFIRMATION = 'REVIEW_SELECTED_MEMBER_REQUESTS'
export type CmsMemberReviewKind = 'application' | 'proposal' | 'registration'
export type CmsMemberReviewAction = 'approve' | 'reject'
export interface CmsMemberReviewItem { id: string, version?: number }
export interface CmsMemberReviewResult { id: string, ok: boolean, message: string }
