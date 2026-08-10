import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveMarkdownMediaUrls } from '../../shared/utils/static-media'

const execFileAsync = promisify(execFile)

export const createWikiPdf = async (title: string, markdown: string) => {
  const workRoot = await mkdtemp(join(tmpdir(), 'vinci-wiki-pdf-'))
  const sourcePath = join(workRoot, 'article.md')
  const outputPath = join(workRoot, 'article.pdf')
  try {
    const source = `---\ntitle: ${JSON.stringify(title)}\nlang: zh-CN\n---\n\n${resolveMarkdownMediaUrls(markdown)}`
    await writeFile(sourcePath, source, { encoding: 'utf8', mode: 0o600 })
    await execFileAsync('pandoc', [
      sourcePath,
      '--from=markdown',
      '--pdf-engine=xelatex',
      '--variable=mainfont:Noto Sans CJK SC',
      '--variable=CJKmainfont:Noto Sans CJK SC',
      '--output', outputPath
    ], { timeout: 60_000, maxBuffer: 1024 * 1024 })
    return await readFile(outputPath)
  } finally {
    await rm(workRoot, { recursive: true, force: true })
  }
}
