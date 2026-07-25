import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import argon2, { type HashOptions } from 'argon2'
import { getCmsServerConfig } from './cms-config'

const argon2Options: HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
}

export const hashCmsPassword = (password: string) =>
  argon2.hash(password, argon2Options)

export const verifyCmsPassword = (hash: string, password: string) =>
  argon2.verify(hash, password)

export const createSessionToken = () => randomBytes(32).toString('base64url')

export const hashSessionToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

export const hashClientIp = (ip: string | undefined) => {
  if (!ip) {
    return null
  }

  return createHmac('sha256', getCmsServerConfig().CMS_AUTH_SECRET)
    .update(`ip:${ip}`)
    .digest('hex')
}

export const createCsrfToken = (sessionToken: string) =>
  createHmac('sha256', getCmsServerConfig().CMS_AUTH_SECRET)
    .update(`csrf:${sessionToken}`)
    .digest('base64url')

export const verifyCsrfToken = (sessionToken: string, csrfToken: string | undefined) => {
  if (!csrfToken) {
    return false
  }

  const expected = Buffer.from(createCsrfToken(sessionToken))
  const actual = Buffer.from(csrfToken)

  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
