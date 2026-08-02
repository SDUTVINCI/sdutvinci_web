import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const root = resolve(process.argv[2] || '')
if (root === '/' || !process.argv[2]) throw new Error('PHASE11_WIKI_TEST_ROOT_UNSAFE')

const walk = async (directory) => {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await walk(path))
    else if (entry.isFile() && /\.mdc?$/i.test(entry.name)) paths.push(path)
    else throw new Error(`PHASE11_WIKI_TEST_ENTRY_UNSAFE:${entry.name}`)
  }
  return paths
}

const files = []
for (const path of (await walk(join(root, 'wiki'))).sort()) {
  const source = await readFile(path)
  files.push({
    collection: 'wiki',
    path: relative(root, path).replaceAll('\\', '/'),
    bytes: source.byteLength,
    sha256: createHash('sha256').update(source).digest('hex')
  })
}
await mkdir(join(root, '.vinci'), { recursive: true, mode: 0o700 })
const payload = `${JSON.stringify({ formatVersion: 1, files }, null, 2)}\n`
await writeFile(join(root, '.vinci', 'snapshot.json'), payload, { mode: 0o600 })
await writeFile(join(root, 'manifest.json'), payload, { mode: 0o600 })
