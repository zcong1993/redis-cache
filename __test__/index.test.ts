import * as Redis from 'ioredis'
import { RedisCache } from '../src'

const redis = new Redis(process.env.REDIS_URI)

const sleep = (n: number) => new Promise((r) => setTimeout(r, n))

beforeEach(async () => {
  await redis.flushdb()
})

const mockResByKey = (k: string) => ({
  k,
  value: `${k}-res`,
})

it('batchGet should work well', async () => {
  const rc = new RedisCache({ client: redis })
  const batchFn = async (keys: string[]) => {
    await sleep(100)
    const res = new Map()
    keys.forEach((k) => {
      res.set(k, mockResByKey(k))
    })
    return res
  }

  const testKeys: string[] = ['a', 'b', 'c']
  const directRes = await batchFn(testKeys)
  const batchFnWrapper = jest.fn(batchFn)

  for (let i = 0; i < 10; i += 1) {
    const res = await rc.batchGet(
      'test-batchGet-1',
      batchFnWrapper,
      testKeys,
      10
    )
    expect(res).toEqual(directRes)
  }

  for (let i = 0; i < 10; i += 1) {
    // test subset keys should be cached and not call origin fn
    await rc.batchGet('test-batchGet-1', batchFnWrapper, testKeys.slice(1), 10)
  }

  expect(batchFnWrapper).toBeCalledTimes(1)

  for (const k of testKeys) {
    expect(await redis.get(`test-batchGet-1:${k}`)).not.toBeNull()
  }
})

it('batchGetArray should work well', async () => {
  const rc = new RedisCache({ client: redis })
  const batchArrFn = async (keys: string[]) => {
    await sleep(100)
    return keys.map(mockResByKey)
  }

  const testKeys: string[] = ['a', 'b', 'c']
  const directRes = await batchArrFn(testKeys)
  const batchFnWrapper = jest.fn(batchArrFn)

  for (let i = 0; i < 10; i += 1) {
    const res = await rc.batchGetArray(
      'test-batchGetArray-1',
      batchFnWrapper,
      testKeys,
      'k',
      10
    )
    expect(res).toEqual(directRes)
  }

  for (let i = 0; i < 10; i += 1) {
    // test subset keys should be cached and not call origin fn
    await rc.batchGetArray(
      'test-batchGetArray-1',
      batchFnWrapper,
      testKeys.slice(1),
      'k',
      10
    )
  }

  expect(batchFnWrapper).toBeCalledTimes(1)
  // test stats
  expect(rc.stats).toEqual({ hit: 47, missing: 3, nonExists: 0 })
})

it('getOne should work well', async () => {
  const rc = new RedisCache({ client: redis })
  const getOneFn = async (key: string) => {
    await sleep(100)
    return mockResByKey(key)
  }

  const testKey: string = 'a'
  const directRes = await getOneFn(testKey)
  const batchFnWrapper = jest.fn(getOneFn)

  for (let i = 0; i < 10; i += 1) {
    const res = await rc.getOne('test-getOne-1', batchFnWrapper, testKey, 10)
    expect(res).toEqual(directRes)
  }

  expect(batchFnWrapper).toBeCalledTimes(1)

  // test clear
  await rc.clear('test-getOne-1', [testKey])
  for (let i = 0; i < 10; i += 1) {
    const res = await rc.getOne('test-getOne-1', batchFnWrapper, testKey, 10)
    expect(res).toEqual(directRes)
  }

  expect(batchFnWrapper).toBeCalledTimes(2)
})

it('cacheFn should work well', async () => {
  const rc = new RedisCache({ client: redis })
  const fn = async () => {
    await sleep(100)
    return mockResByKey('test')
  }

  const directRes = await fn()
  const batchFnWrapper = jest.fn(fn)

  for (let i = 0; i < 10; i += 1) {
    const res = await rc.cacheFn('test-cacheFn-1', batchFnWrapper, 10)
    expect(res).toEqual(directRes)
  }

  expect(batchFnWrapper).toBeCalledTimes(1)
})

it('nonExists should work well', async () => {
  const nonExistKey: string = 'nonExistKey'
  const rc = new RedisCache({ client: redis, nonExistsExpire: 5 })
  const batchFn = async (keys: string[]) => {
    await sleep(100)
    const res = new Map()
    keys.forEach((k) => {
      if (k === nonExistKey) {
        res.set(k, null)
      } else {
        res.set(k, mockResByKey(k))
      }
    })
    return res
  }

  const testKeys: string[] = ['a', 'b', 'c', nonExistKey]
  const directRes = await batchFn(testKeys)
  const batchFnWrapper = jest.fn(batchFn)

  for (let i = 0; i < 10; i += 1) {
    const res = await rc.batchGet(
      'test-batchGet-1',
      batchFnWrapper,
      testKeys,
      10
    )
    expect(res).toEqual(directRes)
  }

  for (let i = 0; i < 10; i += 1) {
    // test subset keys should be cached and not call origin fn
    await rc.batchGet(
      'test-batchGet-1',
      batchFnWrapper,
      testKeys.slice(1),
      10,
      5
    )
    // new options
    await rc.batchGet(
      'test-batchGet-1',
      batchFnWrapper,
      testKeys.slice(1),
      10,
      { nonExistsExpire: 5 }
    )
  }

  expect(batchFnWrapper).toBeCalledTimes(1)
})

it('custom nonExists value should work well', async () => {
  const nonExistKey: string = 'nonExistKey'
  const customNonExistsVal: string = '!!-1'
  const rc = new RedisCache({
    client: redis,
    nonExistsExpire: 5,
    nonExistsValue: customNonExistsVal,
  })
  const batchFn = async (keys: string[]) => {
    await sleep(100)
    const res = new Map()
    keys.forEach((k) => {
      if (k === nonExistKey) {
        res.set(k, null)
      } else {
        res.set(k, mockResByKey(k))
      }
    })
    return res
  }

  const testKeys: string[] = ['a', 'b', 'c', nonExistKey]
  const directRes = await batchFn(testKeys)
  const batchFnWrapper = jest.fn(batchFn)

  for (let i = 0; i < 10; i += 1) {
    const res = await rc.batchGet(
      'test-batchGet-1',
      batchFnWrapper,
      testKeys,
      10
    )
    expect(res).toEqual(directRes)
  }

  for (let i = 0; i < 10; i += 1) {
    // test subset keys should be cached and not call origin fn
    await rc.batchGet(
      'test-batchGet-1',
      batchFnWrapper,
      testKeys.slice(1),
      10,
      5
    )
    // new options
    await rc.batchGet(
      'test-batchGet-1',
      batchFnWrapper,
      testKeys.slice(1),
      10,
      { nonExistsExpire: 5 }
    )
  }

  expect(batchFnWrapper).toBeCalledTimes(1)
  expect(await redis.get(`test-batchGet-1:${nonExistKey}`)).toBe(
    customNonExistsVal
  )
})

it('non JSON should works well', async () => {
  const rc = new RedisCache({ client: redis })
  const batchFn = async (keys: string[]) => {
    await sleep(100)
    const res = new Map()
    keys.forEach((k) => {
      res.set(k, `key-${k}`)
    })
    return res
  }

  const testKeys: string[] = ['a', 'b', 'c']
  const directRes = await batchFn(testKeys)
  const batchFnWrapper = jest.fn(batchFn)

  for (let i = 0; i < 10; i += 1) {
    const res = await rc.batchGet(
      'test-batchGet-1',
      batchFnWrapper,
      testKeys,
      10
    )
    expect(res).toEqual(directRes)
  }
})

it('keyPrefix options should works well', async () => {
  const rc = new RedisCache({ client: redis, keyPrefix: 'test' })
  const batchFn = async (keys: string[]) => {
    await sleep(100)
    const res = new Map()
    keys.forEach((k) => {
      res.set(k, mockResByKey(k))
    })
    return res
  }

  const testKeys: string[] = ['a', 'b', 'c']
  const directRes = await batchFn(testKeys)
  const batchFnWrapper = jest.fn(batchFn)

  for (let i = 0; i < 10; i += 1) {
    const res = await rc.batchGet(
      'test-batchGet-1',
      batchFnWrapper,
      testKeys,
      10
    )
    expect(res).toEqual(directRes)
  }

  for (const k of testKeys) {
    expect(await redis.get(`test:test-batchGet-1:${k}`)).not.toBeNull()
  }
})
