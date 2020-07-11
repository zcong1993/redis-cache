# redis-cache

[![NPM version](https://img.shields.io/npm/v/@zcong/redis-cache.svg?style=flat)](https://npmjs.com/package/@zcong/redis-cache) [![NPM downloads](https://img.shields.io/npm/dm/@zcong/redis-cache.svg?style=flat)](https://npmjs.com/package/@zcong/redis-cache) [![CircleCI](https://circleci.com/gh/zcong1993/redis-cache/tree/master.svg?style=shield)](https://circleci.com/gh/zcong1993/redis-cache/tree/master) [![codecov](https://codecov.io/gh/zcong1993/redis-cache/branch/master/graph/badge.svg)](https://codecov.io/gh/zcong1993/redis-cache)

## Install

```bash
$ yarn add @zcong/redis-cache
# or
$ npm i @zcong/redis-cache --save
```

## Usage

see [./src/example.ts](./src/example.ts)

```ts
const rc = new RedisCache({ client: new Redis(), nonExistsExpire: 100 })

// cache map result: keys -> Map<key, value>
const mapFn = async (keys: string[]): Promise<Map<string, Res>> => {
  const mp = new Map<string, Res>()
  keys.forEach((k) => {
    mp.set(k, genRes(k))
  })
  return mp
}
// cache result 1000s
await rc.batchGet('test-map', mapFn, ['test1', 'test2'], 1000)

// cache array result: keys -> [{ key, value }]
const arrFn = async (keys: string[]): Promise<Res[]> => {
  await sleep(1000)
  return keys.map(genRes)
}

await rc.batchGetArray('test', arrFn, ['test1', 'test2'], 'k', 1000)

// get one, key => result
const singleFn = async (key: string): Promise<Res> => {
  await sleep(1000)
  return genRes(key)
}

await rc.getOne('single', singleFn, 'test', 1000)

// cache void function result: () => result
const fn = async (): Promise<Res> => {
  await sleep(1000)
  return genRes('test')
}

await rc.cacheFn('fn-test', fn, 1000)
```

## License

MIT &copy; zcong1993
