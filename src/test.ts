import * as Redis from 'ioredis'
import { RedisCache } from './cache'

const client = new Redis()

const rc = new RedisCache({ client, nonExistsExpire: 100 })

const sleep = (n: number) => new Promise(r => setTimeout(r, n))

const arrFn = async (keys: string[]) => {
  return keys.slice(1).map(k => ({ k, res: `${k}-res` }))
}

const main = async () => {
  const res = await Promise.all(
    Array(10)
      .fill(null)
      .map(() => rc.batchGetArray('test', arrFn, ['test1', 'test2'], 'k', 1000))
  )
  console.log(res, rc.stats)
}

main()
