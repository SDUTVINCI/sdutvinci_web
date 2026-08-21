<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { OrganizationNode, OrganizationRelation, OrganizationStructure } from '../../shared/types/organization'

const props = defineProps<{
  structure: OrganizationStructure
  compact?: boolean
}>()

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
const responsibilities = computed(() => institutions.value
  .map(institution => ({ institution, responsibility: childrenOf(institution.id, 'responsibility')[0] }))
  .filter(item => item.responsibility)
  .sort((a, b) => {
    const priority = new Map([['institution-emis', 0], ['institution-vinci', 1], ['institution-iri', 2]])
    return (priority.get(a.institution.id) ?? 99) - (priority.get(b.institution.id) ?? 99)
      || a.institution.sortOrder - b.institution.sortOrder
  }))
const domains = computed(() => institutions.value
  .flatMap(institution => childrenOf(institution.id, 'division').map(division => ({ institution, division })))
  .sort((a, b) => b.institution.sortOrder - a.institution.sortOrder || a.division.sortOrder - b.division.sortOrder))
const primaryDomains = computed(() => domains.value.slice(0, 2))
const extraDomains = computed(() => domains.value.slice(2))

const groupsOf = (division: OrganizationNode) => childrenOf(division.id, 'group')
const rolesOf = (group: OrganizationNode) => childrenOf(group.id, 'role')
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

const institutionLogo = (id: string) => institutionLogos[id]

const departmentSystems = computed(() => primaryDomains.value.flatMap((item, domainIndex) =>
  groupsOf(item.division).map(group => ({ ...item, group, domainIndex }))
))
const selectedDepartmentId = ref<string | null>(null)
const selectedDepartment = computed(() => departmentSystems.value.find(item => item.group.id === selectedDepartmentId.value) || null)

const departmentOrbitStyle = (index: number, total: number) => ({
  '--department-start': `${total ? index / total * 100 : 0}%`,
  '--department-delay': `${index * -0.55}s`
} as CSSProperties)

const roleMoonStyle = (index: number, total: number) => {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index / Math.max(total, 1))
  const x = 50 + Math.cos(angle) * 46
  const y = 50 + Math.sin(angle) * 46
  return {
    '--moon-x': `${x}%`,
    '--moon-y': `${y}%`,
    '--moon-delay': `${index * -0.4}s`
  } as CSSProperties
}

const closeDepartmentFocus = () => { selectedDepartmentId.value = null }
</script>

<template>
  <section class="organization-chart organization-constellation" :class="{ 'is-compact': compact }" aria-label="组织架构图">
    <div class="organization-orbit-stage" @keydown.esc="closeDepartmentFocus">
      <div class="organization-starfield" aria-hidden="true">
        <span v-for="index in 14" :key="index" />
      </div>

      <svg class="organization-orbit-lines" viewBox="0 0 1160 760" aria-hidden="true" preserveAspectRatio="none">
        <ellipse class="orbit-outer" cx="580" cy="350" rx="520" ry="310" />
        <ellipse class="orbit-middle" cx="580" cy="338" rx="410" ry="252" />
        <ellipse class="orbit-inner" cx="580" cy="310" rx="275" ry="176" />
        <ellipse class="orbit-signal" cx="580" cy="310" rx="214" ry="132" />
        <path class="orbit-left-rail" d="M430 172 C300 186 212 264 178 380 C151 475 180 565 310 634" />
        <path class="orbit-right-rail" d="M730 172 C860 186 948 264 982 380 C1009 475 980 565 850 634" />
        <path class="orbit-comet" d="M308 618 C430 735 738 735 858 618" />
        <path class="orbit-axis" d="M580 80 V136 M580 484 V650" />
      </svg>

      <section
        v-for="(item, index) in primaryDomains"
        :key="item.division.id"
        class="organization-domain-label"
        :class="index === 0 ? 'is-left' : 'is-right'"
        :aria-labelledby="`${item.division.id}-title`"
      >
        <header>
          <small>{{ item.institution.name }}</small>
          <h2 :id="`${item.division.id}-title`">{{ item.division.name }}</h2>
        </header>
      </section>

      <section class="organization-core" aria-label="协同机构与负责人职责">
        <div class="organization-core-constellation">
          <div class="organization-institution-orbit">
            <article
              v-for="(institution, index) in institutions.slice(0, 3)"
              :key="institution.id"
              class="organization-institution"
              :class="[`institution-${index + 1}`, institutionLogo(institution.id)?.className]"
              tabindex="0"
            >
              <span class="organization-institution-logo-tray">
                <img
                  v-if="institutionLogo(institution.id)"
                  class="organization-institution-logo"
                  :class="institutionLogo(institution.id)!.className"
                  :src="institutionLogo(institution.id)!.src"
                  :alt="institutionLogo(institution.id)!.alt"
                  decoding="async"
                >
                <span v-else class="organization-institution-mark" aria-hidden="true">
                  {{ institution.name.slice(0, 1) }}
                </span>
              </span>
              <strong>{{ institution.name }}</strong>
              <small v-if="institution.description">{{ institution.description }}</small>
            </article>
          </div>

          <div class="organization-collaboration-hub">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M16 2.8c.8 7.8 5.4 12.4 13.2 13.2C21.4 16.8 16.8 21.4 16 29.2 15.2 21.4 10.6 16.8 2.8 16 10.6 15.2 15.2 10.6 16 2.8Z" />
            </svg>
            <strong>{{ root?.name || '协同运行' }}</strong>
          </div>

          <div class="organization-responsibilities">
            <article
              v-for="(item, index) in responsibilities.slice(0, 3)"
              :key="item.responsibility!.id"
              :class="[
                `responsibility-${index + 1}`,
                { featured: item.institution.id === 'institution-vinci' || (index === 1 && !responsibilities.some(entry => entry.institution.id === 'institution-vinci')) }
              ]"
            >
              <span aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="8" r="3.2" />
                  <path d="M5.5 20c.5-4.2 2.7-6.3 6.5-6.3s6 2.1 6.5 6.3" />
                </svg>
              </span>
              <strong>{{ item.responsibility!.name }}</strong>
              <small>{{ item.institution.name }}</small>
            </article>
          </div>
          <p class="organization-responsibility-note">{{ structure.responsibilityNote }}</p>
        </div>
      </section>

      <section
        class="organization-department-system"
        :class="{ 'has-focus': selectedDepartment }"
        aria-label="部门轨道"
      >
        <article
          v-for="(item, index) in departmentSystems"
          :key="item.group.id"
          class="organization-department"
          :class="[
            item.institution.id === 'institution-emis' ? 'is-emis-department' : 'is-vinci-department',
            { 'is-selected': selectedDepartmentId === item.group.id }
          ]"
          :style="departmentOrbitStyle(index, departmentSystems.length)"
        >
          <button
            type="button"
            class="organization-department-planet"
            :aria-expanded="selectedDepartmentId === item.group.id"
            aria-controls="organization-department-focus"
            @click="selectedDepartmentId = item.group.id"
          >
            <span aria-hidden="true">{{ groupSymbol(item.group, index) }}</span>
            <strong>{{ item.group.name }}</strong>
          </button>
          <ul v-if="rolesOf(item.group).length" class="organization-department-mini-moons" aria-hidden="true">
            <li
              v-for="(role, roleIndex) in rolesOf(item.group)"
              :key="role.id"
              :style="roleMoonStyle(roleIndex, rolesOf(item.group).length)"
            ><i /></li>
          </ul>
        </article>
      </section>

      <Transition name="organization-focus">
        <section
          v-if="selectedDepartment"
          id="organization-department-focus"
          class="organization-department-focus"
          aria-live="polite"
        >
          <button
            type="button"
            class="organization-focus-close"
            aria-label="关闭部门聚焦"
            @click="closeDepartmentFocus"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <header>
            <small>{{ selectedDepartment.institution.name }} · {{ selectedDepartment.division.name }}</small>
            <h2>{{ selectedDepartment.group.name }}</h2>
            <p>部门岗位轨道</p>
          </header>
          <div class="organization-focus-system">
            <div class="organization-focus-orbit" aria-hidden="true" />
            <div class="organization-focus-planet">
              <span aria-hidden="true">{{ groupSymbol(selectedDepartment.group, 0) }}</span>
              <strong>{{ selectedDepartment.group.name }}</strong>
            </div>
            <ul v-if="rolesOf(selectedDepartment.group).length" class="organization-focus-moons">
              <li
                v-for="(role, index) in rolesOf(selectedDepartment.group)"
                :key="role.id"
                :style="roleMoonStyle(index, rolesOf(selectedDepartment.group).length)"
              >
                <i aria-hidden="true" />
                <strong>{{ role.name }}</strong>
              </li>
            </ul>
            <p v-else class="organization-focus-empty">当前未配置下级岗位</p>
          </div>
        </section>
      </Transition>

      <aside v-if="structure.relations.length" class="organization-crosslinks" aria-label="跨部门关系">
        <div v-for="relation in structure.relations" :key="relation.id">
          <span>{{ relationDetails(relation).from }}</span>
          <strong>{{ relation.label }}</strong>
          <span>{{ relationDetails(relation).to }}</span>
        </div>
      </aside>
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
      <header>
        <small>EXTENDED STRUCTURE</small>
        <h2>其他机构</h2>
      </header>
      <div>
        <article v-for="institution in extraInstitutions" :key="institution.id">
          <strong>{{ institution.name }}</strong>
          <span v-if="institution.description">{{ institution.description }}</span>
          <small v-for="responsibility in childrenOf(institution.id, 'responsibility')" :key="responsibility.id">
            {{ responsibility.name }}
          </small>
        </article>
      </div>
    </section>
  </section>
</template>
