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
    const [publicPage, cmsPage, chart, galaxyBackground, chartStyles, cmsLayout] = await Promise.all([
      readFile('app/pages/team/organization.vue', 'utf8'),
      readFile('app/pages/cms/organization.vue', 'utf8'),
      readFile('app/components/OrganizationChart.vue', 'utf8'),
      readFile('app/components/OrganizationGalaxyBackground.vue', 'utf8'),
      readFile('app/assets/css/organization.css', 'utf8'),
      readFile('app/layouts/cms.vue', 'utf8')
    ])
    expect(publicPage).toContain('<OrganizationChart')
    expect(publicPage).toContain('<OrganizationGalaxyBackground')
    expect(cmsPage).toContain('<OrganizationChart')
    expect(cmsPage).toContain('保存草稿')
    expect(cmsPage).toContain('发布架构')
    expect(cmsPage).not.toMatch(/memberId|成员选择|赛季选择|历史架构/)
    expect(chart).toContain('organization-institution-system')
    expect(chart).toContain('organization-institution-satellites')
    expect(chart).toContain('organization-responsibility-satellite')
    expect(chart).toContain('institutionSystems')
    expect(chart).toContain('logo-e355a71c.webp')
    expect(chart).toContain('sponsors/EMIS.webp')
    expect(chart).toContain('sponsors/IRI_Lab.webp?v=20260813-transparent')
    expect(chart).toContain('selectedDepartmentId')
    expect(chart).toContain('selectedResponsibilityId')
    expect(chart).toContain('selectedRelationId')
    expect(chart).toContain('organization-department-focus')
    expect(chart).toContain('organization-responsibility-focus')
    expect(chart).toContain('organization-focus-moons')
    expect(chart).toContain('organization-relation-map')
    expect(chart).toContain('organization-relation-wire')
    expect(chart).toContain('relation-hitbox')
    expect(chart).toContain('relation-spark')
    expect(chart).toContain('data-organization-node-id')
    expect(chart).toContain('updateRelationGeometries')
    expect(chart).toContain('morphPhase')
    expect(chart).toContain('pointOnWave')
    expect(chart).toContain('organization-relation-focus')
    expect(chart).toContain('跨部门协同关系')
    expect(chart).toContain('当前未配置下级岗位')
    expect(chart).not.toContain('organization-institution-caption')
    expect(chart).not.toContain('structure.responsibilityNote')
    expect(chart).not.toContain('organization-starfield')
    expect(galaxyBackground).toContain('requestAnimationFrame')
    expect(galaxyBackground).toContain('ResizeObserver')
    expect(galaxyBackground).toContain("await import('ogl')")
    expect(galaxyBackground).toContain('NUM_LAYER 4.0')
    expect(galaxyBackground).toContain('uMouseRepulsion')
    expect(galaxyBackground).toContain('uMouseActiveFactor')
    expect(galaxyBackground).toContain('targetMouseActive = 0')
    expect(galaxyBackground).toContain('DESKTOP_FRAME_INTERVAL = 1000 / 120')
    expect(galaxyBackground).toContain('COARSE_POINTER_FRAME_INTERVAL = 1000 / 60')
    expect(galaxyBackground).toContain('dampingFactor(0.32, deltaMs)')
    expect(galaxyBackground).toContain('frameAccumulator %= targetInterval')
    expect(galaxyBackground).toContain('activityFollow')
    expect(galaxyBackground).toContain('uLightMode')
    expect(galaxyBackground).toContain('uGlowIntensity.value = darkMode ? 0.48 : 0.14')
    expect(galaxyBackground).toContain('fineDust + brightCore')
    expect(galaxyBackground).toContain('WEBGL_lose_context')
    expect(galaxyBackground).toContain("prefers-reduced-motion: reduce")
    expect(galaxyBackground).toContain("prefers-color-scheme: dark")
    expect(galaxyBackground).toContain("attributeFilter: ['data-theme']")
    expect(galaxyBackground).toContain('visibilitychange')
    expect(galaxyBackground).toContain('handlePointerMove')
    expect(galaxyBackground).not.toContain("from 'react'")
    expect(chartStyles).toContain('.organization-galaxy-background')
    expect(chartStyles).toContain('.organization-galaxy-background canvas')
    expect(chartStyles).toContain('@keyframes organization-institution-orbit')
    expect(chartStyles).toContain('@keyframes organization-local-satellite-orbit')
    expect(chartStyles).toContain('@keyframes organization-role-moons-orbit')
    expect(chartStyles).toContain('@keyframes organization-focus-role-orbit')
    expect(chartStyles).toContain('@keyframes organization-core-orbit')
    expect(chartStyles).toContain('@keyframes organization-lightning-flow')
    expect(chartStyles).toContain('@keyframes organization-relation-spark')
    expect(chartStyles).toContain('.organization-relation-layer { position: absolute; z-index: 2;')
    expect(chartStyles).toContain('rgba(202, 249, 211, 0.78)')
    expect(chartStyles).toContain('rgba(255, 240, 166, 0.96)')
    expect(chartStyles).toContain('.organization-inspector')
    expect(chartStyles).toContain(':root[data-theme="dark"] .organization-page')
    expect(chartStyles).toContain(':root[data-theme="light"] .organization-orbit-stage')
    expect(chartStyles).toContain(':root[data-theme="light"] .organization-orbit-lines')
    expect(chartStyles).toContain('stroke: rgba(12, 139, 180, 0.48)')
    expect(chartStyles).toContain('var(--system-accent) 44%')
    expect(chartStyles).toContain('animation-play-state: paused')
    expect(chartStyles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(chartStyles).toContain('.organization-constellation.is-compact .organization-institution-system')
    expect(cmsLayout).toContain("to: '/cms/organization'")
  })
})
