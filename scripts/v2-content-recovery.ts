import { closeDatabase } from '../server/db/client'
import {
  applyContentRecovery,
  dryRunContentRecovery
} from '../server/services/content-recovery'
import { describeCmsFailure } from '../server/utils/cms-sensitive-data'

const value = (name: string) =>
  process.argv.find(argument => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3)

const source = value('source')
const actor = value('actor')
const mode = value('mode')
const confirmation = value('confirm')
const apply = process.argv.includes('--apply')

try {
  if (!source || !actor) {
    throw new Error(
      '用法：v2:content:recover --source=/绝对路径 --actor=维护者标识 '
      + '--mode=initialize|disaster [--apply --confirm=精确令牌]'
    )
  }
  const recoveryMode = mode === 'disaster'
    ? 'disaster_recovery'
    : mode === 'initialize'
      ? 'empty_database_initialization'
      : null
  if (!recoveryMode) throw new Error('CONTENT_RECOVERY_MODE_ARGUMENT_INVALID')
  const result = apply
    ? await applyContentRecovery(
        source,
        recoveryMode,
        actor,
        confirmation || ''
      )
    : await dryRunContentRecovery(source, recoveryMode, actor)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${describeCmsFailure(error)}\n`)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
