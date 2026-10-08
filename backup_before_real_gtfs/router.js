import stations from './stations'
import { calculateRoutes } from './routeEngine'

function normalizeStationQuery(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/역$/, '')
    .replace(/えき$/, '')
}

export function searchStations(query) {
  const normalizedQuery =
    normalizeStationQuery(query)

  if (!normalizedQuery) {
    return []
  }

  return stations.filter((station) => {
    const name = station.name.toLowerCase()
    const japanese =
      station.japanese.toLowerCase()
    const romanized =
      station.romanized.toLowerCase()

    return (
      name.includes(normalizedQuery) ||
      japanese.includes(normalizedQuery) ||
      romanized.includes(normalizedQuery)
    )
  })
}

function findStation(name) {
  const results = searchStations(name)

  return (
    results.find(
      (station) =>
        station.name === name ||
        station.japanese === name ||
        station.romanized.toLowerCase() ===
          name.toLowerCase()
    ) ||
    results[0] ||
    null
  )
}

export function findRoutes(
  fromName,
  toName
) {
  const fromStation =
    findStation(fromName)

  const toStation =
    findStation(toName)

  if (!fromStation || !toStation) {
    return []
  }

  return calculateRoutes(
    fromStation,
    toStation
  )
}

export function sortRoutes(
  routes,
  mode
) {
  const sorted = [...routes]

  if (mode === 'fastest') {
    sorted.sort(
      (a, b) =>
        a.duration - b.duration
    )
  }

  if (mode === 'fewest-transfers') {
    sorted.sort((a, b) => {
      if (
        a.transfers !==
        b.transfers
      ) {
        return (
          a.transfers -
          b.transfers
        )
      }

      return (
        a.duration -
        b.duration
      )
    })
  }

  if (mode === 'cheapest') {
    sorted.sort((a, b) => {
      if (a.fare !== b.fare) {
        return a.fare - b.fare
      }

      return (
        a.duration -
        b.duration
      )
    })
  }

  return sorted
}