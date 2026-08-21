<script setup lang="ts">
import type {
  CmsOrganizationResponse,
  OrganizationNode,
  OrganizationNodeKind,
  OrganizationStructure
} from '../../../shared/types/organization'

definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-admin'] })
useHead({ title: '组织架构 · Vinci 内容管理后台' })

const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { csrfHeaders } = useCmsSession()
const { data, error } = await useAsyncData('cms:organization', () =>
  requestFetch<CmsOrganizationResponse>('/api/cms/organization')
)

const structure = ref<OrganizationStructure | null>(null)
const savedSnapshot = ref('')
const selectedId = ref('')
const saving = ref(false)
const publishing = ref(false)
const message = ref('')
const errorMessage = ref('')

const syncResponse = (response: CmsOrganizationResponse | null | undefined) => {
  if (!response) return
  structure.value = structuredClone(response.draft)
  savedSnapshot.value = JSON.stringify(response.draft)
  if (!selectedId.value || !response.draft.nodes.some(node => node.id === selectedId.value)) {
    selectedId.value = response.draft.rootNodeId
  }
}
watch(data, syncResponse, { immediate: true })

const isDirty = computed(() => Boolean(structure.value) && JSON.stringify(structure.value) !== savedSnapshot.value)
const selectedNode = computed(() => structure.value?.nodes.find(node => node.id === selectedId.value))
const nodeById = (id: string) => structure.value?.nodes.find(node => node.id === id)
const childrenOf = (id: string) => (structure.value?.nodes || [])
  .filter(node => node.parentId === id)
  .sort((a, b) => a.sortOrder - b.sortOrder)

interface TreeRow { node: OrganizationNode, depth: number }
const treeRows = computed<TreeRow[]>(() => {
  if (!structure.value) return []
  const rows: TreeRow[] = []
  const visit = (id: string, depth: number) => {
    const node = nodeById(id)
    if (!node) return
    rows.push({ node, depth })
    childrenOf(id).forEach(child => visit(child.id, depth + 1))
  }
  visit(structure.value.rootNodeId, 0)
  return rows
})

const descendantsOf = (id: string) => {
  const result = new Set<string>()
  const visit = (parentId: string) => childrenOf(parentId).forEach(child => {
    result.add(child.id)
    visit(child.id)
  })
  visit(id)
  return result
}

const parentOptions = computed(() => {
  if (!selectedNode.value) return []
  const disallowed = descendantsOf(selectedNode.value.id)
  disallowed.add(selectedNode.value.id)
  const parentKind: Partial<Record<OrganizationNodeKind, OrganizationNodeKind>> = {
    institution: 'organization', responsibility: 'institution', division: 'institution', group: 'division', role: 'group'
  }
  return treeRows.value.filter(row =>
    !disallowed.has(row.node.id) && row.node.kind === parentKind[selectedNode.value!.kind]
  )
})

const canAddChild = computed(() => {
  if (!selectedNode.value) return false
  return !['responsibility', 'role'].includes(selectedNode.value.kind)
})
const canAddResponsibility = computed(() => selectedNode.value?.kind === 'institution'
  && !childrenOf(selectedNode.value.id).some(node => node.kind === 'responsibility'))

const nodeKinds: Array<{ value: OrganizationNodeKind, label: string }> = [
  { value: 'organization', label: '协同根节点' },
  { value: 'institution', label: '机构主体' },
  { value: 'responsibility', label: '负责人职责' },
  { value: 'division', label: '部门分支' },
  { value: 'group', label: '组别 / 部门' },
  { value: 'role', label: '岗位 / 子组' }
]

const nextId = (prefix: 'node' | 'relation') => `${prefix}-${Date.now().toString(36)}`
const addChild = (forcedKind?: OrganizationNodeKind) => {
  if (!structure.value || !selectedNode.value || !canAddChild.value) return
  const siblings = childrenOf(selectedNode.value.id)
  const kind = forcedKind || (selectedNode.value.kind === 'organization'
    ? 'institution'
    : selectedNode.value.kind === 'institution'
      ? 'division'
      : selectedNode.value.kind === 'division'
        ? 'group'
        : 'role')
  const node: OrganizationNode = {
    id: nextId('node'),
    parentId: selectedNode.value.id,
    kind,
    name: kind === 'responsibility' ? '新负责人' : '新节点',
    description: '',
    sortOrder: siblings.length
  }
  structure.value.nodes.push(node)
  selectedId.value = node.id
}

const normalizeSiblingOrder = (parentId: string | null) => {
  if (!structure.value) return
  structure.value.nodes
    .filter(node => node.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((node, index) => { node.sortOrder = index })
}

const changeParent = () => {
  if (!selectedNode.value) return
  normalizeSiblingOrder(selectedNode.value.parentId)
  selectedNode.value.sortOrder = childrenOf(selectedNode.value.parentId || '').length
  normalizeSiblingOrder(selectedNode.value.parentId)
}

const changeKind = () => {
  if (!selectedNode.value) return
  const target = parentOptions.value[0]?.node
  if (target) {
    selectedNode.value.parentId = target.id
    changeParent()
  }
}

const moveSelected = (direction: -1 | 1) => {
  const node = selectedNode.value
  if (!node) return
  const siblings = (structure.value?.nodes || []).filter(item => item.parentId === node.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
  const current = siblings.findIndex(item => item.id === node.id)
  const target = current + direction
  if (current < 0 || target < 0 || target >= siblings.length) return
  const other = siblings[target]!
  const previous = node.sortOrder
  node.sortOrder = other.sortOrder
  other.sortOrder = previous
}

const deleteSelected = () => {
  if (!structure.value || !selectedNode.value || selectedNode.value.id === structure.value.rootNodeId) return
  const parentId = selectedNode.value.parentId
  const removing = descendantsOf(selectedNode.value.id)
  removing.add(selectedNode.value.id)
  structure.value.nodes = structure.value.nodes.filter(node => !removing.has(node.id))
  structure.value.relations = structure.value.relations.filter(relation =>
    !removing.has(relation.fromNodeId) && !removing.has(relation.toNodeId)
  )
  selectedId.value = parentId || structure.value.rootNodeId
  normalizeSiblingOrder(parentId)
}

const addRelation = () => {
  if (!structure.value || structure.value.nodes.length < 2) return
  const from = selectedNode.value || structure.value.nodes[0]!
  const to = structure.value.nodes.find(node => node.id !== from.id)!
  structure.value.relations.push({ id: nextId('relation'), fromNodeId: from.id, toNodeId: to.id, label: '说明两个节点之间的关系' })
}

const removeRelation = (id: string) => {
  if (structure.value) structure.value.relations = structure.value.relations.filter(relation => relation.id !== id)
}

const applyResponse = (response: CmsOrganizationResponse, success: string) => {
  data.value = response
  syncResponse(response)
  message.value = success
  errorMessage.value = ''
}

const saveDraft = async () => {
  if (!structure.value || !data.value) return
  saving.value = true; message.value = ''; errorMessage.value = ''
  try {
    const response = await $fetch<CmsOrganizationResponse>('/api/cms/organization', {
      method: 'PATCH', headers: csrfHeaders(), body: { expectedVersion: data.value.version, structure: structure.value }
    })
    applyResponse(response, '草稿已保存，公开页面尚未改变。')
  } catch (fetchError: any) {
    errorMessage.value = fetchError?.data?.message || '保存失败，请检查节点关系。'
  } finally { saving.value = false }
}

const publish = async () => {
  if (!data.value || isDirty.value) return
  publishing.value = true; message.value = ''; errorMessage.value = ''
  try {
    const response = await $fetch<CmsOrganizationResponse>('/api/cms/organization/publish', {
      method: 'POST', headers: csrfHeaders(), body: { expectedVersion: data.value.version, confirmation: 'PUBLISH_ORGANIZATION' }
    })
    applyResponse(response, '当前组织架构已正式发布。')
  } catch (fetchError: any) {
    errorMessage.value = fetchError?.data?.message || '发布失败。'
  } finally { publishing.value = false }
}
</script>

<template>
  <section class="cms-page cms-organization-page">
    <header class="cms-page-header cms-page-header-actions">
      <div>
        <p class="cms-eyebrow">ORGANIZATION</p>
        <h1>组织架构</h1>
        <p>只维护当前架构；数据完全独立，不关联成员、头像、赛季或 Team 名录。</p>
      </div>
      <div class="cms-organization-actions">
        <span class="cms-organization-status" :class="{ dirty: isDirty || data?.hasUnpublishedChanges }">
          {{ isDirty ? '本地修改未保存' : data?.hasUnpublishedChanges ? '草稿尚未发布' : '公开版本已同步' }}
        </span>
        <button class="cms-button cms-button-quiet" type="button" :disabled="!isDirty || saving" @click="saveDraft">
          {{ saving ? '保存中…' : '保存草稿' }}
        </button>
        <button class="cms-button cms-button-primary" type="button" :disabled="isDirty || !data?.hasUnpublishedChanges || publishing" @click="publish">
          {{ publishing ? '发布中…' : '发布架构' }}
        </button>
      </div>
    </header>

    <p v-if="message" class="cms-alert">{{ message }}</p>
    <p v-if="errorMessage || error" class="cms-alert cms-alert-error">{{ errorMessage || error?.message }}</p>

    <div v-if="structure" class="cms-organization-workspace">
      <section class="cms-panel cms-organization-tree-panel">
        <header>
          <div><p class="cms-eyebrow">STRUCTURE TREE</p><h2>架构树</h2></div>
          <div class="cms-organization-tree-actions">
            <button v-if="canAddResponsibility" class="cms-button cms-button-quiet" type="button" @click="addChild('responsibility')">＋ 添加负责人</button>
            <button class="cms-button cms-button-quiet" type="button" :disabled="!canAddChild" @click="addChild()">＋ 添加子节点</button>
          </div>
        </header>
        <div class="cms-organization-tree" role="tree">
          <button
            v-for="row in treeRows"
            :key="row.node.id"
            type="button"
            role="treeitem"
            :aria-level="row.depth + 1"
            :aria-selected="selectedId === row.node.id"
            :class="{ active: selectedId === row.node.id }"
            :style="{ '--tree-depth': row.depth }"
            @click="selectedId = row.node.id"
          >
            <span>{{ row.node.kind === 'organization' ? '◎' : row.node.kind === 'institution' ? '◆' : row.node.kind === 'responsibility' ? '◇' : row.node.kind === 'division' ? '▣' : '·' }}</span>
            <strong>{{ row.node.name }}</strong>
          </button>
        </div>
        <footer>
          <button class="cms-button cms-button-quiet" type="button" @click="moveSelected(-1)">上移</button>
          <button class="cms-button cms-button-quiet" type="button" @click="moveSelected(1)">下移</button>
          <button class="cms-button cms-button-danger" type="button" :disabled="selectedId === structure.rootNodeId" @click="deleteSelected">删除节点</button>
        </footer>
      </section>

      <section class="cms-panel cms-organization-preview-panel">
        <header><div><p class="cms-eyebrow">LIVE PREVIEW</p><h2>公开效果预览</h2></div><span class="cms-badge">实时</span></header>
        <OrganizationChart :structure="structure" compact />
      </section>

      <aside class="cms-organization-inspector">
        <section v-if="selectedNode" class="cms-panel">
          <header><div><p class="cms-eyebrow">NODE</p><h2>节点属性</h2></div><code>{{ selectedNode.id }}</code></header>
          <label><span>节点名称</span><input v-model.trim="selectedNode.name" maxlength="120" required></label>
          <label><span>节点类型</span><select v-model="selectedNode.kind" :disabled="selectedNode.id === structure.rootNodeId || childrenOf(selectedNode.id).length > 0" @change="changeKind"><option v-for="kind in nodeKinds" :key="kind.value" :value="kind.value">{{ kind.label }}</option></select><small v-if="childrenOf(selectedNode.id).length">先移除或迁移子节点后才能改变类型。</small></label>
          <label v-if="selectedNode.id !== structure.rootNodeId"><span>上级节点</span><select v-model="selectedNode.parentId" @change="changeParent"><option v-for="row in parentOptions" :key="row.node.id" :value="row.node.id">{{ '—'.repeat(row.depth) }} {{ row.node.name }}</option></select></label>
          <label><span>补充说明</span><textarea v-model.trim="selectedNode.description" maxlength="300" rows="4" placeholder="可选；机构节点可填写定位，例如实验室" /></label>
          <label v-if="selectedNode.id === structure.rootNodeId"><span>职责共同说明</span><input v-model.trim="structure.responsibilityNote" maxlength="120" placeholder="例如：通常由同一人兼任"></label>
        </section>

        <section class="cms-panel cms-organization-relations-editor">
          <header><div><p class="cms-eyebrow">RELATIONS</p><h2>跨部门关系</h2></div><button class="cms-button cms-button-quiet" type="button" @click="addRelation">＋ 新增</button></header>
          <article v-for="relation in structure.relations" :key="relation.id">
            <select v-model="relation.fromNodeId"><option v-for="row in treeRows" :key="row.node.id" :value="row.node.id">{{ row.node.name }}</option></select>
            <span aria-hidden="true">→</span>
            <select v-model="relation.toNodeId"><option v-for="row in treeRows" :key="row.node.id" :value="row.node.id">{{ row.node.name }}</option></select>
            <input v-model.trim="relation.label" maxlength="180" placeholder="关系说明">
            <button type="button" aria-label="删除关系" @click="removeRelation(relation.id)">删除</button>
          </article>
          <p v-if="!structure.relations.length" class="cms-muted">没有跨部门关系。</p>
        </section>
      </aside>
    </div>
    <p v-else-if="!error" class="cms-muted">正在加载组织架构…</p>
  </section>
</template>
