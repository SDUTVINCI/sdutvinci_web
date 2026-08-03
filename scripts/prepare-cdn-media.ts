import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, extname, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'

const defaultCdnBaseUrl = 'https://cdn.sdutvincirobot.top'
const maximumImageDimension = 2560
const photographicWebpQuality = 85
const hashSuffixLength = 8
const imageExtensions = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])
const videoExtensions = new Set(['.mp4'])

interface ImageManifestEntry {
  kind: 'image'
  source: string
  legacyPath: string
  objectKey: string
  publicUrl: string
  sourceFormat: string
  conversion: 'copied-webp' | 'lossless-webp' | 'photographic-webp'
  sourceSha256: string
  outputSha256: string
  sourceBytes: number
  outputBytes: number
  sourceWidth: number
  sourceHeight: number
  outputWidth: number
  outputHeight: number
  pages: number
}

interface VideoManifestEntry {
  kind: 'video'
  source: string
  legacyPath: string
  objectKey: string
  publicUrl: string
  sourceSha256: string
  outputSha256: string
  sourceBytes: number
  outputBytes: number
  contentType: 'video/mp4'
  conversion: 'copied-original'
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

export const appendContentHash = (
  filename: string,
  contentHash: string,
  outputExtension: string
) => `${parse(filename).name}-${contentHash.slice(0, hashSuffixLength)}${outputExtension}`

export const createCdnPublicUrl = (cdnBaseUrl: string, objectKey: string) => {
  const encodedKey = objectKey
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
  return `${cdnBaseUrl.replace(/\/+$/, '')}/${encodedKey}`
}

const pathExists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const sortPaths = (paths: string[]) => paths.sort((left, right) =>
  left < right ? -1 : left > right ? 1 : 0
)

const collectMediaFiles = async (root: string) => {
  const files: string[] = []
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`拒绝处理符号链接：${relative(root, path)}`)
      }
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile()) {
        const extension = extname(entry.name).toLowerCase()
        if (imageExtensions.has(extension) || videoExtensions.has(extension)) files.push(path)
      }
    }
  }
  await visit(root)
  return sortPaths(files)
}

const ensureParent = (path: string) => mkdir(dirname(path), { recursive: true })

const writeUniqueFile = async (path: string, data: Uint8Array | string) => {
  if (await pathExists(path)) throw new Error(`输出路径冲突：${path}`)
  await ensureParent(path)
  await writeFile(path, data)
}

const toPosix = (path: string) => path.split(sep).join('/')

const convertImage = async (
  sourcePath: string,
  sourceRoot: string,
  stagingRoot: string,
  cdnBaseUrl: string
): Promise<ImageManifestEntry> => {
  const source = await readFile(sourcePath)
  const sourceRelativePath = toPosix(relative(sourceRoot, sourcePath))
  const sourceImage = sharp(source, {
    animated: true,
    failOn: 'error',
    limitInputPixels: 100_000_000
  })
  const metadata = await sourceImage.metadata()
  if (!metadata.format || !metadata.width || !metadata.height) {
    throw new Error(`无法识别图片：${sourceRelativePath}`)
  }

  let output: Buffer
  let conversion: ImageManifestEntry['conversion']
  if (metadata.format === 'webp') {
    output = source
    conversion = 'copied-webp'
  } else {
    const lossless = metadata.format === 'png'
    output = await sourceImage
      .rotate()
      .resize({
        width: maximumImageDimension,
        height: maximumImageDimension,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp(lossless
        ? { lossless: true, effort: 6 }
        : {
            quality: photographicWebpQuality,
            effort: 6,
            smartSubsample: true
          })
      .toBuffer()
    conversion = lossless ? 'lossless-webp' : 'photographic-webp'
  }

  const outputMetadata = await sharp(output, { animated: true }).metadata()
  if (!outputMetadata.width || !outputMetadata.height || outputMetadata.format !== 'webp') {
    throw new Error(`WebP 输出校验失败：${sourceRelativePath}`)
  }

  const outputHash = sha256(output)
  const sourceDirectory = toPosix(dirname(sourceRelativePath))
  const outputFilename = appendContentHash(sourceRelativePath, outputHash, '.webp')
  const objectKey = [
    'site-assets/images',
    sourceDirectory === '.' ? '' : sourceDirectory,
    outputFilename
  ].filter(Boolean).join('/')
  await writeUniqueFile(join(stagingRoot, objectKey), output)

  return {
    kind: 'image',
    source: `public/images/${sourceRelativePath}`,
    legacyPath: `/images/${sourceRelativePath}`,
    objectKey,
    publicUrl: createCdnPublicUrl(cdnBaseUrl, objectKey),
    sourceFormat: metadata.format,
    conversion,
    sourceSha256: sha256(source),
    outputSha256: outputHash,
    sourceBytes: source.length,
    outputBytes: output.length,
    sourceWidth: metadata.width,
    sourceHeight: metadata.pageHeight || metadata.height,
    outputWidth: outputMetadata.width,
    outputHeight: outputMetadata.pageHeight || outputMetadata.height,
    pages: outputMetadata.pages || 1
  }
}

const copyVideo = async (
  sourcePath: string,
  sourceRoot: string,
  stagingRoot: string,
  cdnBaseUrl: string
): Promise<VideoManifestEntry> => {
  const sourceRelativePath = toPosix(relative(sourceRoot, sourcePath))
  const source = await readFile(sourcePath)
  if (sourceRelativePath !== 'backgroundvideo.mp4') {
    throw new Error(`当前上传策略只允许首页 MP4 视频：${sourceRelativePath}`)
  }
  const contentHash = sha256(source)
  const filename = appendContentHash(sourceRelativePath, contentHash, '.mp4')
  const objectKey = `site-assets/videos/${filename}`
  await writeUniqueFile(join(stagingRoot, objectKey), source)

  return {
    kind: 'video',
    source: `public/images/${sourceRelativePath}`,
    legacyPath: `/images/${sourceRelativePath}`,
    objectKey,
    publicUrl: createCdnPublicUrl(cdnBaseUrl, objectKey),
    sourceSha256: contentHash,
    outputSha256: contentHash,
    sourceBytes: source.length,
    outputBytes: source.length,
    contentType: 'video/mp4',
    conversion: 'copied-original'
  }
}

const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`

const createCsv = (images: ImageManifestEntry[], videos: VideoManifestEntry[]) => {
  const rows = [[
    'kind', 'source', 'legacyPath', 'objectKey', 'publicUrl', 'codecOrMode',
    'sourceBytes', 'outputBytes', 'sha256', 'contentType'
  ]]
  for (const image of images) {
    rows.push([
      image.kind,
      image.source,
      image.legacyPath,
      image.objectKey,
      image.publicUrl,
      image.conversion,
      String(image.sourceBytes),
      String(image.outputBytes),
      image.outputSha256,
      'image/webp'
    ])
  }
  for (const video of videos) {
    rows.push([
      video.kind,
      video.source,
      video.legacyPath,
      video.objectKey,
      video.publicUrl,
      video.conversion,
      String(video.sourceBytes),
      String(video.outputBytes),
      video.outputSha256,
      video.contentType
    ])
  }
  return `${rows.map(row => row.map(csvCell).join(',')).join('\n')}\n`
}

const createUploadInstructions = (cdnBaseUrl: string, totalFiles: number) => `# CDN 手动上传包

本目录由 \`npm run media:prepare\` 生成，共包含 ${totalFiles} 个待上传文件。

1. 在图床 Bucket 根目录上传整个 \`site-assets\` 文件夹，并保留其中的目录结构和文件名。
2. 不要把它放进 CMS 的 \`images/YYYY/MM/<draftId>/\` 自动上传目录。
3. 图片 Content-Type 应为 \`image/webp\`；MP4 为 \`video/mp4\`。
4. 文件名带内容哈希，可使用 \`Cache-Control: public, max-age=31536000, immutable\`。
5. 上传后应能从 \`${cdnBaseUrl}/site-assets/...\` 公开读取。请通知 Codex 继续校验和切换网站引用。

\`manifest.json\` 和 \`manifest.csv\` 是本地核对材料，不需要上传。
`

const parseArguments = () => {
  let cdnBaseUrl = defaultCdnBaseUrl
  let output = 'cdn-upload'
  let source = 'public/images'
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index]
    if (argument === '--base-url') {
      cdnBaseUrl = process.argv[++index] || ''
    } else if (argument === '--output') {
      output = process.argv[++index] || ''
    } else if (argument === '--source') {
      source = process.argv[++index] || ''
    } else if (argument === '--help') {
      console.log('用法：npm run media:prepare -- [--source public/images] [--base-url https://cdn.example] [--output cdn-upload]')
      process.exit(0)
    } else {
      throw new Error(`未知参数：${argument}`)
    }
  }
  const parsedUrl = new URL(cdnBaseUrl)
  if (parsedUrl.protocol !== 'https:') throw new Error('CDN base URL 必须使用 HTTPS')
  if (!source.trim()) throw new Error('媒体源目录不能为空')
  return { cdnBaseUrl: parsedUrl.toString().replace(/\/+$/, ''), output, source }
}

const main = async () => {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const repositoryRoot = resolve(scriptDirectory, '..')
  const { cdnBaseUrl, output, source } = parseArguments()
  const sourceRoot = resolve(repositoryRoot, source)
  const outputRoot = resolve(repositoryRoot, output)
  if (sourceRoot === repositoryRoot) {
    throw new Error('媒体源目录不能是仓库根目录')
  }
  if (!await pathExists(sourceRoot)) {
    throw new Error(`媒体源目录不存在：${sourceRoot}；迁移完成后请用 --source 指向恢复出的原媒体目录`)
  }
  const sourceStats = await stat(sourceRoot)
  if (!sourceStats.isDirectory()) throw new Error(`媒体源路径不是目录：${sourceRoot}`)
  if (
    outputRoot === repositoryRoot
    || !outputRoot.startsWith(`${repositoryRoot}${sep}`)
  ) {
    throw new Error('输出目录必须是仓库内部的明确子目录')
  }
  if (await pathExists(outputRoot)) {
    throw new Error(`输出目录已存在，请先移动或删除后重试：${outputRoot}`)
  }

  const stagingRoot = join(repositoryRoot, `.cdn-upload-staging-${process.pid}-${Date.now()}`)
  try {
    await mkdir(stagingRoot, { recursive: false })
    const mediaFiles = await collectMediaFiles(sourceRoot)
    const imageFiles = mediaFiles.filter(path => imageExtensions.has(extname(path).toLowerCase()))
    const videoFiles = mediaFiles.filter(path => videoExtensions.has(extname(path).toLowerCase()))
    if (!imageFiles.length) throw new Error('没有找到待处理图片')
    if (videoFiles.length !== 1) {
      throw new Error(`预期恰好一个首页视频，实际为 ${videoFiles.length}`)
    }

    const images: ImageManifestEntry[] = []
    for (const [index, sourcePath] of imageFiles.entries()) {
      console.log(`[图片 ${index + 1}/${imageFiles.length}] ${relative(repositoryRoot, sourcePath)}`)
      images.push(await convertImage(sourcePath, sourceRoot, stagingRoot, cdnBaseUrl))
    }

    console.log(`[视频 1/${videoFiles.length}] ${relative(repositoryRoot, videoFiles[0]!)}`)
    const videos = [await copyVideo(
      videoFiles[0]!,
      sourceRoot,
      stagingRoot,
      cdnBaseUrl
    )]

    const sourceBytes = images.reduce((sum, item) => sum + item.sourceBytes, 0)
      + videos.reduce((sum, item) => sum + item.sourceBytes, 0)
    const outputBytes = images.reduce((sum, item) => sum + item.outputBytes, 0)
      + videos.reduce((sum, item) => sum + item.outputBytes, 0)
    const uploadFileCount = images.length + videos.length
    const manifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      cdnBaseUrl,
      uploadDirectory: 'site-assets',
      policies: {
        images: {
          format: 'webp',
          maximumDimension: maximumImageDimension,
          photographicQuality: photographicWebpQuality,
          png: 'lossless',
          existingWebp: 'copy'
        },
        backgroundVideo: {
          format: 'original MP4',
          conversion: 'byte-for-byte copy; no compression or transcoding'
        }
      },
      summary: {
        imageCount: images.length,
        videoSourceCount: videos.length,
        uploadFileCount,
        sourceBytes,
        outputBytes,
        changePercent: Number((((outputBytes - sourceBytes) / sourceBytes) * 100).toFixed(2))
      },
      images,
      videos
    }

    await writeFile(join(stagingRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await writeFile(join(stagingRoot, 'manifest.csv'), createCsv(images, videos))
    await writeFile(
      join(stagingRoot, 'UPLOAD_INSTRUCTIONS.md'),
      createUploadInstructions(cdnBaseUrl, uploadFileCount)
    )
    await rename(stagingRoot, outputRoot)
    const outputStats = await stat(outputRoot)
    if (!outputStats.isDirectory()) throw new Error('上传包输出不是目录')

    console.log(`\n上传包已生成：${outputRoot}`)
    console.log(`请把 ${join(outputRoot, 'site-assets')} 整个文件夹上传到 Bucket 根目录。`)
    console.log(`待上传文件：${uploadFileCount}；原始：${sourceBytes} bytes；输出：${outputBytes} bytes。`)
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
