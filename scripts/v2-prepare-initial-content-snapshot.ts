import { prepareInitialContentSnapshot } from '../server/services/initial-content-snapshot'
import { describeCmsFailure } from '../server/utils/cms-sensitive-data'

const value = (name: string) =>
  process.argv.find(argument => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3)

try {
  const sourceRoot = value('source')
  const outputRoot = value('output')
  const sourceCommit = value('source-commit')
  const expectedRemote = value('expected-remote')
  if (!sourceRoot || !outputRoot || !sourceCommit || !expectedRemote) {
    throw new Error(
      '用法：v2:content:prepare-initial-snapshot --source=/绝对路径 '
      + '--output=/绝对路径 --source-commit=40位SHA --expected-remote=Git远端'
    )
  }
  const report = await prepareInitialContentSnapshot({
    sourceRoot,
    outputRoot,
    sourceCommit,
    expectedRemote
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${describeCmsFailure(error)}\n`)
  process.exitCode = 1
}
