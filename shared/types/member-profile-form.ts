export interface MemberProfileFormModel {
  name: string
  isLearner?: boolean
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
