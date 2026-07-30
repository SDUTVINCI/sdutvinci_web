import { Crepe } from '@milkdown/crepe'
import { remark } from 'remark'

const markdownSemanticFingerprint = (markdown: string) => JSON.stringify(
  remark().parse(markdown.replace(/\r\n?/g, '\n')),
  (key, value) => key === 'position' ? undefined : value
)

export const cmsVisualEditorFeatures = {
  [Crepe.Feature.AI]: false,
  // Crepe's ImageBlock interprets Markdown image alt text as a numeric aspect
  // ratio and serializes ordinary standalone images as `![1.00](...)`.
  // Vinci content uses alt text for accessibility, so standard Markdown images
  // must stay on Milkdown's commonmark image schema instead.
  [Crepe.Feature.ImageBlock]: false
}

export const isCmsVisualRoundTripLossless = (
  source: string,
  serialized: string
) => markdownSemanticFingerprint(source) === markdownSemanticFingerprint(serialized)
