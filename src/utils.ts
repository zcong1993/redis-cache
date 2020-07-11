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
  mp.forEach((m) => {
    res.set((m as any)[field], m)
  })
  keys.forEach((k) => {
    if (!res.has(k)) {
      res.set(k, null)
    }
  })
  return res
}
