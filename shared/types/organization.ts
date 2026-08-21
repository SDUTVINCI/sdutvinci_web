export const ORGANIZATION_NODE_KINDS = ['organization', 'institution', 'responsibility', 'division', 'group', 'role'] as const
export type OrganizationNodeKind = typeof ORGANIZATION_NODE_KINDS[number]

export interface OrganizationNode {
  id: string
  parentId: string | null
  kind: OrganizationNodeKind
  name: string
  description: string
  sortOrder: number
}

export interface OrganizationRelation {
  id: string
  fromNodeId: string
  toNodeId: string
  label: string
}

export interface OrganizationStructure {
  title: string
  description: string
  responsibilityNote: string
  rootNodeId: string
  nodes: OrganizationNode[]
  relations: OrganizationRelation[]
}

export interface PublicOrganizationResponse {
  structure: OrganizationStructure
  publishedAt: string
  publishedVersion: number
}

export interface CmsOrganizationResponse extends PublicOrganizationResponse {
  draft: OrganizationStructure
  version: number
  hasUnpublishedChanges: boolean
  updatedAt: string
}

export const DEFAULT_ORGANIZATION_STRUCTURE: OrganizationStructure = {
  title: '当前组织架构',
  description: '仅展示当前架构，不关联具体成员资料。',
  responsibilityNote: '通常由同一人兼任',
  rootNodeId: 'vinci-alliance',
  nodes: [
    { id: 'vinci-alliance', parentId: null, kind: 'organization', name: '协同运行', description: '', sortOrder: 0 },
    { id: 'institution-emis', parentId: 'vinci-alliance', kind: 'institution', name: '机电创新学会 EMIS', description: '社团主体', sortOrder: 0 },
    { id: 'society-president', parentId: 'institution-emis', kind: 'responsibility', name: '社团会长', description: '', sortOrder: 0 },
    { id: 'association-division', parentId: 'institution-emis', kind: 'division', name: '社团其他部门', description: '', sortOrder: 1 },
    { id: 'league-branch', parentId: 'association-division', kind: 'group', name: '团支部', description: '', sortOrder: 0 },
    { id: 'membership-department', parentId: 'association-division', kind: 'group', name: '会员管理部', description: '', sortOrder: 1 },
    { id: 'liaison-department', parentId: 'association-division', kind: 'group', name: '联络部', description: '', sortOrder: 2 },
    { id: 'news-department', parentId: 'association-division', kind: 'group', name: '新闻部（运营部）', description: '', sortOrder: 3 },
    { id: 'institution-vinci', parentId: 'vinci-alliance', kind: 'institution', name: 'Vinci 机器人队', description: '竞赛与研发团队', sortOrder: 1 },
    { id: 'team-captain', parentId: 'institution-vinci', kind: 'responsibility', name: '机器人队队长', description: '', sortOrder: 0 },
    { id: 'technical-division', parentId: 'institution-vinci', kind: 'division', name: 'Vinci 机器人队部门（社团技术部）', description: '', sortOrder: 1 },
    { id: 'advisor-group', parentId: 'technical-division', kind: 'group', name: '顾问组', description: '', sortOrder: 0 },
    { id: 'advisor-junior', parentId: 'advisor-group', kind: 'role', name: '大三退休学长', description: '', sortOrder: 0 },
    { id: 'advisor-senior', parentId: 'advisor-group', kind: 'role', name: '大四退休学长', description: '', sortOrder: 1 },
    { id: 'advisor-graduate', parentId: 'advisor-group', kind: 'role', name: '毕业退休学长', description: '', sortOrder: 2 },
    { id: 'mechanical-group', parentId: 'technical-division', kind: 'group', name: '机械组', description: '', sortOrder: 1 },
    { id: 'mechanical-leader', parentId: 'mechanical-group', kind: 'role', name: '机械组组长', description: '', sortOrder: 0 },
    { id: 'mechanical-one', parentId: 'mechanical-group', kind: 'role', name: '机械1组', description: '', sortOrder: 1 },
    { id: 'mechanical-two', parentId: 'mechanical-group', kind: 'role', name: '机械2组', description: '', sortOrder: 2 },
    { id: 'embedded-group', parentId: 'technical-division', kind: 'group', name: '嵌入式组', description: '', sortOrder: 2 },
    { id: 'embedded-leader', parentId: 'embedded-group', kind: 'role', name: '嵌入式组组长', description: '', sortOrder: 0 },
    { id: 'software-group', parentId: 'technical-division', kind: 'group', name: '软件算法组', description: '', sortOrder: 3 },
    { id: 'software-leader', parentId: 'software-group', kind: 'role', name: '软件算法组组长', description: '', sortOrder: 0 },
    { id: 'operations-group', parentId: 'technical-division', kind: 'group', name: '运营组', description: '', sortOrder: 4 },
    { id: 'operations-leader', parentId: 'operations-group', kind: 'role', name: '运营组组长', description: '', sortOrder: 0 },
    { id: 'institution-iri', parentId: 'vinci-alliance', kind: 'institution', name: 'IRI Lab 智能机器人创新实践基地', description: '实验室', sortOrder: 2 },
    { id: 'laboratory-director', parentId: 'institution-iri', kind: 'responsibility', name: '基地实验室负责人', description: '', sortOrder: 0 }
  ],
  relations: [
    { id: 'news-incubates-operations', fromNodeId: 'news-department', toNodeId: 'operations-group', label: '新闻部是运营组的人才孵化部门' }
  ]
}
