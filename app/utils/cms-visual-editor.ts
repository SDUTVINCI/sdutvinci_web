import { Crepe, type CrepeConfig } from '@milkdown/crepe'
import { commandsCtx } from '@milkdown/kit/core'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import { insert } from '@milkdown/kit/utils'
import { remark } from 'remark'
import { vinciContentComponentDefinitions } from '~~/shared/utils/vinci-content-components'

const markdownSemanticFingerprint = (markdown: string) => JSON.stringify(
  remark().parse(markdown.replace(/\r\n?/g, '\n')),
  (key, value) => key === 'position' ? undefined : value
)

export const cmsVisualEditorFeatures = {
  [Crepe.Feature.AI]: false,
  [Crepe.Feature.TopBar]: true,
  // Crepe's ImageBlock interprets Markdown image alt text as a numeric aspect
  // ratio and serializes ordinary standalone images as `![1.00](...)`.
  // Vinci content uses alt text for accessibility, so standard Markdown images
  // must stay on Milkdown's commonmark image schema instead.
  [Crepe.Feature.ImageBlock]: false
}

const componentIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10a2 2 0 0 1 2 2v4h-2V5H7v14h4v2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm8 8h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3Z"/></svg>'

export const createCmsVisualEditorFeatureConfigs = (
  openComponentMenu: () => void
): NonNullable<CrepeConfig['featureConfigs']> => ({
  [Crepe.Feature.BlockEdit]: {
    buildMenu: (builder) => {
      const group = builder.addGroup('vinci-components', 'Vinci 内容组件')
      for (const definition of vinciContentComponentDefinitions) {
        group.addItem(definition.id, {
          label: definition.label,
          icon: componentIcon,
          onRun: (ctx) => {
            ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key)
            insert(definition.defaultMarkdown)(ctx)
          }
        })
      }
    }
  },
  [Crepe.Feature.TopBar]: {
    buildTopBar: (builder) => {
      builder.getGroup('insert').addItem('vinci-component', {
        icon: componentIcon,
        active: () => false,
        onRun: openComponentMenu
      })
    }
  },
  [Crepe.Feature.Toolbar]: {
    buildToolbar: (builder) => {
      builder.getGroup('function').addItem('vinci-component', {
        icon: componentIcon,
        active: () => false,
        onRun: openComponentMenu
      })
    }
  }
})

export const isCmsVisualRoundTripLossless = (
  source: string,
  serialized: string
) => markdownSemanticFingerprint(source) === markdownSemanticFingerprint(serialized)
