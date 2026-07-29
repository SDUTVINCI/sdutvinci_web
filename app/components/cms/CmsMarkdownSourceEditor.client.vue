<script setup lang="ts">
import { markdown } from '@codemirror/lang-markdown'
import { Compartment, EditorState } from '@codemirror/state'
import { basicSetup, EditorView } from 'codemirror'

const props = defineProps<{
  modelValue: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  ready: []
  error: [message: string]
}>()

const root = ref<HTMLElement | null>(null)
const fallback = ref<HTMLTextAreaElement | null>(null)
const failed = ref(false)
const editable = new Compartment()
let view: EditorView | null = null
let acceptingUpdates = false

const insertMarkdown = (source: string) => {
  if (view) {
    const selection = view.state.selection.main
    const before = view.state.doc.sliceString(0, selection.from)
    const after = view.state.doc.sliceString(selection.to)
    const prefix = before && !before.endsWith('\n\n')
      ? before.endsWith('\n') ? '\n' : '\n\n'
      : ''
    const suffix = after && !after.startsWith('\n')
      ? '\n\n'
      : after.startsWith('\n\n') || !after ? '' : '\n'
    const inserted = `${prefix}${source}${suffix}`
    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert: inserted
      },
      selection: { anchor: selection.from + inserted.length },
      scrollIntoView: true
    })
    view.focus()
    return true
  }

  const editor = fallback.value
  if (!editor) return false
  const start = editor.selectionStart
  const end = editor.selectionEnd
  const before = props.modelValue.slice(0, start)
  const after = props.modelValue.slice(end)
  const prefix = before && !before.endsWith('\n\n')
    ? before.endsWith('\n') ? '\n' : '\n\n'
    : ''
  const suffix = after && !after.startsWith('\n')
    ? '\n\n'
    : after.startsWith('\n\n') || !after ? '' : '\n'
  const inserted = `${prefix}${source}${suffix}`
  emit(
    'update:modelValue',
    before + inserted + after
  )
  nextTick(() => {
    editor.focus()
    editor.setSelectionRange(start + inserted.length, start + inserted.length)
  })
  return true
}

defineExpose({ insertMarkdown })

watch(
  () => props.modelValue,
  (value) => {
    if (!view || value === view.state.doc.toString()) return
    acceptingUpdates = false
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    })
    acceptingUpdates = true
  }
)

watch(
  () => props.readonly,
  value => view?.dispatch({
    effects: editable.reconfigure(EditorView.editable.of(!value))
  })
)

onMounted(() => {
  if (!root.value) return
  try {
    view = new EditorView({
      parent: root.value,
      state: EditorState.create({
        doc: props.modelValue,
        extensions: [
          basicSetup,
          markdown(),
          editable.of(EditorView.editable.of(!props.readonly)),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (acceptingUpdates && update.docChanged) {
              emit('update:modelValue', update.state.doc.toString())
            }
          }),
          EditorView.theme({
            '&': { height: '100%', minHeight: '36rem' },
            '.cm-scroller': {
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              lineHeight: '1.7',
              overflow: 'auto'
            },
            '.cm-content': { padding: '1rem 0' },
            '.cm-gutters': { backgroundColor: 'transparent' }
          })
        ]
      })
    })
    acceptingUpdates = true
    emit('ready')
  } catch (error) {
    failed.value = true
    emit('error', error instanceof Error ? error.message : 'CodeMirror 初始化失败')
  }
})

onUnmounted(() => {
  acceptingUpdates = false
  view?.destroy()
  view = null
})
</script>

<template>
  <div class="cms-codemirror-shell">
    <div v-if="!failed" ref="root" class="cms-codemirror-root" />
    <textarea
      v-else
      ref="fallback"
      :value="modelValue"
      class="cms-markdown-source"
      spellcheck="false"
      aria-label="Markdown 源码回退编辑器"
      :readonly="readonly"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
  </div>
</template>
