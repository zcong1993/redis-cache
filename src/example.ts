import * as Redis from 'ioredis'
import { RedisCache } from './cache'

const client = new Redis()

const rc = new RedisCache({ client, nonExistsExpire: 100 })

const sleep = (n: number) => new Promise((r) => setTimeout(r, n))

interface Res {
  k: string
  res: string
}

const genRes = (k: string): Res => {
  return { k, res: `${k}-res` }
}

const mapFn = async (keys: string[]): Promise<Map<string, Res>> => {
  const mp = new Map<string, Res>()
  keys.forEach((k) => {
    mp.set(k, genRes(k))
  })
  return mp
}

const arrFn = async (keys: string[]): Promise<Res[]> => {
  await sleep(1000)
  return keys.map(genRes)
}

const singleFn = async (key: string): Promise<Res> => {
  await sleep(1000)
  return genRes(key)
}

const fn = async (): Promise<Res> => {
  await sleep(1000)
  return genRes('test')
}

const main = async () => {
  const res = await Promise.all(
    Array(10)
      .fill(null)
      .map(() => rc.batchGetArray('test', arrFn, ['test1', 'test2'], 'k', 1000))
  )
  console.log(res, rc.stats)

  const res1 = await rc.getOne('single', singleFn, 'test', 1000)
  console.log(res1, rc.stats)

  const res2 = await rc.cacheFn('fn-test', fn, 1000)
  console.log(res2, rc.stats)

  const res3 = await Promise.all(
    Array(10)
      .fill(null)
      .map(() => rc.batchGet('test-map', mapFn, ['test1', 'test2'], 1000))
  )
  console.log(res3, rc.stats)
}

main()
