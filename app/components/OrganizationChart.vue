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
const selectedRelationId = ref<string | null>(null)
const selectedDepartment = computed(() => institutionSystems.value
  .flatMap(system => system.satellites)
  .find(item => item.type === 'group' && item.node.id === selectedDepartmentId.value) || null)
const selectedRelation = computed(() => props.structure.relations.find(relation => relation.id === selectedRelationId.value) || null)

const institutionSystemStyle = (index: number) => ({
  '--institution-start': `${index / Math.max(institutionSystems.value.length, 1) * 100}%`,
  '--institution-delay': `${index * -1.7}s`
} as CSSProperties)

const satelliteOrbitStyle = (index: number, total: number, type: InstitutionSatellite['type']) => ({
  '--satellite-start': `${total ? index / total * 100 : 0}%`,
  '--satellite-delay': `${index * -0.7}s`,
  '--satellite-size': type === 'responsibility' ? '70px' : '62px'
} as CSSProperties)

const roleOrbitStyle = (index: number, total: number) => ({
  '--role-start': `${total ? index / total * 100 : 0}%`,
  '--role-delay': `${index * -1.1}s`
} as CSSProperties)

const selectDepartment = (id: string) => {
  selectedRelationId.value = null
  selectedDepartmentId.value = id
}

const selectRelation = (id: string) => {
  selectedDepartmentId.value = null
  selectedRelationId.value = id
}

const closeInspector = () => {
  selectedDepartmentId.value = null
  selectedRelationId.value = null
}
</script>

<template>
  <section class="organization-chart organization-constellation" :class="{ 'is-compact': compact }" aria-label="组织架构图">
    <div class="organization-orbit-stage" tabindex="-1" @keydown.esc="closeInspector">
      <div class="organization-starfield" aria-hidden="true">
        <span v-for="index in 18" :key="index" />
      </div>

      <svg class="organization-orbit-lines" viewBox="0 0 1160 820" aria-hidden="true" preserveAspectRatio="none">
        <ellipse class="orbit-outer" cx="580" cy="405" rx="485" ry="322" />
        <ellipse class="orbit-middle" cx="580" cy="405" rx="372" ry="242" />
        <ellipse class="orbit-inner" cx="580" cy="405" rx="158" ry="104" />
        <ellipse class="orbit-signal" cx="580" cy="405" rx="268" ry="178" />
        <path class="orbit-comet" d="M110 515 C270 765 876 790 1050 500" />
      </svg>

      <div class="organization-collaboration-hub">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 2.8c.8 7.8 5.4 12.4 13.2 13.2C21.4 16.8 16.8 21.4 16 29.2 15.2 21.4 10.6 16.8 2.8 16 10.6 15.2 15.2 10.6 16 2.8Z" />
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
            { 'has-selected-satellite': selectedDepartment?.institution.id === system.institution.id }
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
                { 'is-selected': selectedDepartmentId === satellite.node.id }
              ]"
              :style="satelliteOrbitStyle(satelliteIndex, system.satellites.length, satellite.type)"
            >
              <div v-if="satellite.type === 'responsibility'" class="organization-responsibility-planet">
                <span aria-hidden="true">
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.5-4.2 2.7-6.3 6.5-6.3s6 2.1 6.5 6.3" /></svg>
                </span>
                <strong>{{ satellite.node.name }}</strong>
              </div>
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

          <p v-if="system.divisions[0]" class="organization-institution-caption">{{ system.divisions[0].name }}</p>
        </article>
      </section>

      <p class="organization-responsibility-note">{{ structure.responsibilityNote }}</p>

      <aside v-if="structure.relations.length" class="organization-relation-layer" aria-label="跨部门关系">
        <div v-for="(relation, index) in structure.relations" :key="relation.id" class="organization-relation-wire">
          <svg viewBox="0 0 560 180" aria-hidden="true" preserveAspectRatio="none">
            <path class="relation-glow" d="M10 160 C125 25 395 18 550 146" />
            <path class="relation-bolt" d="M10 160 C125 25 395 18 550 146" />
          </svg>
          <button
            type="button"
            class="organization-relation-trigger"
            :style="{ '--relation-index': index }"
            :aria-expanded="selectedRelationId === relation.id"
            aria-controls="organization-relation-focus"
            @click="selectRelation(relation.id)"
          >
            <i aria-hidden="true">ϟ</i><span>{{ relation.label }}</span>
          </button>
        </div>
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
