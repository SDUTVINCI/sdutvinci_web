import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { editLocks, mediaAssets } from '../server/db/schema'
import { bootstrapCmsAdmin } from '../server/services/cms-auth'
import { createCmsNewArticleDraft } from '../server/services/cms-drafts'
import { acquireCmsDraftEditLock, CmsEditLockLostError } from '../server/services/cms-edit-locks'
import {
  CmsMediaStorageError,
  CmsMediaValidationError,
  uploadCmsImage
} from '../server/services/cms-media'
import type { CmsMediaConfig } from '../server/utils/cms-media-config'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const integration = configureCmsTestDatabase() ? describe : describe.skip

const mediaConfig: CmsMediaConfig = {
  S3_ENDPOINT: 'https://s3.test.example',
  S3_REGION: 'test-region-1',
  S3_BUCKET: 'cms-test-bucket',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_PUBLIC_BASE_URL: 'https://images.test.example/assets',
  S3_FORCE_PATH_STYLE: true,
  S3_KEY_PREFIX: 'articles/images',
  CMS_IMAGE_MAX_BYTES: 1024 * 1024,
  CMS_IMAGE_MAX_WIDTH: 800,
  CMS_IMAGE_MAX_HEIGHT: 800,
  CMS_IMAGE_WEBP_QUALITY: 80
}

integration('CMS 图片处理与 S3 兼容对象存储', () => {
  let userId = ''
  let draftId = ''
  let leaseId = ''

  beforeAll(async () => {
    process.env.CMS_AUTH_SECRET ??= 'test-only-secret-with-at-least-32-characters'
    await runMigrations()
  })

  beforeEach(async () => {
    await getDatabase().execute(sql`
      truncate table rate_limit_buckets, media_assets, content_export_jobs, content_export_runs, article_deletion_events, publish_records, edit_locks, review_events,
        audit_logs, sessions, draft_authors, article_revisions, drafts, user_members, user_roles,
        articles, members, users
      restart identity cascade
    `)
    const user = await bootstrapCmsAdmin({
      account: 'imageadmin',
      password: 'AdminPassword123'
    })
    userId = user!.id
    const draft = await createCmsNewArticleDraft('wiki', '图片测试', userId)
    draftId = draft.id
    const lock = await acquireCmsDraftEditLock(draftId, userId, true)
    leaseId = lock.lock.leaseId!
  })

  afterAll(async () => {
    await closeDatabase()
  })

  it('校验真实格式、限制尺寸、转换为 WebP、按 Unix 毫秒和内容哈希命名并记录媒体元数据', async () => {
    const source = await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: '#2d7fa3'
      }
    }).png().toBuffer()
    const commands: Array<PutObjectCommand | DeleteObjectCommand> = []
    const result = await uploadCmsImage({
      draftId,
      uploaderUserId: userId,
      isAdmin: true,
      lockLeaseId: leaseId,
      filename: '../截图[首页].png',
      mimeType: 'image/png',
      data: source,
      altText: '首页[截图]'
    }, {
      config: mediaConfig,
      storageClient: {
        send: async (command) => {
          commands.push(command)
          return {}
        }
      }
    })

    expect(commands).toHaveLength(1)
    expect(commands[0]).toBeInstanceOf(PutObjectCommand)
    const put = (commands[0] as PutObjectCommand).input
    expect(put).toMatchObject({
      Bucket: 'cms-test-bucket',
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable'
    })
    expect(put.Key).toMatch(
      new RegExp(`^articles/images/\\d{4}/\\d{2}/${draftId}/\\d{13}-[0-9a-f]{8}\\.webp$`)
    )
    expect(put.Key).not.toContain('截图')
    const output = Buffer.from(put.Body as Uint8Array)
    expect(await sharp(output).metadata()).toMatchObject({
      format: 'webp',
      width: 800,
      height: 450
    })

    expect(result.markdown).toBe(
      `![首页\\[截图\\]](${result.asset.url})`
    )
    expect(result.asset).toMatchObject({
      draftId,
      originalFilename: '.._截图[首页].png',
      originalMimeType: 'image/png',
      originalByteSize: source.length,
      width: 800,
      height: 450,
      byteSize: output.length
    })
    expect(result.asset.url).toMatch(
      new RegExp(`^https://images\\.test\\.example/assets/articles/images/\\d{4}/\\d{2}/${draftId}/`)
    )
    expect(JSON.stringify(result)).not.toContain(mediaConfig.S3_ACCESS_KEY_ID)
    expect(JSON.stringify(result)).not.toContain(mediaConfig.S3_SECRET_ACCESS_KEY)

    const rows = await getDatabase()
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.draftId, draftId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      uploaderUserId: userId,
      publicUrl: result.asset.url,
      originalMimeType: 'image/png',
      width: 800,
      height: 450
    })
  })

  it('按真实解码格式接受扩展名或浏览器 MIME 标错的主流图片', async () => {
    const source = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: '#336699'
      }
    }).jpeg().toBuffer()
    const commands: Array<PutObjectCommand | DeleteObjectCommand> = []
    const result = await uploadCmsImage({
      draftId,
      uploaderUserId: userId,
      isAdmin: true,
      lockLeaseId: leaseId,
      filename: 'downloaded-as-png.png',
      mimeType: 'image/png',
      data: source
    }, {
      config: mediaConfig,
      storageClient: {
        send: async (command) => {
          commands.push(command)
          return {}
        }
      }
    })

    expect(commands[0]).toBeInstanceOf(PutObjectCommand)
    expect(result.asset).toMatchObject({
      originalFilename: 'downloaded-as-png.png',
      originalMimeType: 'image/jpeg',
      width: 120,
      height: 80
    })
    expect(await sharp(
      Buffer.from((commands[0] as PutObjectCommand).input.Body as Uint8Array)
    ).metadata()).toMatchObject({ format: 'webp' })
  })

  it('将静态或动态 GIF 转为 WebP，并保留动画帧与延迟', async () => {
    const width = 40
    const frameHeight = 30
    const channels = 4
    const pixels = Buffer.alloc(width * frameHeight * 2 * channels)
    for (let index = 0; index < pixels.length; index += channels) {
      const firstFrame = index < pixels.length / 2
      pixels[index] = firstFrame ? 255 : 0
      pixels[index + 2] = firstFrame ? 0 : 255
      pixels[index + 3] = 255
    }
    const source = await sharp(pixels, {
      raw: {
        width,
        height: frameHeight * 2,
        channels,
        pageHeight: frameHeight
      }
    }).gif({ delay: [100, 240], loop: 0 }).toBuffer()
    const commands: Array<PutObjectCommand | DeleteObjectCommand> = []
    const result = await uploadCmsImage({
      draftId,
      uploaderUserId: userId,
      isAdmin: true,
      lockLeaseId: leaseId,
      filename: 'animated.gif',
      mimeType: 'image/gif',
      data: source
    }, {
      config: mediaConfig,
      storageClient: {
        send: async (command) => {
          commands.push(command)
          return {}
        }
      }
    })

    const outputMetadata = await sharp(
      Buffer.from((commands[0] as PutObjectCommand).input.Body as Uint8Array),
      { animated: true }
    ).metadata()
    expect(outputMetadata).toMatchObject({
      format: 'webp',
      width,
      height: frameHeight * 2,
      pageHeight: frameHeight,
      pages: 2,
      delay: [100, 240],
      loop: 0
    })
    expect(result.asset).toMatchObject({
      originalMimeType: 'image/gif',
      width,
      height: frameHeight
    })
  })

  it('拒绝不支持类型、损坏图片和超限文件，且不调用对象存储', async () => {
    const png = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: '#ffffff'
      }
    }).png().toBuffer()
    const tiff = await sharp(png).tiff().toBuffer()
    let storageCalls = 0
    const storageClient = {
      send: async () => {
        storageCalls += 1
        return {}
      }
    }
    const base = {
      draftId,
      uploaderUserId: userId,
      isAdmin: true,
      lockLeaseId: leaseId,
      filename: 'test.png'
    }

    await expect(uploadCmsImage({
      ...base,
      mimeType: 'application/octet-stream',
      data: png
    }, { config: mediaConfig, storageClient })).rejects.toMatchObject({
      code: 'IMAGE_TYPE_UNSUPPORTED'
    })
    await expect(uploadCmsImage({
      ...base,
      mimeType: 'image/png',
      data: tiff
    }, { config: mediaConfig, storageClient })).rejects.toMatchObject({
      code: 'IMAGE_TYPE_UNSUPPORTED'
    })
    await expect(uploadCmsImage({
      ...base,
      mimeType: 'image/png',
      data: Buffer.from('not an image')
    }, { config: mediaConfig, storageClient })).rejects.toMatchObject({
      code: 'IMAGE_INVALID'
    })
    await expect(uploadCmsImage({
      ...base,
      mimeType: 'image/png',
      data: Buffer.alloc(mediaConfig.CMS_IMAGE_MAX_BYTES + 1)
    }, { config: mediaConfig, storageClient })).rejects.toBeInstanceOf(
      CmsMediaValidationError
    )
    expect(storageCalls).toBe(0)
    expect(await getDatabase().select().from(mediaAssets)).toHaveLength(0)
  })

  it('对象存储失败时不写媒体记录，上传后租约失效时清理对象', async () => {
    const source = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: '#111111'
      }
    }).jpeg().toBuffer()
    const input = {
      draftId,
      uploaderUserId: userId,
      isAdmin: true,
      lockLeaseId: leaseId,
      filename: 'failure.jpg',
      mimeType: 'image/jpeg',
      data: source
    }

    await expect(uploadCmsImage(input, {
      config: mediaConfig,
      storageClient: {
        send: async () => {
          throw new Error('simulated provider failure')
        }
      }
    })).rejects.toBeInstanceOf(CmsMediaStorageError)
    expect(await getDatabase().select().from(mediaAssets)).toHaveLength(0)

    const commands: Array<PutObjectCommand | DeleteObjectCommand> = []
    await expect(uploadCmsImage(input, {
      config: mediaConfig,
      storageClient: {
        send: async (command) => {
          commands.push(command)
          if (command instanceof PutObjectCommand) {
            await getDatabase().delete(editLocks).where(eq(editLocks.leaseId, leaseId))
          }
          return {}
        }
      }
    })).rejects.toBeInstanceOf(CmsEditLockLostError)
    expect(commands[0]).toBeInstanceOf(PutObjectCommand)
    expect(commands[1]).toBeInstanceOf(DeleteObjectCommand)
    expect((commands[1] as DeleteObjectCommand).input.Key)
      .toBe((commands[0] as PutObjectCommand).input.Key)
    expect(await getDatabase().select().from(mediaAssets)).toHaveLength(0)
  })
})
