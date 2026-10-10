import { useState } from 'react'

function RoutePath({ route }) {
  const [expandedGroups, setExpandedGroups] = useState(() => new Set())

  if (!route) return null

  const stations = route.stations || []
  const segments = route.segments || []

  if (stations.length === 0) {
    return null
  }

  // Emphasize endpoints and both sides of a transfer. Some routes use an
  // explicit walking connector; others change lines at the same station.
  const isTransferStationAt = (stationIndex) => {
    const incoming = segments[stationIndex - 1]
    const outgoing = segments[stationIndex]

    if (incoming?.transfer || outgoing?.transfer) return true

    return Boolean(
      incoming?.lineId != null &&
      outgoing?.lineId != null &&
      String(incoming.lineId) !== String(outgoing.lineId),
    )
  }

  const isKeyStationAt = (stationIndex) =>
    stationIndex === 0 ||
    stationIndex === stations.length - 1 ||
    isTransferStationAt(stationIndex)

  const routeIdentity = route.routeKey || [
    stations.map((station) => station.id).join('>'),
    segments.map((segment) => segment.transfer ? 'walk' : String(segment.lineId ?? '?')).join('>'),
  ].join('|')

  // Only fold a section if it contains at least two pass-through stations
  // and all connecting edges belong to the same train line. Endpoints and
  // transfer stations therefore always remain visible.
  const keyStationIndices = []
  for (let index = 0; index < stations.length; index += 1) {
    if (isKeyStationAt(index)) keyStationIndices.push(index)
  }

  const foldGroupsByStart = new Map()
  const foldGroupsByLastIntermediate = new Map()
  const foldGroupByStationIndex = new Map()

  for (let index = 0; index < keyStationIndices.length - 1; index += 1) {
    const startIndex = keyStationIndices[index]
    const endIndex = keyStationIndices[index + 1]
    const intermediateCount = endIndex - startIndex - 1
    if (intermediateCount < 2) continue

    const groupSegments = segments.slice(startIndex, endIndex)
    const firstLineId = groupSegments[0]?.lineId
    const isSingleRideLine = Boolean(
      groupSegments.length === endIndex - startIndex &&
      firstLineId != null &&
      groupSegments.every((segment) =>
        !segment.transfer &&
        segment.lineId != null &&
        String(segment.lineId) === String(firstLineId),
      ),
    )
    if (!isSingleRideLine) continue

    const group = {
      startIndex,
      endIndex,
      lastIntermediateIndex: endIndex - 1,
      count: intermediateCount,
      key: `${routeIdentity}:${startIndex}-${endIndex}`,
      lineColor: groupSegments[0]?.line?.color || '#d9dde3',
    }
    foldGroupsByStart.set(startIndex, group)
    foldGroupsByLastIntermediate.set(group.lastIntermediateIndex, group)
    for (let stationIndex = startIndex + 1; stationIndex < endIndex; stationIndex += 1) {
      foldGroupByStationIndex.set(stationIndex, group)
    }
  }

  const toggleGroup = (group) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(group.key)) next.delete(group.key)
      else next.add(group.key)
      return next
    })
  }

  return (
    <div className="route-path">
      {stations.map((station, index) => {
        const hiddenInGroup = foldGroupByStationIndex.get(index)
        if (hiddenInGroup && !expandedGroups.has(hiddenInGroup.key)) {
          return null
        }

        const isLast = index === stations.length - 1
        const isTransferStation = isTransferStationAt(index)
        const isKeyStation = isKeyStationAt(index)
        const nextStationIsKey =
          index < stations.length - 1 && isKeyStationAt(index + 1)

        const outgoingSegment = segments.find(
          (item) =>
            !item.transfer &&
            (item.from?.id === station.id || item.from === station.id),
        )

        const incomingSegment = [...segments].reverse().find(
          (item) => item.to?.id === station.id || item.to === station.id,
        )

        const stationTime = isLast
          ? incomingSegment?.arrivalTime
          : outgoingSegment?.departureTime || incomingSegment?.arrivalTime
        const stationTimeDayOffset = isLast
          ? incomingSegment?.arrivalDayOffset
          : outgoingSegment?.departureTime
            ? outgoingSegment?.departureDayOffset
            : incomingSegment?.arrivalDayOffset

        const stationTimeLabel = stationTimeDayOffset < 0
          ? `전날 ${stationTime}`
          : stationTimeDayOffset > 0
            ? `다음 날 ${stationTime}`
            : stationTime

        const segment = segments[index]
        const previousSegment = index > 0 ? segments[index - 1] : null
        const isDirectTransfer = Boolean(
          segment?.transfer &&
          previousSegment &&
          segment?.tripId &&
          segment?.tripId === previousSegment?.tripId,
        )

        const showTrainInfo =
          index === 0 ||
          (segment?.transfer && !isDirectTransfer) ||
          (segment?.tripId && segment?.tripId !== previousSegment?.tripId)

        const foldGroupStartingHere = foldGroupsByStart.get(index)
        const isFoldedGroup =
          foldGroupStartingHere && !expandedGroups.has(foldGroupStartingHere.key)
        const foldGroupEndingHere = foldGroupsByLastIntermediate.get(index)
        const isExpandedGroupEnd =
          foldGroupEndingHere && expandedGroups.has(foldGroupEndingHere.key)

        return (
          <div
            className={`route-path-item ${
              isKeyStation ? 'is-key-station' : 'is-intermediate-station'
            }`}
            key={`${station.id}-${index}`}
          >
            <div className="route-path-station">
              <span
                className={`route-path-dot${isLast ? ' end' : ''}${
                  isTransferStation ? ' transfer' : ''
                }`}
              />

              <div className="route-path-station-text">
                <div className="route-path-station-name">
                  <strong
                    className={
                      isKeyStation
                        ? 'route-path-station-name-main'
                        : 'route-path-station-name-middle'
                    }
                  >
                    {station.name}
                  </strong>

                  {isDirectTransfer && (
                    <small className="direct-transfer">직결환승</small>
                  )}
                </div>

                {station.japanese && (
                  <span className="route-path-station-japanese">{station.japanese}</span>
                )}

                {stationTime && (
                  isFoldedGroup && showTrainInfo && !segment?.transfer ? (
                    <div className="route-path-time-service-row">
                      <span className="route-path-station-time">{stationTimeLabel}</span>
                      <div className="route-path-train-info route-path-train-info-folded">
                        <span>{segment.serviceType || '열차'}</span>
                        {segment.destination && <span>{' · '}{segment.destination}행</span>}
                      </div>
                    </div>
                  ) : (
                    <span className="route-path-station-time">{stationTimeLabel}</span>
                  )
                )}
              </div>
            </div>

            {!isLast && segment && (
              <div
                className={`route-path-segment${
                  isKeyStation && nextStationIsKey ? '' : ' compact'
                }${isFoldedGroup ? ' route-path-segment-folded' : ''}`}
              >
                <div
                  className="route-path-line"
                  style={{
                    backgroundColor: isFoldedGroup
                      ? foldGroupStartingHere.lineColor
                      : segment.transfer
                        ? '#d9dde3'
                        : segment.line?.color || '#d9dde3',
                  }}
                />

                {isFoldedGroup ? (
                  <div className="route-path-train route-path-fold-container">
                    {/* Boarding time and train information are paired above; keep the fold action on its own row. */}
                    <button
                      type="button"
                      className="route-path-fold-toggle"
                      aria-expanded="false"
                      onClick={() => toggleGroup(foldGroupStartingHere)}
                    >
                      <span>중간역 {foldGroupStartingHere.count}개 펼치기</span>
                      <span className="route-path-fold-icon" aria-hidden="true">⌄</span>
                    </button>
                  </div>
                ) : (
                  <div className="route-path-train">
                    {segment.transfer ? (
                      <div className="route-path-train-info">
                        <span>
                          도보 환승 · {segment.durationIsEstimate ? '약 ' : ''}{segment.duration}분
                        </span>
                      </div>
                    ) : (
                      showTrainInfo && (
                        <div className="route-path-train-info">
                          <span>{segment.serviceType || '열차'}</span>
                          {segment.destination && <span>{' · '}{segment.destination}행</span>}
                        </div>
                      )
                    )}

                    {isExpandedGroupEnd && (
                      <button
                        type="button"
                        className="route-path-fold-toggle route-path-fold-toggle-collapse"
                        aria-expanded="true"
                        onClick={() => toggleGroup(foldGroupEndingHere)}
                      >
                        <span>중간역 접기</span>
                        <span className="route-path-fold-icon is-expanded" aria-hidden="true">⌃</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default RoutePath
