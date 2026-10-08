import network from './network'
import lines from './lines'
import stations from './stations'

function findPaths(
  startId,
  endId,
  maxStops = 5
) {
  const results = []

  const queue = [
    {
      stationId: startId,
      path: [],
      visited: [startId],
    },
  ]

  while (queue.length > 0) {
    const current = queue.shift()

    if (current.stationId === endId) {
      if (current.path.length > 0) {
        results.push(current.path)
      }

      continue
    }

    if (current.path.length >= maxStops) {
      continue
    }

    const connections =
      network[current.stationId] || []

    for (const connection of connections) {
      if (
        current.visited.includes(
          connection.to
        )
      ) {
        continue
      }

      queue.push({
        stationId: connection.to,

        path: [
          ...current.path,
          connection,
        ],

        visited: [
          ...current.visited,
          connection.to,
        ],
      })
    }
  }

  return results
}

function makeRoute(
  path,
  fromStation,
  toStation
) {
  let duration = 0
  let fare = 0

  const lineIds = []

  for (const connection of path) {
    duration += connection.duration
    fare += connection.fare

    if (
      !lineIds.includes(connection.lineId)
    ) {
      lineIds.push(connection.lineId)
    }
  }

  let transfers = 0
  let transferStation = null

  for (let i = 1; i < path.length; i++) {
    if (
      path[i].lineId !==
      path[i - 1].lineId
    ) {
      transfers += 1

      const stationId =
        path[i - 1].to

      transferStation =
        stations.find(
          (station) =>
            station.id === stationId
        ) || null
    }
  }

  return {
    type:
      transfers === 0
        ? 'direct'
        : 'transfer',

    from: fromStation,
    to: toStation,

    duration,
    fare,
    transfers,

    transferStation,

    lines: lineIds.map(
      (lineId) => lines[lineId]
    ),

    path,
  }
}

export function calculateRoutes(
  fromStation,
  toStation
) {
  if (
    fromStation.id ===
    toStation.id
  ) {
    return [
      {
        type: 'same-station',
        from: fromStation,
        to: toStation,
        duration: 0,
        fare: 0,
        transfers: 0,
        transferStation: null,
        lines: [],
        path: [],
      },
    ]
  }

  const paths = findPaths(
    fromStation.id,
    toStation.id
  )

  return paths.map((path) =>
    makeRoute(
      path,
      fromStation,
      toStation
    )
  )
}