<script setup lang="ts">
import type { OrganizationNode, OrganizationRelation, OrganizationStructure } from '../../shared/types/organization'

const props = defineProps<{
  structure: OrganizationStructure
  compact?: boolean
}>()

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
</script>

<template>
  <section class="organization-chart organization-constellation" :class="{ 'is-compact': compact }" aria-label="组织架构图">
    <div class="organization-orbit-stage">
      <svg class="organization-orbit-lines" viewBox="0 0 1160 790" aria-hidden="true" preserveAspectRatio="none">
        <circle cx="580" cy="326" r="228" />
        <circle cx="580" cy="326" r="178" />
        <path d="M358 328 C405 328 430 328 461 328" />
        <path d="M699 328 C735 328 760 328 802 328" />
        <path d="M580 515 C580 554 580 574 580 602" />
      </svg>

      <section
        v-if="primaryDomains[0]"
        class="organization-domain organization-domain-left"
        :aria-labelledby="`${primaryDomains[0].division.id}-title`"
      >
        <header>
          <small>{{ primaryDomains[0].institution.name }}</small>
          <h2 :id="`${primaryDomains[0].division.id}-title`">{{ primaryDomains[0].division.name }}</h2>
        </header>
        <div class="organization-domain-groups">
          <article v-for="(group, index) in groupsOf(primaryDomains[0].division)" :key="group.id" class="organization-orbit-group">
            <ul v-if="rolesOf(group).length">
              <li v-for="role in rolesOf(group)" :key="role.id">{{ role.name }}</li>
            </ul>
            <div class="organization-orbit-group-node">
              <span aria-hidden="true">{{ groupSymbol(group, index) }}</span>
              <strong>{{ group.name }}</strong>
            </div>
          </article>
        </div>
      </section>

      <section class="organization-core" aria-label="协同机构与负责人职责">
        <div class="organization-core-constellation">
          <span class="organization-core-ring ring-one" aria-hidden="true" />
          <span class="organization-core-ring ring-two" aria-hidden="true" />
          <svg class="organization-core-connectors" viewBox="0 0 500 510" aria-hidden="true">
            <path d="M250 125 L142 286 L358 286 Z" />
            <path d="M250 183 C250 215 250 220 250 238" />
          </svg>

          <article
            v-for="(institution, index) in institutions.slice(0, 3)"
            :key="institution.id"
            class="organization-institution"
            :class="`institution-${index + 1}`"
          >
            <span class="organization-institution-mark" aria-hidden="true">
              {{ index === 0 ? 'E' : index === 1 ? 'V' : 'I' }}
            </span>
            <strong>{{ institution.name }}</strong>
            <small v-if="institution.description">{{ institution.description }}</small>
          </article>

          <div class="organization-collaboration-hub">
            <span aria-hidden="true">↻</span>
            <strong>{{ root?.name || '协同运行' }}</strong>
          </div>

          <div class="organization-responsibilities">
            <article
              v-for="(item, index) in responsibilities.slice(0, 3)"
              :key="item.responsibility!.id"
              :class="{ featured: item.institution.id === 'institution-vinci' || (index === 1 && !responsibilities.some(entry => entry.institution.id === 'institution-vinci')) }"
            >
              <span aria-hidden="true">●</span>
              <strong>{{ item.responsibility!.name }}</strong>
              <small>{{ item.institution.name }}</small>
            </article>
          </div>
          <p class="organization-responsibility-note">{{ structure.responsibilityNote }}</p>
        </div>
      </section>

      <section
        v-if="primaryDomains[1]"
        class="organization-domain organization-domain-right"
        :aria-labelledby="`${primaryDomains[1].division.id}-title`"
      >
        <header>
          <small>{{ primaryDomains[1].institution.name }}</small>
          <h2 :id="`${primaryDomains[1].division.id}-title`">{{ primaryDomains[1].division.name }}</h2>
        </header>
        <div class="organization-domain-groups">
          <article v-for="(group, index) in groupsOf(primaryDomains[1].division)" :key="group.id" class="organization-orbit-group">
            <div class="organization-orbit-group-node">
              <span aria-hidden="true">{{ groupSymbol(group, index) }}</span>
              <strong>{{ group.name }}</strong>
            </div>
            <ul v-if="rolesOf(group).length">
              <li v-for="role in rolesOf(group)" :key="role.id">{{ role.name }}</li>
            </ul>
          </article>
        </div>
      </section>

      <aside v-if="structure.relations.length" class="organization-crosslinks" aria-label="跨部门关系">
        <div v-for="relation in structure.relations" :key="relation.id">
          <span>{{ relationDetails(relation).to }}</span>
          <strong>{{ relation.label }}</strong>
          <span>{{ relationDetails(relation).from }}</span>
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
