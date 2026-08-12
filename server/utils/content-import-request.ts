import { z } from 'zod'
import { CONTENT_IMPORT_HIGH_RISK_CONFIRMATION } from '../../shared/types/cms-content-imports'
import { getContentImportConfig } from './content-import-config'

export const contentImportSelectionSchema = () => {
  const maximum = getContentImportConfig().CONTENT_PR_IMPORT_MAX_FILES
  return z.object({
    itemIds: z.array(z.string().uuid()).min(1).max(maximum),
    forceHighRiskItemIds: z.array(z.string().uuid()).max(maximum).default([]),
    highRiskConfirmation: z.string().optional()
  }).strict().superRefine((input, context) => {
    const selected = new Set(input.itemIds)
    if (input.forceHighRiskItemIds.some(itemId => !selected.has(itemId))) {
      context.addIssue({
        code: 'custom',
        path: ['forceHighRiskItemIds'],
        message: '强制导入的高风险项目必须同时包含在所选项目中'
      })
    }
    if (input.forceHighRiskItemIds.length
      && input.highRiskConfirmation !== CONTENT_IMPORT_HIGH_RISK_CONFIRMATION) {
      context.addIssue({
        code: 'custom',
        path: ['highRiskConfirmation'],
        message: `必须输入“${CONTENT_IMPORT_HIGH_RISK_CONFIRMATION}”`
      })
    }
  })
}
