function RoutePath({ route }) {
  if (!route) return null

  const stations = route.stations || []
  const segments = route.segments || []

  if (stations.length === 0) {
    return null
  }

  return (
    <div className="route-path">
      {stations.map((station, index) => {
        const segment = segments[index]
        const previousSegment =
          index > 0
            ? segments[index - 1]
            : null

        const isLast =
          index === stations.length - 1

        const isDirectTransfer =
          Boolean(
            segment?.transfer &&
            previousSegment &&
            segment?.tripId ===
              previousSegment?.tripId
          )

        const showTrainInfo =
          index === 0 ||
          (
            segment?.transfer &&
            !isDirectTransfer
          ) ||
          segment?.tripId !==
            previousSegment?.tripId

        /*
         * 역에 표시할 시각
         *
         * 마지막 역:
         *   이전 구간의 도착 시각
         *
         * 그 외:
         *   현재 역에서 출발하는 시각
         */
        const stationTime =
          isLast
            ? previousSegment?.arrivalTime
            : segment?.departureTime

        return (
          <div
            className="route-path-item"
            key={`${station.id}-${index}`}
          >
            {/* 역 */}
            <div className="route-path-station">
              <span
                className={
                  isLast
                    ? 'route-path-dot end'
                    : 'route-path-dot'
                }
              />

              <div className="route-path-station-text">
                <div className="route-path-station-name">
                  <strong
  className={
    index === 0 || isLast
      ? 'route-path-station-name-main'
      : 'route-path-station-name-middle'
  }
>
  {station.name}
</strong>

                  {isDirectTransfer && (
                    <small className="direct-transfer">
                      직결환승
                    </small>
                  )}
                </div>

                {station.japanese && (
                  <span className="route-path-station-japanese">
                    {station.japanese}
                  </span>
                )}

                {stationTime && (
                  <span className="route-path-station-time">
                    {stationTime}
                  </span>
                )}
              </div>
            </div>

            {/* 다음 역으로 이동 */}
            {!isLast && segment && (
              <div className="route-path-segment">
                <div
                  className="route-path-line"
                  style={{
                    backgroundColor:
                      segment.line?.color ||
                      '#d9dde3',
                  }}
                />

                <div className="route-path-train">
                  {showTrainInfo && (
                    <div className="route-path-train-info">
                      <span>
                        {segment.serviceType ||
                          '열차'}
                      </span>

                      {segment.destination && (
                        <span>
                          {' · '}
                          {segment.destination}행
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default RoutePath