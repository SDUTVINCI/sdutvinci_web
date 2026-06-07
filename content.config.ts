import { defineCollection, defineContentConfig, z } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    members: defineCollection({
      type: 'page',
      source: 'members/**/*.md',
      schema: z.object({
        name: z.string(),
        image: z.string().optional(),
        role: z.string().nullable().optional(),
        type: z.string().nullable().optional(),
        time: z.union([z.string(), z.number()]).nullable().optional(),
        advisor: z.union([z.string(), z.number()]).nullable().optional(),
        grade: z.union([z.string(), z.number()]).nullable().optional(),
        affiliation: z.string().nullable().optional(),
        links: z.record(z.string(), z.string()).nullable().optional()
      }).passthrough()
    }),
    news: defineCollection({
      type: 'page',
      source: 'news/**/*.md',
      schema: z.object({
        title: z.string(),
        date: z.string().optional(),
        author: z.string().nullable().optional(),
        tags: z.array(z.string()).nullable().optional(),
        image: z.string().nullable().optional(),
        bvid: z.string().nullable().optional(),
        summary: z.string().nullable().optional()
      }).passthrough()
    }),
    wiki: defineCollection({
      type: 'page',
      source: 'wiki/**/*.md',
      schema: z.object({
        title: z.string(),
        date: z.string().nullable().optional(),
        chapterOrder: z.string().nullable().optional(),
        chapterDepth: z.number().nullable().optional(),
        docKey: z.string().nullable().optional(),
        docRoot: z.string().nullable().optional(),
        docTitle: z.string().nullable().optional(),
        isWikiDoc: z.boolean().nullable().optional(),
        isWikiIndex: z.boolean().nullable().optional(),
        wikiDepth: z.number().nullable().optional()
      }).passthrough()
    })
  }
})
