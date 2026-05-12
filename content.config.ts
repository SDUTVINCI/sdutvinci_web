import { defineCollection, defineContentConfig, z } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    members: defineCollection({
      type: 'page',
      source: 'members/**/*.md',
      schema: z.object({
        title: z.string(),
        image: z.string().optional(),
        role: z.string().nullable().optional(),
        type: z.string().nullable().optional(),
        time: z.union([z.string(), z.number()]).nullable().optional(),
        advisor: z.union([z.string(), z.number()]).nullable().optional(),
        grade: z.union([z.string(), z.number()]).nullable().optional(),
        affiliation: z.string().nullable().optional(),
        links: z.record(z.string(), z.string()).nullable().optional()
      }).passthrough()
    })
  }
})
