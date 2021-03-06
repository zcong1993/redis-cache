import { Singleflight } from '@zcong/singleflight'
import { Redis } from 'ioredis'
import * as debug from 'debug'
import { toMap, toArrWithoutNon, loadPackage } from './utils'

const db = debug('redis-cache')

export const DEFAULT_NON_EXISTS_FLAG = '@@-1'
export const cacheFnHackKey: string = '__cache_func_hack_key__'

let promClient: any = {}

let requestsCounter: any
let hitCounter: any
let nonExistsCounter: any
let deleteCounter: any

export interface RedisCacheOptions {
  client: Redis
  keyPrefix?: string
  nonExistsExpire?: number
  nonExistsValue?: string
  withPrometheus?: boolean
}

export interface Stats {
  hit: number
  missing: number
  nonExists: number
}

export interface ExtOps {
  nonExistsExpire?: number
}

export type SingleFn<U = any, T = string> = (key: T) => Promise<U>
export type OriginFn<U = any, T = string> = (keys: T[]) => Promise<Map<T, U>>
export type OriginArrayFn<U = any, T = string> = (keys: T[]) => Promise<U[]>

export const msetEx = (
  redis: Redis,
  group: string,
  data: Map<string, string>,
  expire: number,
  keyPrefix?: string
) => {
  const cmds: string[][] = []
  for (const [k, v] of data.entries()) {
    cmds.push([
      'set',
      RedisCache.buildCacheKey(keyPrefix, group, k),
      v,
      'ex',
      `${expire}`
    ])
  }
  return redis.multi(cmds).exec()
}

export class RedisCache {
  private innerStats: Stats
  private readonly opts: RedisCacheOptions
  private readonly client: Redis
  private readonly sf: Singleflight
  private readonly NON_EXISTS_FLAG: string = DEFAULT_NON_EXISTS_FLAG

  constructor(opts: RedisCacheOptions) {
    if (!opts.nonExistsExpire) {
      opts.nonExistsExpire = 10
    }
    if (opts.nonExistsValue) {
      this.NON_EXISTS_FLAG = opts.nonExistsValue
    }
    if (!opts.keyPrefix) {
      opts.keyPrefix = ''
    }

    this.opts = opts
    this.client = opts.client

    if (opts.withPrometheus) {
      promClient = loadPackage('prom-client', 'withPrometheus', () =>
        require('prom-client')
      )
      this.setupPrometheus()
    }

    this.sf = new Singleflight()
    this.initStats()
  }

  /**
   * batch get data by keys with cache
   * @param group cache group name
   * @param fn origin function
   * @param keys batch keys
   * @param expire normal data expire
   * @param ext ext options
   */
  async batchGet<U = any, T = string>(
    group: string,
    fn: OriginFn<U, T>,
    keys: T[],
    expire: number,
    ext?: number | ExtOps
  ): Promise<Map<T, U>> {
    let hit: number = 0
    let missing: number = 0
    let nonExists: number = 0

    let nonExistsExpire: number = undefined

    this.incrCounter(requestsCounter, keys.length)

    if (ext !== undefined) {
      // legicy
      if (typeof ext === 'number') {
        nonExistsExpire = ext
      } else {
        // new options
        nonExistsExpire = ext.nonExistsExpire
      }
    }

    const nee =
      nonExistsExpire !== undefined
        ? nonExistsExpire
        : this.opts.nonExistsExpire

    let cacheRes: string[] = []
    try {
      const redisKeys: string[] = keys.map(k =>
        RedisCache.buildCacheKey(
          this.opts.keyPrefix,
          group,
          (k as any) as string
        )
      )
      db(`redis mget: ${redisKeys}`)
      cacheRes = await this.client.mget(...redisKeys)
    } catch (err) {
      // todo: log error
      /* istanbul ignore next */
      console.log(`redis get error: `, err)
    }
    let res = new Map<T, U>()
    const missingKeys: T[] = []
    for (let i = 0; i < keys.length; i += 1) {
      if (cacheRes[i] !== null) {
        hit += 1
        if (cacheRes[i] === this.NON_EXISTS_FLAG) {
          db(`non exists key: ${keys[i]}`)
          nonExists += 1
          res.set(keys[i], null)
        } else {
          const val = JSON.parse(cacheRes[i])
          res.set(keys[i], val as U)
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
        for (const k of missingKeys) {
          if (missingRes.has(k)) {
            res.set(k, missingRes.get(k))
          }

          if (missingRes.has(k) && missingRes.get(k) !== null) {
            const val = JSON.stringify(missingRes.get(k))
            cacheMp.set(k, val)
          } else {
            missingMap.set(k, this.NON_EXISTS_FLAG)
            nonExists += 1
          }
        }
        if (cacheMp.size > 0) {
          db(`save cache, expire: ${expire}s, `, cacheMp)
          await msetEx(this.client, group, cacheMp, expire, this.opts.keyPrefix)
        }
        if (missingMap.size > 0 && nee !== 0) {
          db(`save missing cache, expire: ${nee}s, `, missingMap)
          await msetEx(this.client, group, missingMap, nee, this.opts.keyPrefix)
        }

        return res
      })
    }

    db(`stats, hit: ${hit}, missing: ${missing}, nonExists: ${nonExists}`)
    this.plusStats({ hit, missing, nonExists })
    this.incrCounter(hitCounter, hit)
    this.incrCounter(nonExistsCounter, nonExists)

    return res
  }

  /**
   * batch get array data by keys with cache
   * @param group cache group name
   * @param fn origin function
   * @param keys batch keys
   * @param keyField key field name for detacting missing data
   * @param expire normal data expire
   * @param ext ext options
   */
  async batchGetArray<U = any, T = string>(
    group: string,
    fn: OriginArrayFn<U, T>,
    keys: T[],
    keyField: string,
    expire: number,
    ext?: number | ExtOps
  ): Promise<U[]> {
    const f = async (keys: T[]) => {
      const res = await fn(keys)
      return toMap<U, T>(res, keyField, keys)
    }
    const res = await this.batchGet(group, f, keys, expire, ext)
    return toArrWithoutNon(res)
  }

  /**
   * get single data with cache
   * @param group cache group name
   * @param fn origin function
   * @param key key
   * @param expire normal data expire
   * @param ext ext options
   */
  async getOne<U = any, T = string>(
    group: string,
    fn: SingleFn<U, T>,
    key: T,
    expire: number,
    ext?: number | ExtOps
  ) {
    const f = async (keys: T[]) => {
      const res = await fn(keys[0])
      const mp = new Map<T, U>()
      mp.set(keys[0], res ? res : null)
      return mp
    }

    const res = await this.batchGet(group, f, [key], expire, ext)
    return res.get(key)
  }

  /**
   * cache a function response, ignore any params
   * @param group group here must be unique
   * @param fn void function you want to cache result
   * @param expire normal data expire
   * @param ext ext options
   */
  async cacheFn<U = any>(
    group: string,
    fn: () => Promise<U>,
    expire: number,
    ext?: number | ExtOps
  ): Promise<U> {
    const f = async (_: string[]) => {
      const res = await fn()
      const mp = new Map<string, U>()
      mp.set(cacheFnHackKey, res ? res : null)
      return mp
    }

    const res = await this.batchGet(group, f, [cacheFnHackKey], expire, ext)
    return res.get(cacheFnHackKey)
  }

  async clear<T = string>(group: string, keys: T[]) {
    this.incrCounter(deleteCounter, keys.length)
    return this.client.del(
      ...keys.map(k =>
        RedisCache.buildCacheKey(this.opts.keyPrefix, group, k as any)
      )
    )
  }

  getRealRedisKey(group: string, cacheKey: string) {
    return RedisCache.buildCacheKey(this.opts.keyPrefix, group, cacheKey)
  }

  getRealCacheFnRedisKey(group: string) {
    return RedisCache.buildCacheKey(this.opts.keyPrefix, group, cacheFnHackKey)
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

  private setupPrometheus() {
    if (!this.opts.withPrometheus) {
      return
    }

    requestsCounter = new promClient.Counter({
      name: 'cache_requests_total',
      help: 'Total number of requests to the cache.'
    })

    hitCounter = new promClient.Counter({
      name: 'cache_hits_total',
      help: 'Total number of requests to the cache that were a hit.'
    })

    nonExistsCounter = new promClient.Counter({
      name: 'cache_non_exists_total',
      help: 'Total number of requests to the cache that record not exists.'
    })

    deleteCounter = new promClient.Counter({
      name: 'cache_delete_total',
      help: 'Total number of items that were deleted from the index cache.'
    })
  }

  private incrCounter(counter: any, val: number) {
    if (!counter || val <= 0) {
      return
    }
    counter.inc(val)
  }

  static buildCacheKey(...keys: string[]) {
    return keys.filter(Boolean).join(':')
  }
}
