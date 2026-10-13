export interface MemberProfileFormModel {
  name: string
  isLearner?: boolean
  teacherDetails?: string | null
  grade: string
  groupName: string
  positions: string[]
  seasons: string[]
  advisorSeasons: string[]
  affiliation: string
  body: string
  links: {
    github: string
    'home-page': string
  }
}
