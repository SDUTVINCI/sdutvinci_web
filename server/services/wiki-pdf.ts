import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { resolveMarkdownMediaUrls } from '../../shared/utils/static-media'

const execFileAsync = promisify(execFile)

export const WIKI_PDF_CSS = `
@page { size: A4; margin: 18mm 17mm 20mm; }
html { font-size: 10.5pt; }
body { max-width: 178mm; margin: 0 auto; color: #1f2937; font-family: "Noto Sans CJK SC", sans-serif; line-height: 1.7; }
h1, h2, h3, h4, h5 { color: #123b62; break-after: avoid; }
h1 { font-size: 25pt; border-bottom: 2px solid #2563eb; padding-bottom: 8pt; }
h2 { margin-top: 22pt; font-size: 18pt; }
h3 { margin-top: 18pt; font-size: 15pt; }
h4 { font-size: 12.5pt; }
a { color: #1756a9; text-decoration: none; overflow-wrap: anywhere; }
img { display: block; max-width: 100%; max-height: 220mm; margin: 10pt auto; break-inside: avoid; }
pre { padding: 10pt 12pt; border-left: 3px solid #2563eb; background: #f3f6fa; white-space: pre-wrap; break-inside: avoid; }
code { font-family: "DejaVu Sans Mono", monospace; font-size: 9pt; }
blockquote { margin-left: 0; padding-left: 12pt; border-left: 3px solid #94a3b8; color: #475569; }
nav#TOC { padding: 12pt 18pt; border: 1px solid #dce5ef; background: #f5f8fc; }
nav#TOC::before { content: "目录"; font-size: 16pt; font-weight: 700; }
nav#TOC a { color: #334155; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6pt; border: 1px solid #cbd5e1; }
`

export const createWikiPdf = async (title: string, markdown: string) => {
  const workRoot = await mkdtemp(join(tmpdir(), 'vinci-wiki-pdf-'))
  const sourcePath = join(workRoot, 'article.md')
  const cssPath = join(workRoot, 'pandoc-document.css')
  const htmlPath = join(workRoot, 'article.html')
  const outputPath = join(workRoot, 'article.pdf')
  try {
    const source = `---\ntitle: ${JSON.stringify(title)}\n---\n\n${resolveMarkdownMediaUrls(markdown)}`
    await Promise.all([
      writeFile(sourcePath, source, { encoding: 'utf8', mode: 0o600 }),
      writeFile(cssPath, WIKI_PDF_CSS, { encoding: 'utf8', mode: 0o600 })
    ])
    await execFileAsync('pandoc', [
      sourcePath,
      '--from=markdown',
      '--standalone',
      '--toc',
      '--toc-depth=3',
      `--css=${cssPath}`,
      '--output', htmlPath
    ], { timeout: 60_000, maxBuffer: 1024 * 1024 })
    await execFileAsync(process.env.CHROME_BIN || 'chromium', [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
      '--virtual-time-budget=5000',
      '--run-all-compositor-stages-before-draw',
      '--no-pdf-header-footer',
      `--print-to-pdf=${outputPath}`,
      pathToFileURL(htmlPath).href
    ], { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 })
    const pdf = await readFile(outputPath)
    if (pdf.length < 1000 || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('WIKI_PDF_INVALID')
    return pdf
  } finally {
    await rm(workRoot, { recursive: true, force: true })
  }
}
