import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ORGANIZATION_STRUCTURE } from '../shared/types/organization'
import { validateOrganizationStructure } from '../server/services/organization'

describe('独立组织架构', () => {
  it('接受完整当前架构，且不包含成员或赛季关联字段', () => {
    const structure = validateOrganizationStructure(DEFAULT_ORGANIZATION_STRUCTURE)
    expect(structure.nodes.map(node => node.name)).toContain('软件算法组')
    expect(structure.nodes.filter(node => node.kind === 'institution').map(node => node.name)).toEqual([
      '机电创新学会 EMIS',
      'Vinci 机器人队',
      'IRI Lab 智能机器人创新实践基地'
    ])
    expect(structure.nodes.find(node => node.id === 'institution-iri')?.description).toBe('实验室')
    expect(structure.nodes.filter(node => node.kind === 'responsibility').map(node => node.name)).toEqual([
      '社团会长',
      '机器人队队长',
      '基地实验室负责人'
    ])
    expect(structure.responsibilityNote).toBe('通常由同一人兼任')
    expect(structure.relations[0]?.label).toBe('新闻部是运营组的人才孵化部门')
    expect(JSON.stringify(structure)).not.toMatch(/memberId|avatar|season/i)
  })

  it('拒绝重复节点、悬空父节点、断开的树和悬空关系', () => {
    const duplicate = structuredClone(DEFAULT_ORGANIZATION_STRUCTURE)
    duplicate.nodes.push({ ...duplicate.nodes[0]! })
    expect(() => validateOrganizationStructure(duplicate)).toThrow('ORGANIZATION_NODE_ID_DUPLICATE')

    const missingParent = structuredClone(DEFAULT_ORGANIZATION_STRUCTURE)
    missingParent.nodes[1]!.parentId = 'missing-node'
    expect(() => validateOrganizationStructure(missingParent)).toThrow('ORGANIZATION_PARENT_INVALID')

    const disconnected = structuredClone(DEFAULT_ORGANIZATION_STRUCTURE)
    disconnected.nodes[1]!.parentId = disconnected.nodes[2]!.id
    expect(() => validateOrganizationStructure(disconnected)).toThrow(/ORGANIZATION_/)

    const badRelation = structuredClone(DEFAULT_ORGANIZATION_STRUCTURE)
    badRelation.relations[0]!.toNodeId = 'missing-node'
    expect(() => validateOrganizationStructure(badRelation)).toThrow('ORGANIZATION_RELATION_TARGET_INVALID')

    const hiddenDepth = structuredClone(DEFAULT_ORGANIZATION_STRUCTURE)
    hiddenDepth.nodes.find(node => node.id === 'operations-leader')!.parentId = 'embedded-leader'
    expect(() => validateOrganizationStructure(hiddenDepth)).toThrow('ORGANIZATION_NODE_KIND_INVALID')
  })

  it('公开页和 CMS 只复用架构组件，不引入成员选择器或历史赛季', async () => {
    const [publicPage, cmsPage, chart, cmsLayout] = await Promise.all([
      readFile('app/pages/team/organization.vue', 'utf8'),
      readFile('app/pages/cms/organization.vue', 'utf8'),
      readFile('app/components/OrganizationChart.vue', 'utf8'),
      readFile('app/layouts/cms.vue', 'utf8')
    ])
    expect(publicPage).toContain('<OrganizationChart')
    expect(cmsPage).toContain('<OrganizationChart')
    expect(cmsPage).toContain('保存草稿')
    expect(cmsPage).toContain('发布架构')
    expect(cmsPage).not.toMatch(/memberId|成员选择|赛季选择|历史架构/)
    expect(chart).toContain('organization-institution')
    expect(chart).toContain("item.institution.id === 'institution-vinci'")
    expect(chart).toContain('organization-crosslinks')
    expect(cmsLayout).toContain("to: '/cms/organization'")
  })
})
