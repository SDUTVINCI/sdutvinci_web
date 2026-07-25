import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { z } from 'zod'
import { cmsAccountPattern } from '../shared/types/cms-auth'
import { closeDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { bootstrapCmsAdmin, countAdmins } from '../server/services/cms-auth'

const emailSchema = z.email('请输入有效邮箱').max(320)
const accountSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(cmsAccountPattern, '账号须为 3～32 位小写字母或数字，并以字母开头')
const nameSchema = z.string().trim().min(1, '显示名称不能为空').max(100)
const passwordSchema = z
  .string()
  .min(12, '密码至少需要 12 个字符')
  .max(1024)
  .refine(value => /[a-z]/i.test(value) && /\d/.test(value), {
    message: '密码至少需要同时包含字母和数字'
  })

const readSecret = (prompt: string): Promise<string> => {
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) {
    throw new Error('必须在交互式终端中运行，密码不会从参数或环境变量读取')
  }

  return new Promise((resolve, reject) => {
    let value = ''
    stdout.write(prompt)
    stdin.setRawMode!(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    const finish = () => {
      stdin.setRawMode!(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      stdout.write('\n')
    }

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          finish()
          reject(new Error('已取消'))
          return
        }

        if (char === '\r' || char === '\n') {
          finish()
          resolve(value)
          return
        }

        if (char === '\u007f') {
          if (value.length > 0) {
            value = value.slice(0, -1)
            stdout.write('\b \b')
          }
          continue
        }

        if (char >= ' ') {
          value += char
          stdout.write('*')
        }
      }
    }

    stdin.on('data', onData)
  })
}

const main = async () => {
  if (process.argv.length > 2) {
    throw new Error('此命令不接受参数，请按交互提示输入')
  }

  await runMigrations()

  if (await countAdmins() > 0) {
    throw new Error('管理员已经存在；安全起见，首次初始化命令拒绝继续')
  }

  const readline = createInterface({ input: stdin, output: stdout })
  const account = accountSchema.parse(await readline.question('账号 ID（如 dongjiahui）：'))
  const email = emailSchema.parse((await readline.question('管理员邮箱：')).trim().toLowerCase())
  const displayName = nameSchema.parse(await readline.question('显示名称：'))
  readline.close()

  const password = passwordSchema.parse(await readSecret('密码（输入内容不会显示）：'))
  const confirmation = await readSecret('再次输入密码：')

  if (password !== confirmation) {
    throw new Error('两次密码输入不一致')
  }

  const admin = await bootstrapCmsAdmin({ account, email, displayName, password })
  stdout.write(`管理员已创建：${admin?.account}\n`)
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`初始化失败：${message}`)
    process.exitCode = 1
  })
  .finally(closeDatabase)
