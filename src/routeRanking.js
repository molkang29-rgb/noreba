const MAX_VISIBLE_ROUTES = 3

function finite(value, fallback = Infinity) {
  if (value == null || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function fareOf(route) {
  const value = route?.fare?.icFare
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value)
}

function walkOf(route) {
  return finite(route?.transferWalkSeconds, 0)
}

function canonicalFallbackKey(route) {
  if (Array.isArray(route?.segments) && route.segments.length) {
    return route.segments.map((segment) => [
      segment.transfer ? 'WALK' : 'RIDE',
      segment.lineId ?? '',
      segment.from?.id ?? segment.fromStationId ?? '',
      segment.to?.id ?? segment.toStationId ?? '',
    ].join(':')).join('|')
  }
  return [
    (route?.lines || []).map((line) => line.id ?? line).join('>'),
    (route?.stations || []).map((station) => station.id ?? station).join('>'),
  ].join('|')
}

function routeKeyOf(route) {
  return route?.routeKey || canonicalFallbackKey(route)
}

// Different transfer stations can produce nearly identical itineraries with
// the same ordered line sequence. Near-duplicate pruning happens only after
// strict Pareto filtering and requires the same corridor shape, transfer count,
// connection time, and a small duration difference. If one fare is missing,
// prefer the known-fare copy only when the paths are otherwise near-identical.
function sameLineSequence(a, b) {
  const linesA = (a?.lines || []).map((line) => line.id ?? line).join('>')
  const linesB = (b?.lines || []).map((line) => line.id ?? line).join('>')
  return linesA !== '' && linesA === linesB
}

function rideRuns(route) {
  const segments = Array.isArray(route?.segments) ? route.segments : []
  const runs = []
  for (const segment of segments) {
    if (segment.transfer || segment.lineId == null) continue
    const lineId = String(segment.lineId)
    const fromId = String(segment.from?.id ?? segment.fromStationId ?? '')
    const toId = String(segment.to?.id ?? segment.toStationId ?? '')
    let run = runs[runs.length - 1]
    if (!run || run.lineId !== lineId) {
      run = { lineId, nodes: [fromId] }
      runs.push(run)
    }
    if (run.nodes[run.nodes.length - 1] !== toId) run.nodes.push(toId)
  }
  return runs
}

function isPrefixOf(shorter, longer) {
  return shorter.length <= longer.length && shorter.every((value, index) => value === longer[index])
}

function isSuffixOf(shorter, longer) {
  if (shorter.length > longer.length) return false
  return shorter.every((value, index) => value === longer[longer.length - shorter.length + index])
}

// Near-duplicate pruning should collapse different transfer points on the same
// corridor, but preserve alternatives whose actual stop sequence branches.
function sameCorridorExceptTransferPoints(a, b) {
  const runsA = rideRuns(a)
  const runsB = rideRuns(b)
  if (!runsA.length || !runsB.length) return true // Ranking-only fixtures may not contain segments.
  if (runsA.length !== runsB.length) return false
  if (runsA.some((run, index) => run.lineId !== runsB[index].lineId)) return false
  if (runsA.length === 1) return runsA[0].nodes.join('>') === runsB[0].nodes.join('>')

  for (let index = 0; index < runsA.length; index += 1) {
    const nodesA = runsA[index].nodes
    const nodesB = runsB[index].nodes
    if (index === 0) {
      // The start is fixed; differences at the end can be transfer-point shifts.
      const coreA = nodesA.slice(0, -1)
      const coreB = nodesB.slice(0, -1)
      if (!isPrefixOf(coreA, coreB) && !isPrefixOf(coreB, coreA)) return false
    } else if (index === runsA.length - 1) {
      // The destination is fixed; differences at the beginning can be transfer-point shifts.
      const coreA = nodesA.slice(1)
      const coreB = nodesB.slice(1)
      if (!isSuffixOf(coreA, coreB) && !isSuffixOf(coreB, coreA)) return false
    } else {
      const coreA = nodesA.slice(1, -1)
      const coreB = nodesB.slice(1, -1)
      if (coreA.join('>') !== coreB.join('>')) return false
    }
  }
  return true
}

function nearDuplicateRoute(a, b) {
  const fareA = fareOf(a)
  const fareB = fareOf(b)
  const durationA = finite(a?.duration)
  const durationB = finite(b?.duration)
  const faresCompatible = fareA == null || fareB == null || fareA === fareB
  return sameLineSequence(a, b) &&
    sameCorridorExceptTransferPoints(a, b) &&
    finite(a?.transfers, 0) === finite(b?.transfers, 0) &&
    faresCompatible &&
    Math.abs(durationA - durationB) <= 2 &&
    walkOf(a) === walkOf(b)
}

function compareFare(a, b) {
  const fareA = fareOf(a)
  const fareB = fareOf(b)
  if (fareA == null && fareB == null) return 0
  if (fareA == null) return 1
  if (fareB == null) return -1
  return fareA - fareB
}

export function sortRoutes(routes, mode = 'fastest', timeMode = 'departure') {
  if (!Array.isArray(routes)) return []

  const sorted = [...routes]
  const byTime = (a, b) => {
    if (timeMode === 'arrival') {
      return finite(b.departureSeconds, -Infinity) - finite(a.departureSeconds, -Infinity) ||
        finite(a.arrivalSeconds) - finite(b.arrivalSeconds)
    }
    return finite(a.arrivalSeconds) - finite(b.arrivalSeconds) ||
      finite(a.departureSeconds) - finite(b.departureSeconds)
  }
  const byDuration = (a, b) => finite(a.duration) - finite(b.duration)
  const byTransfers = (a, b) => finite(a.transfers, 0) - finite(b.transfers, 0)
  const byWalk = (a, b) => walkOf(a) - walkOf(b)
  const byFare = (a, b) => compareFare(a, b)

  if (mode === 'fastest') {
    return sorted.sort((a, b) => byDuration(a, b) || byTransfers(a, b) || byTime(a, b) || byWalk(a, b) || byFare(a, b))
  }
  if (mode === 'fewest-transfers') {
    return sorted.sort((a, b) => byTransfers(a, b) || byDuration(a, b) || byTime(a, b) || byWalk(a, b) || byFare(a, b))
  }
  if (mode === 'cheapest') {
    return sorted.sort((a, b) => byFare(a, b) || byTransfers(a, b) || byDuration(a, b) || byTime(a, b) || byWalk(a, b))
  }
  if (mode === 'latest-departure') {
    return sorted.sort((a, b) => finite(b.departureSeconds, -Infinity) - finite(a.departureSeconds, -Infinity) ||
      finite(a.arrivalSeconds) - finite(b.arrivalSeconds) || byDuration(a, b) || byTransfers(a, b) || byFare(a, b))
  }
  return sorted.sort((a, b) => byDuration(a, b) || byTransfers(a, b) || byTime(a, b) || byWalk(a, b) || byFare(a, b))
}

function dominates(a, b, timeMode = 'departure') {
  // Strict Pareto dominance only. A slightly slower route with fewer transfers
  // is a real trade-off, not grounds to remove the absolute fastest route from
  // the shared candidate set (especially from the “빠른순” tab).
  const durationA = finite(a.duration)
  const durationB = finite(b.duration)
  const transfersA = finite(a.transfers, 0)
  const transfersB = finite(b.transfers, 0)
  const walkA = walkOf(a)
  const walkB = walkOf(b)
  const fareA = fareOf(a)
  const fareB = fareOf(b)
  const faresBothKnown = fareA != null && fareB != null
  const faresBothUnknown = fareA == null && fareB == null
  // An unknown fare normally makes two paths incomparable. The narrow exception
  // is a route that is strictly faster, has strictly fewer transfers, and no
  // more walking; this avoids promoting obviously inferior, unpriced detours.
  const knownFareClearlyDominatesUnknown = fareA != null && fareB == null &&
    durationA < durationB && transfersA < transfersB && walkA <= walkB
  if (!faresBothKnown && !faresBothUnknown && !knownFareClearlyDominatesUnknown) return false
  const fareNoWorse = faresBothUnknown || knownFareClearlyDominatesUnknown || fareA <= fareB
  const leavesNoEarlier = timeMode !== 'arrival' ||
    finite(a.departureSeconds, -Infinity) >= finite(b.departureSeconds, -Infinity)
  const noWorse = durationA <= durationB &&
    transfersA <= transfersB &&
    walkA <= walkB &&
    fareNoWorse &&
    leavesNoEarlier
  const strictlyBetter = durationA < durationB ||
    transfersA < transfersB ||
    walkA < walkB ||
    (fareA != null && fareB != null && fareA < fareB) ||
    (timeMode === 'arrival' && finite(a.departureSeconds, -Infinity) > finite(b.departureSeconds, -Infinity))
  return noWorse && strictlyBetter
}

export function paretoRoutes(routes, timeMode = 'departure') {
  const byRouteKey = new Map()
  for (const route of routes || []) {
    const key = routeKeyOf(route)
    if (!byRouteKey.has(key)) {
      byRouteKey.set(key, route)
      continue
    }

    // Same physical route can be encountered more than once by the search.
    // Keep the best scheduled instance according to the active user-facing
    // metrics rather than whichever one happened to be generated first.
    const existing = byRouteKey.get(key)
    const candidateWins = dominates(existing, route, timeMode)
    const existingWins = dominates(route, existing, timeMode)
    if (existingWins && !candidateWins) byRouteKey.set(key, route)
    else if (!candidateWins && !existingWins) {
      const [best] = timeMode === 'arrival'
        ? [...[existing, route]].sort((a, b) =>
          finite(b.departureSeconds, -Infinity) - finite(a.departureSeconds, -Infinity) ||
          finite(b.arrivalSeconds, -Infinity) - finite(a.arrivalSeconds, -Infinity) ||
          finite(a.duration) - finite(b.duration) ||
          finite(a.transfers, 0) - finite(b.transfers, 0) ||
          walkOf(a) - walkOf(b) || compareFare(a, b))
        : sortRoutes([existing, route], 'fastest', timeMode)
      byRouteKey.set(key, best)
    }
  }

  const unique = [...byRouteKey.values()]
  const pareto = unique.filter((route, index) => !unique.some((other, otherIndex) =>
    index !== otherIndex && dominates(other, route, timeMode),
  ))

  // Suppress a near-identical same-line alternative that is up to two minutes
  // slower, with matching known fare (or one missing fare), transfer count, and
  // transfer-walking time. Keep the faster/known-fare variant; distinct stop
  // sequences and materially different transfer walks remain alternatives.
  return pareto.filter((route, index) => !pareto.some((other, otherIndex) => {
    if (index === otherIndex || !nearDuplicateRoute(other, route)) return false
    const otherDuration = finite(other.duration)
    const routeDuration = finite(route.duration)
    if (timeMode === 'arrival') {
      const otherDeparture = finite(other.departureSeconds, -Infinity)
      const routeDeparture = finite(route.departureSeconds, -Infinity)
      if (otherDeparture !== routeDeparture) return otherDeparture > routeDeparture
      const otherArrival = finite(other.arrivalSeconds, -Infinity)
      const routeArrival = finite(route.arrivalSeconds, -Infinity)
      if (otherArrival !== routeArrival) return otherArrival > routeArrival
    }
    if (otherDuration !== routeDuration) return otherDuration < routeDuration
    const otherFare = fareOf(other)
    const routeFare = fareOf(route)
    if (otherFare != null && routeFare == null) return true
    if (otherFare == null && routeFare != null) return false
    return routeKeyOf(other) < routeKeyOf(route)
  }))
}

/*
 * Keep at most three useful routes, not three arbitrary paths. First retain
 * the Pareto frontier, then reserve one slot for each distinct objective winner
 * so the fastest/fewest-transfers/cheapest tabs remain useful. Fewer than three results is intentional; do not pad the UI with low-value alternatives.
 */
export function selectUsefulRoutes(routes, timeMode = 'departure', maxResults = MAX_VISIBLE_ROUTES) {
  const limit = Math.max(0, Math.floor(Number(maxResults) || 0))
  if (limit === 0) return []

  const frontier = paretoRoutes(routes, timeMode)
  if (frontier.length <= limit) return sortRoutes(frontier, 'fastest', timeMode)

  const selected = new Map()
  const addBest = (mode) => {
    if (selected.size >= limit) return
    const best = sortRoutes(frontier, mode, timeMode)[0]
    if (best) selected.set(routeKeyOf(best), best)
  }

  // Preserve one winner for each visible sorting tab. Arrival mode's latest
  // feasible departure remains the tie-break within those objective sorters.
  addBest('fastest')
  addBest('fewest-transfers')
  if (frontier.some((route) => fareOf(route) != null)) addBest('cheapest')

  for (const route of sortRoutes(frontier, 'fastest', timeMode)) {
    if (selected.size >= limit) break
    selected.set(routeKeyOf(route), route)
  }

  return sortRoutes([...selected.values()], 'fastest', timeMode)
}
