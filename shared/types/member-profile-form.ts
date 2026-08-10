export interface MemberProfileFormModel {
  name: string
  grade: string
  groupName: string
  positions: string[]
  seasons: string[]
  advisorSeasons: string[]
  affiliation: string
  body: string
  links: {
    github: string
    homepage: string
  }
}

