export const toArr = <U = any, T = string>(mp: Map<T, U>): U[] => {
  return [...mp.values()]
}

export const toArrWithoutNon = <U = any, T = string>(mp: Map<T, U>): U[] => {
  return toArr(mp).filter(Boolean)
}

export const toMap = <U = any, T = string>(
  mp: U[],
  field: string,
  keys: T[]
): Map<T, U> => {
  const res = new Map<T, U>()
  mp.forEach(m => {
    res.set((m as any)[field], m)
  })
  keys.forEach(k => {
    if (!res.has(k)) {
      res.set(k, null)
    }
  })
  return res
}

const MISSING_REQUIRED_DEPENDENCY = (name: string, reason: string) =>
  `The "${name}" package is missing. Please, make sure to install this library ($ npm install ${name}) to take advantage of ${reason}.`

export const loadPackage = (
  packageName: string,
  context: string,
  loaderFn?: Function
) => {
  try {
    return loaderFn ? loaderFn() : require(packageName)
  } catch (e) {
    console.error(MISSING_REQUIRED_DEPENDENCY(packageName, context))
    process.exit(1)
  }
}
