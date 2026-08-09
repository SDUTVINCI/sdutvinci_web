import { Crepe, type CrepeConfig } from '@milkdown/crepe'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { commandsCtx } from '@milkdown/kit/core'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import { insert } from '@milkdown/kit/utils'
import { parse } from 'comark'
import { remark } from 'remark'
import { vinciContentComponentDefinitions } from '~~/shared/utils/vinci-content-components'
import {
  createVinciMarkdownPlugins,
  protectVinciTemplateTokens,
  vinciMarkdownOptions
} from '~~/shared/utils/vinci-markdown'
import { collectCmsProtectedMarkdownSources } from './cms-protected-markdown'

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

const cmsVisualCodeHighlighting = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--cms-code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--cms-code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--cms-code-number)' },
  { tag: [tags.comment, tags.meta], color: 'var(--cms-code-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--cms-code-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--cms-code-type)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--cms-code-variable)' },
  { tag: [tags.punctuation, tags.processingInstruction], color: 'var(--cms-code-punctuation)' },
  { tag: tags.invalid, color: 'var(--cms-code-invalid)', textDecoration: 'underline wavy' }
])

export const cmsVisualCodeMirrorTheme = [
  syntaxHighlighting(cmsVisualCodeHighlighting),
  EditorView.theme({
    '&': { backgroundColor: 'transparent', color: 'var(--cms-code-variable)' },
    '.cm-content': { caretColor: 'var(--cms-code-caret)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cms-code-caret)' },
    '.cm-activeLine': { backgroundColor: 'var(--cms-code-active-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--cms-code-active-gutter)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--cms-code-selection) !important'
    }
  })
]

const componentIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10a2 2 0 0 1 2 2v4h-2V5H7v14h4v2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm8 8h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3Z"/></svg>'

export const createCmsVisualEditorFeatureConfigs = (
  openComponentMenu: () => void
): NonNullable<CrepeConfig['featureConfigs']> => ({
  [Crepe.Feature.CodeMirror]: {
    theme: cmsVisualCodeMirrorTheme
  },
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

export interface CmsVisualRoundTripAssessment {
  safe: boolean
  reason: 'equivalent' | 'protected_syntax_changed' | 'rendering_changed'
}

const finalRenderingFingerprint = async (markdown: string) => JSON.stringify(
  (await parse(protectVinciTemplateTokens(markdown), {
    ...vinciMarkdownOptions,
    plugins: createVinciMarkdownPlugins()
  })).nodes
)

export const assessCmsVisualRoundTrip = async (
  source: string,
  serialized: string
): Promise<CmsVisualRoundTripAssessment> => {
  const sourceProtected = collectCmsProtectedMarkdownSources(source)
  const serializedProtected = collectCmsProtectedMarkdownSources(serialized)
  if (
    sourceProtected.length !== serializedProtected.length
    || sourceProtected.some((item, index) => item !== serializedProtected[index])
  ) {
    return { safe: false, reason: 'protected_syntax_changed' }
  }

  const [sourceRendering, serializedRendering] = await Promise.all([
    finalRenderingFingerprint(source),
    finalRenderingFingerprint(serialized)
  ])
  return sourceRendering === serializedRendering
    ? { safe: true, reason: 'equivalent' }
    : { safe: false, reason: 'rendering_changed' }
}
