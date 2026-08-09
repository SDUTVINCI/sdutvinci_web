<script setup lang="ts">
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState } from '@codemirror/state'
import { basicSetup, EditorView } from 'codemirror'
import { tags } from '@lezer/highlight'
import {
  createProgrammaticScrollGuard,
  getScrollProgress,
  getScrollTopForProgress
} from '../../utils/cms-scroll-sync'

const props = defineProps<{
  modelValue: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  ready: []
  error: [message: string]
  scrollProgress: [progress: number]
}>()

const root = ref<HTMLElement | null>(null)
const fallback = ref<HTMLTextAreaElement | null>(null)
const failed = ref(false)
const editable = new Compartment()
let view: EditorView | null = null
let acceptingUpdates = false
const programmaticScroll = createProgrammaticScrollGuard()

const cmsSyntaxHighlighting = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--cms-code-heading)', fontWeight: '750' },
  { tag: [tags.link, tags.url], color: 'var(--cms-code-link)', textDecoration: 'underline' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--cms-code-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--cms-code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--cms-code-number)' },
  { tag: [tags.comment, tags.meta], color: 'var(--cms-code-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--cms-code-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--cms-code-type)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--cms-code-variable)' },
  { tag: [tags.punctuation, tags.processingInstruction], color: 'var(--cms-code-punctuation)' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strong], fontWeight: '800' },
  { tag: [tags.invalid], color: 'var(--cms-code-invalid)', textDecoration: 'underline wavy' }
])

const reportScroll = (element: HTMLElement) => {
  if (programmaticScroll.consume(element.scrollTop)) return
  emit('scrollProgress', getScrollProgress(
    element.scrollTop,
    element.scrollHeight,
    element.clientHeight
  ))
}

const handleEditorScroll = () => {
  if (view) reportScroll(view.scrollDOM)
}

const handleFallbackScroll = (event: Event) => {
  reportScroll(event.currentTarget as HTMLTextAreaElement)
}

const setScrollProgress = (progress: number) => {
  const element = view?.scrollDOM || fallback.value
  if (!element) return false
  const target = getScrollTopForProgress(
    progress,
    element.scrollHeight,
    element.clientHeight
  )
  if (Math.abs(element.scrollTop - target) <= 1) {
    programmaticScroll.clear()
    return true
  }

  programmaticScroll.mark(target)
  element.scrollTop = target
  return true
}

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

defineExpose({ insertMarkdown, setScrollProgress })

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
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(cmsSyntaxHighlighting),
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
            '.cm-gutters': { backgroundColor: 'transparent' },
            '.cm-activeLine': { backgroundColor: 'var(--cms-code-active-line)' },
            '.cm-activeLineGutter': { backgroundColor: 'var(--cms-code-active-gutter)' },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
              backgroundColor: 'var(--cms-code-selection) !important'
            },
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cms-code-caret)' }
          })
        ]
      })
    })
    view.scrollDOM.addEventListener('scroll', handleEditorScroll, { passive: true })
    acceptingUpdates = true
    emit('ready')
  } catch (error) {
    failed.value = true
    emit('error', error instanceof Error ? error.message : 'CodeMirror 初始化失败')
  }
})

onUnmounted(() => {
  acceptingUpdates = false
  programmaticScroll.clear()
  view?.scrollDOM.removeEventListener('scroll', handleEditorScroll)
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
      @scroll="handleFallbackScroll"
    />
  </div>
</template>
