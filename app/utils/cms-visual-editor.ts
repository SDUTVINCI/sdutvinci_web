import { Crepe } from '@milkdown/crepe'

const normalizeMarkdownRoundTrip = (markdown: string) =>
  markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim()

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
) => normalizeMarkdownRoundTrip(source) === normalizeMarkdownRoundTrip(serialized)
