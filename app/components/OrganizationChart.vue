<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { OrganizationNode, OrganizationRelation, OrganizationStructure } from '../../shared/types/organization'

const props = defineProps<{ structure: OrganizationStructure, compact?: boolean }>()

type InstitutionSatellite = {
  node: OrganizationNode
  type: 'responsibility' | 'group'
  institution: OrganizationNode
  division?: OrganizationNode
}

type RelationGeometry = {
  path: string
  fromX: number
  fromY: number
  toX: number
  toY: number
}

const institutionLogos: Record<string, { src: string, alt: string, className: string }> = {
  'institution-emis': {
    src: 'https://cdn.sdutvincirobot.top/site-assets/images/sponsors/EMIS.webp',
    alt: '机电创新学会 EMIS 标志',
    className: 'is-emis'
  },
  'institution-vinci': {
    src: 'https://ccdn.tungchiahui.cn/site-assets/images/logo-e355a71c.webp',
    alt: 'Vinci 机器人队标志',
    className: 'is-vinci'
  },
  'institution-iri': {
    src: 'https://cdn.sdutvincirobot.top/site-assets/images/sponsors/IRI_Lab.webp?v=20260813-transparent',
    alt: 'IRI Lab 智能机器人创新实践基地标志',
    className: 'is-iri'
  }
}

const nodeMap = computed(() => new Map(props.structure.nodes.map(node => [node.id, node])))
const childrenOf = (id: string, kind?: OrganizationNode['kind']) => props.structure.nodes
  .filter(node => node.parentId === id && (!kind || node.kind === kind))
  .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'))

const root = computed(() => nodeMap.value.get(props.structure.rootNodeId))
const institutions = computed(() => childrenOf(props.structure.rootNodeId, 'institution'))
const extraInstitutions = computed(() => institutions.value.slice(3))
const groupsOf = (division: OrganizationNode) => childrenOf(division.id, 'group')
const rolesOf = (group: OrganizationNode) => childrenOf(group.id, 'role')
const institutionLogo = (id: string) => institutionLogos[id]

const institutionSystems = computed(() => institutions.value.slice(0, 3).map((institution, index) => {
  const divisions = childrenOf(institution.id, 'division')
  const satellites: InstitutionSatellite[] = [
    ...childrenOf(institution.id, 'responsibility').map(node => ({ node, type: 'responsibility' as const, institution })),
    ...divisions.flatMap(division => groupsOf(division).map(node => ({
      node,
      type: 'group' as const,
      institution,
      division
    })))
  ]
  return { institution, index, divisions, satellites }
}))

const extraDomains = computed(() => extraInstitutions.value
  .flatMap(institution => childrenOf(institution.id, 'division').map(division => ({ institution, division }))))

const groupSymbol = (group: OrganizationNode, index: number) => {
  const symbols: Record<string, string> = {
    顾问组: '◇',
    机械组: '×',
    嵌入式组: '▦',
    软件算法组: '</>',
    运营组: '▥'
  }
  return symbols[group.name] || String(index + 1).padStart(2, '0')
}

const relationDetails = (relation: OrganizationRelation) => ({
  from: nodeMap.value.get(relation.fromNodeId)?.name || relation.fromNodeId,
  to: nodeMap.value.get(relation.toNodeId)?.name || relation.toNodeId
})

const selectedDepartmentId = ref<string | null>(null)
const selectedResponsibilityId = ref<string | null>(null)
const selectedRelationId = ref<string | null>(null)
const selectedDepartment = computed(() => institutionSystems.value
  .flatMap(system => system.satellites)
  .find(item => item.type === 'group' && item.node.id === selectedDepartmentId.value) || null)
const selectedResponsibility = computed(() => institutionSystems.value
  .flatMap(system => system.satellites)
  .find(item => item.type === 'responsibility' && item.node.id === selectedResponsibilityId.value) || null)
const selectedRelation = computed(() => props.structure.relations.find(relation => relation.id === selectedRelationId.value) || null)
const organizationStage = ref<HTMLElement | null>(null)
const relationCanvas = ref({ width: 1, height: 1 })
const relationGeometries = ref<Record<string, RelationGeometry>>({})
let relationAnimationFrame: number | null = null
let lastRelationUpdate = 0

const institutionSystemStyle = (index: number) => ({
  '--institution-start': `${index / Math.max(institutionSystems.value.length, 1) * 100}%`,
  '--institution-delay': '0s'
} as CSSProperties)

const satelliteOrbitStyle = (index: number, total: number, type: InstitutionSatellite['type']) => ({
  '--satellite-start': `${total ? index / total * 100 : 0}%`,
  '--satellite-delay': '0s',
  '--satellite-size': type === 'responsibility' ? '96px' : '86px'
} as CSSProperties)

const roleOrbitStyle = (index: number, total: number) => ({
  '--role-start': `${total ? index / total * 100 : 0}%`,
  '--role-delay': '0s'
} as CSSProperties)

const selectDepartment = (id: string) => {
  selectedRelationId.value = null
  selectedResponsibilityId.value = null
  selectedDepartmentId.value = id
}

const selectResponsibility = (id: string) => {
  selectedRelationId.value = null
  selectedDepartmentId.value = null
  selectedResponsibilityId.value = id
}

const selectRelation = (id: string) => {
  selectedDepartmentId.value = null
  selectedResponsibilityId.value = null
  selectedRelationId.value = id
}

const closeInspector = () => {
  selectedDepartmentId.value = null
  selectedResponsibilityId.value = null
  selectedRelationId.value = null
}

let prefersReducedMotion = false

const updateRelationGeometries = (timestamp = 0) => {
  const stage = organizationStage.value
  if (!stage) return

  const stageRect = stage.getBoundingClientRect()
  const nodeElements = Array.from(stage.querySelectorAll<HTMLElement>('[data-organization-node-id]'))
  const elementByNodeId = new Map(nodeElements.map(element => [element.dataset.organizationNodeId, element]))
  const nextGeometries: Record<string, RelationGeometry> = {}

  for (const [relationIndex, relation] of props.structure.relations.entries()) {
    const fromElement = elementByNodeId.get(relation.fromNodeId)
    const toElement = elementByNodeId.get(relation.toNodeId)
    if (!fromElement || !toElement) continue

    const fromRect = fromElement.getBoundingClientRect()
    const toRect = toElement.getBoundingClientRect()
    const fromX = fromRect.left - stageRect.left + fromRect.width / 2
    const fromY = fromRect.top - stageRect.top + fromRect.height / 2
    const toX = toRect.left - stageRect.left + toRect.width / 2
    const toY = toRect.top - stageRect.top + toRect.height / 2
    const middleX = (fromX + toX) / 2
    const middleY = (fromY + toY) / 2
    const distance = Math.hypot(toX - fromX, toY - fromY)
    const directionX = (toX - fromX) / (distance || 1)
    const directionY = (toY - fromY) / (distance || 1)
    const normalX = -directionY
    const normalY = directionX
    const morphPhase = prefersReducedMotion ? 0 : timestamp / 520 + relationIndex * 1.7
    const bend = Math.min(190, Math.max(82, distance * 0.26))
    const coreX = stageRect.width / 2
    const coreY = stageRect.height / 2
    const positiveDistance = Math.hypot(middleX + normalX * bend - coreX, middleY + normalY * bend - coreY)
    const negativeDistance = Math.hypot(middleX - normalX * bend - coreX, middleY - normalY * bend - coreY)
    const outwardSign = positiveDistance >= negativeDistance ? 1 : -1
    const rounded = (value: number) => Math.round(value * 10) / 10
    const morphAmplitude = prefersReducedMotion ? 0 : Math.min(54, Math.max(28, distance * 0.075))
    const pointOnWave = (progress: number, baseScale: number, phaseOffset: number) => {
      const normalOffset = (bend * baseScale + Math.sin(morphPhase + phaseOffset) * morphAmplitude) * outwardSign
      return {
        x: fromX + (toX - fromX) * progress + normalX * normalOffset,
        y: fromY + (toY - fromY) * progress + normalY * normalOffset
      }
    }
    const points = [
      { x: fromX, y: fromY },
      pointOnWave(0.24, 0.72, 0),
      pointOnWave(0.5, 1.08, 2.1),
      pointOnWave(0.76, 0.78, 4.2),
      { x: toX, y: toY }
    ]
    const curveSegments: string[] = []
    for (let index = 0; index < points.length - 1; index++) {
      const previous = points[index - 1] || points[index]!
      const current = points[index]!
      const next = points[index + 1]!
      const afterNext = points[index + 2] || next
      const controlOne = {
        x: current.x + (next.x - previous.x) / 6,
        y: current.y + (next.y - previous.y) / 6
      }
      const controlTwo = {
        x: next.x - (afterNext.x - current.x) / 6,
        y: next.y - (afterNext.y - current.y) / 6
      }
      curveSegments.push(`C ${rounded(controlOne.x)} ${rounded(controlOne.y)} ${rounded(controlTwo.x)} ${rounded(controlTwo.y)} ${rounded(next.x)} ${rounded(next.y)}`)
    }

    nextGeometries[relation.id] = {
      path: `M ${rounded(fromX)} ${rounded(fromY)} ${curveSegments.join(' ')}`,
      fromX: rounded(fromX),
      fromY: rounded(fromY),
      toX: rounded(toX),
      toY: rounded(toY)
    }
  }

  relationCanvas.value = { width: Math.max(1, stageRect.width), height: Math.max(1, stageRect.height) }
  relationGeometries.value = nextGeometries
}

const syncRelationGeometries = (timestamp: number) => {
  if (timestamp - lastRelationUpdate >= 32) {
    updateRelationGeometries(timestamp)
    lastRelationUpdate = timestamp
  }
  relationAnimationFrame = requestAnimationFrame(syncRelationGeometries)
}

onMounted(() => {
  prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  relationAnimationFrame = requestAnimationFrame(syncRelationGeometries)
})

onBeforeUnmount(() => {
  if (relationAnimationFrame !== null) cancelAnimationFrame(relationAnimationFrame)
})
</script>

<template>
  <section class="organization-chart organization-constellation" :class="{ 'is-compact': compact }" aria-label="组织架构图">
    <div ref="organizationStage" class="organization-orbit-stage" tabindex="-1" @keydown.esc="closeInspector">
      <svg class="organization-orbit-lines" viewBox="0 0 1160 920" aria-hidden="true" preserveAspectRatio="none">
        <ellipse class="orbit-outer" cx="580" cy="450" rx="500" ry="368" />
        <ellipse class="orbit-middle" cx="580" cy="450" rx="390" ry="278" />
        <ellipse class="orbit-inner" cx="580" cy="450" rx="184" ry="122" />
        <ellipse class="orbit-signal" cx="580" cy="450" rx="286" ry="196" />
      </svg>

      <div class="organization-collaboration-hub">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <ellipse cx="24" cy="24" rx="19" ry="7.5" />
          <ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(60 24 24)" />
          <ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(-60 24 24)" />
          <circle class="organization-core-center" cx="24" cy="24" r="4.4" />
          <circle class="organization-core-node" cx="43" cy="24" r="2.6" />
          <circle class="organization-core-node" cx="14.5" cy="40.45" r="2.6" />
          <circle class="organization-core-node" cx="14.5" cy="7.55" r="2.6" />
        </svg>
        <strong>{{ root?.name || '协同运行' }}</strong>
      </div>

      <section class="organization-institution-galaxy" aria-label="机构与所属部门轨道">
        <article
          v-for="system in institutionSystems"
          :key="system.institution.id"
          class="organization-institution-system"
          :class="[
            `institution-system-${system.index + 1}`,
            institutionLogo(system.institution.id)?.className,
            { 'has-selected-satellite': selectedDepartment?.institution.id === system.institution.id || selectedResponsibility?.institution.id === system.institution.id }
          ]"
          :style="institutionSystemStyle(system.index)"
        >
          <div class="organization-local-orbits" aria-hidden="true"><i /><i /></div>

          <div class="organization-institution-planet">
            <span class="organization-institution-logo-tray">
              <img
                v-if="institutionLogo(system.institution.id)"
                class="organization-institution-logo"
                :class="institutionLogo(system.institution.id)!.className"
                :src="institutionLogo(system.institution.id)!.src"
                :alt="institutionLogo(system.institution.id)!.alt"
                decoding="async"
              >
              <span v-else class="organization-institution-mark" aria-hidden="true">{{ system.institution.name.slice(0, 1) }}</span>
            </span>
            <strong>{{ system.institution.name }}</strong>
            <small v-if="system.institution.description">{{ system.institution.description }}</small>
          </div>

          <div class="organization-institution-satellites">
            <div
              v-for="(satellite, satelliteIndex) in system.satellites"
              :key="satellite.node.id"
              class="organization-institution-satellite"
              :class="[
                satellite.type === 'responsibility' ? 'organization-responsibility-satellite' : 'organization-department-satellite',
                { 'is-selected': selectedDepartmentId === satellite.node.id || selectedResponsibilityId === satellite.node.id }
              ]"
              :style="satelliteOrbitStyle(satelliteIndex, system.satellites.length, satellite.type)"
              :data-organization-node-id="satellite.node.id"
            >
              <button
                v-if="satellite.type === 'responsibility'"
                type="button"
                class="organization-responsibility-planet"
                :aria-expanded="selectedResponsibilityId === satellite.node.id"
                aria-controls="organization-responsibility-focus"
                @click="selectResponsibility(satellite.node.id)"
              >
                <span aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.5-4.2 2.7-6.3 6.5-6.3s6 2.1 6.5 6.3" /></svg>
                </span>
                <strong>{{ satellite.node.name }}</strong>
              </button>
              <button
                v-else
                type="button"
                class="organization-department-planet"
                :aria-expanded="selectedDepartmentId === satellite.node.id"
                aria-controls="organization-department-focus"
                @click="selectDepartment(satellite.node.id)"
              >
                <span aria-hidden="true">{{ groupSymbol(satellite.node, satelliteIndex) }}</span>
                <strong>{{ satellite.node.name }}</strong>
              </button>
              <ul
                v-if="satellite.type === 'group' && rolesOf(satellite.node).length"
                class="organization-satellite-role-dots"
                aria-hidden="true"
              >
                <li
                  v-for="(role, roleIndex) in rolesOf(satellite.node)"
                  :key="role.id"
                  :style="roleOrbitStyle(roleIndex, rolesOf(satellite.node).length)"
                ><i /></li>
              </ul>
            </div>
          </div>

        </article>
      </section>

      <aside v-if="structure.relations.length" class="organization-relation-layer" aria-label="跨部门关系">
        <svg
          class="organization-relation-map"
          :viewBox="`0 0 ${relationCanvas.width} ${relationCanvas.height}`"
          preserveAspectRatio="none"
        >
          <g
            v-for="relation in structure.relations"
            :key="relation.id"
            class="organization-relation-wire"
            :class="{ 'is-active': selectedRelationId === relation.id }"
          >
            <template v-if="relationGeometries[relation.id]">
              <path class="relation-glow" :d="relationGeometries[relation.id]!.path" />
              <path class="relation-halo" :d="relationGeometries[relation.id]!.path" />
              <path class="relation-line" :d="relationGeometries[relation.id]!.path" />
              <path class="relation-spark" :d="relationGeometries[relation.id]!.path" />
              <circle
                class="relation-endpoint"
                :cx="relationGeometries[relation.id]!.fromX"
                :cy="relationGeometries[relation.id]!.fromY"
                r="3"
              />
              <circle
                class="relation-endpoint"
                :cx="relationGeometries[relation.id]!.toX"
                :cy="relationGeometries[relation.id]!.toY"
                r="3"
              />
              <path
                class="relation-hitbox"
                :d="relationGeometries[relation.id]!.path"
                role="button"
                tabindex="0"
                :aria-label="`查看${relationDetails(relation).from}与${relationDetails(relation).to}的关系`"
                :aria-expanded="selectedRelationId === relation.id"
                aria-controls="organization-relation-focus"
                @click="selectRelation(relation.id)"
                @keydown.enter="selectRelation(relation.id)"
                @keydown.space.prevent="selectRelation(relation.id)"
              >
                <title>点击查看跨部门关系</title>
              </path>
            </template>
          </g>
        </svg>
        <button
          v-for="relation in structure.relations"
          :key="`${relation.id}-mobile`"
          type="button"
          class="organization-relation-mobile-trigger"
          @click="selectRelation(relation.id)"
        >
          <span aria-hidden="true">ϟ</span>查看跨部门关系
        </button>
      </aside>

      <Transition name="organization-focus">
        <section
          v-if="selectedDepartment"
          id="organization-department-focus"
          class="organization-inspector organization-department-focus"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`${selectedDepartment.node.id}-focus-title`"
        >
          <button type="button" class="organization-focus-close" aria-label="关闭部门聚焦" @click="closeInspector">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <header>
            <small>{{ selectedDepartment.institution.name }} · {{ selectedDepartment.division?.name }}</small>
            <h2 :id="`${selectedDepartment.node.id}-focus-title`">{{ selectedDepartment.node.name }}</h2>
            <p>点击部门后展开的岗位卫星系统</p>
          </header>
          <div class="organization-focus-system">
            <div class="organization-focus-orbit" aria-hidden="true"><i /><i /></div>
            <div class="organization-focus-planet">
              <span aria-hidden="true">{{ groupSymbol(selectedDepartment.node, 0) }}</span>
              <strong>{{ selectedDepartment.node.name }}</strong>
            </div>
            <ul v-if="rolesOf(selectedDepartment.node).length" class="organization-focus-moons">
              <li
                v-for="(role, index) in rolesOf(selectedDepartment.node)"
                :key="role.id"
                :style="roleOrbitStyle(index, rolesOf(selectedDepartment.node).length)"
              >
                <i aria-hidden="true" /><strong>{{ role.name }}</strong>
              </li>
            </ul>
            <p v-else class="organization-focus-empty">当前未配置下级岗位</p>
          </div>
        </section>
      </Transition>

      <Transition name="organization-focus">
        <section
          v-if="selectedResponsibility"
          id="organization-responsibility-focus"
          class="organization-inspector organization-responsibility-focus"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`${selectedResponsibility.node.id}-focus-title`"
        >
          <button type="button" class="organization-focus-close" aria-label="关闭负责人聚焦" @click="closeInspector">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <header>
            <small>{{ selectedResponsibility.institution.name }}</small>
            <h2 :id="`${selectedResponsibility.node.id}-focus-title`">{{ selectedResponsibility.node.name }}</h2>
            <p>机构负责人职责节点</p>
          </header>
          <div class="organization-focus-system organization-responsibility-focus-system">
            <div class="organization-focus-orbit" aria-hidden="true"><i /><i /></div>
            <div class="organization-focus-planet organization-focus-responsibility">
              <span aria-hidden="true">◎</span>
              <strong>{{ selectedResponsibility.node.name }}</strong>
            </div>
            <p class="organization-focus-empty">{{ selectedResponsibility.node.description || `${selectedResponsibility.institution.name}的负责人职责` }}</p>
          </div>
        </section>
      </Transition>

      <Transition name="organization-focus">
        <section
          v-if="selectedRelation"
          id="organization-relation-focus"
          class="organization-inspector organization-relation-focus"
          role="dialog"
          aria-modal="true"
          aria-labelledby="organization-relation-title"
        >
          <button type="button" class="organization-focus-close" aria-label="关闭关系说明" @click="closeInspector">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <header>
            <small>CROSS-DEPARTMENT LINK</small>
            <h2 id="organization-relation-title">跨部门协同关系</h2>
            <p>这条闪电链路表达两个组织节点之间的特殊关系。</p>
          </header>
          <div class="organization-relation-detail">
            <div><small>FROM</small><strong>{{ relationDetails(selectedRelation).from }}</strong></div>
            <span aria-hidden="true">ϟ</span>
            <div><small>TO</small><strong>{{ relationDetails(selectedRelation).to }}</strong></div>
          </div>
          <p class="organization-relation-description">{{ selectedRelation.label }}</p>
        </section>
      </Transition>
    </div>

    <section v-for="item in extraDomains" :key="item.division.id" class="organization-extra-domain">
      <header><small>{{ item.institution.name }}</small><h2>{{ item.division.name }}</h2></header>
      <div>
        <article v-for="group in groupsOf(item.division)" :key="group.id">
          <strong>{{ group.name }}</strong>
          <span v-for="role in rolesOf(group)" :key="role.id">{{ role.name }}</span>
        </article>
      </div>
    </section>

    <section v-if="extraInstitutions.length" class="organization-extra-institutions" aria-label="其他机构">
      <header><small>EXTENDED STRUCTURE</small><h2>其他机构</h2></header>
      <div>
        <article v-for="institution in extraInstitutions" :key="institution.id">
          <strong>{{ institution.name }}</strong>
          <span v-if="institution.description">{{ institution.description }}</span>
          <small v-for="responsibility in childrenOf(institution.id, 'responsibility')" :key="responsibility.id">{{ responsibility.name }}</small>
        </article>
      </div>
    </section>
  </section>
</template>
