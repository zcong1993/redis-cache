import { Singleflight } from '@zcong/singleflight'
import { Redis } from 'ioredis'
import * as debug from 'debug'
import { toMap, toArrWithoutNon } from './utils'

const db = debug('redis-cache')

export const NON_EXISTS_FLAG = '-1'

export interface RedisCacheOptions {
  client: Redis
  nonExistsExpire?: number
}

export interface Stats {
  hit: number
  missing: number
  nonExists: number
}

export type OriginFn<U = any, T = string> = (keys: T[]) => Promise<Map<T, U>>
export type OriginArrayFn<U = any, T = string> = (keys: T[]) => Promise<U[]>

export const msetEx = (
  redis: Redis,
  group: string,
  data: Map<string, string>,
  expire: number
) => {
  const cmds: string[][] = []
  for (const [k, v] of data.entries()) {
    cmds.push(['set', `${group}:${k}`, v, 'ex', `${expire}`])
  }
  return redis.multi(cmds).exec()
}

export class RedisCache {
  private innerStats: Stats
  private readonly opts: RedisCacheOptions
  private readonly client: Redis
  private readonly sf: Singleflight

  constructor(opts: RedisCacheOptions) {
    this.opts = opts
    this.client = opts.client
    this.sf = new Singleflight()
    this.initStats()
  }

  /**
   * batch get data by keys with cache
   * @param group cache group name
   * @param fn origin function
   * @param keys batch keys
   * @param expire normal data expire
   * @param nonExistsExpire non exists data expire
   */
  async batchGet<U = any, T = string>(
    group: string,
    fn: OriginFn<U, T>,
    keys: T[],
    expire: number,
    nonExistsExpire?: number
  ): Promise<Map<T, U>> {
    let hit: number = 0
    let missing: number = 0
    let nonExists: number = 0

    const nee =
      nonExistsExpire !== undefined
        ? nonExistsExpire
        : this.opts.nonExistsExpire

    let cacheRes: string[] = []
    try {
      db(`redis mget: ${keys}`)
      cacheRes = await this.client.mget(...(keys as any))
    } catch (err) {
      // todo: log error
      console.log(`redis get error: `, err)
    }
    let res = new Map<T, U>()
    const missingKeys: T[] = []
    for (let i = 0; i < keys.length; i += 1) {
      if (cacheRes[i] !== null) {
        hit += 1
        if (cacheRes[i] === NON_EXISTS_FLAG) {
          db(`non exists key: ${keys[i]}`)
          nonExists += 1
          res.set(keys[i], null)
        } else {
          res.set(keys[i], (JSON.parse(cacheRes[i]) as any) as U)
        }
      } else {
        missing += 1
        missingKeys.push(keys[i])
      }
    }
    if (missingKeys.length > 0) {
      db(`missing keys: ${missingKeys}`)
      const sfKey = `${group}-${missingKeys.sort().join('-')}`
      db(`sf group key: ${sfKey}`)
      res = await this.sf.do(sfKey, async () => {
        db(`call origin fn with keys: ${JSON.stringify(missingKeys)}`)
        const missingRes = await fn(missingKeys)
        const cacheMp = new Map()
        const missingMap = new Map()
        for (const k of missingRes.keys()) {
          res.set(k, missingRes.get(k))
          if (missingRes.get(k) !== null) {
            cacheMp.set(k, JSON.stringify(missingRes.get(k)))
          } else {
            missingMap.set(k, NON_EXISTS_FLAG)
          }
        }
        if (cacheMp.size > 0) {
          db(`save cache, expire: ${expire}s, `, cacheMp)
          await msetEx(this.client, group, cacheMp, expire)
        }
        if (missingMap.size > 0 && nee !== 0) {
          db(`save missing cache, expire: ${nee}s, `, missingMap)
          await msetEx(this.client, group, missingMap, nee)
        }

        return res
      })
    }

    db(`stats, hit: ${hit}, missing: ${missing}, nonExists: ${nonExists}`)
    this.plusStats({ hit, missing, nonExists })

    return res
  }

  /**
   * batch get array data by keys with cache
   * @param group cache group name
   * @param fn origin function
   * @param keys batch keys
   * @param keyField key field name for detacting missing data
   * @param expire normal data expire
   * @param nonExistsExpire non exists data expire
   */
  async batchGetArray<U = any, T = string>(
    group: string,
    fn: OriginArrayFn<U, T>,
    keys: T[],
    keyField: string,
    expire: number,
    nonExistsExpire?: number
  ): Promise<U[]> {
    const f = async (keys: T[]) => {
      const res = await fn(keys)
      return toMap<U, T>(res, keyField, keys)
    }
    const res = await this.batchGet(group, f, keys, expire, nonExistsExpire)
    return toArrWithoutNon(res)
  }

  get stats() {
    return this.innerStats
  }

  private plusStats(plusStats: Stats) {
    this.innerStats.hit += plusStats.hit
    this.innerStats.missing += plusStats.missing
    this.innerStats.nonExists += plusStats.nonExists
  }

  private initStats() {
    this.innerStats = {
      hit: 0,
      missing: 0,
      nonExists: 0
    }
  }
}
