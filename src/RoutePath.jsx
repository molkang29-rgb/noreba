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
        const isLast =
          index === stations.length - 1

        const outgoingSegment =
          segments.find(
            (item) =>
              !item.transfer &&
              (
                item.from?.id === station.id ||
                item.from === station.id
              )
          )

        const incomingSegment =
          [...segments]
            .reverse()
            .find(
              (item) =>
                item.to?.id === station.id ||
                item.to === station.id
            )

        const stationTime =
          isLast
            ? incomingSegment?.arrivalTime
            : outgoingSegment?.departureTime ||
              incomingSegment?.arrivalTime

        const segment =
          segments[index]

        const previousSegment =
          index > 0
            ? segments[index - 1]
            : null

        const isDirectTransfer =
          Boolean(
            segment?.transfer &&
            previousSegment &&
            segment?.tripId &&
            segment?.tripId ===
              previousSegment?.tripId
          )

        const showTrainInfo =
          index === 0 ||
          (
            segment?.transfer &&
            !isDirectTransfer
          ) ||
          (
            segment?.tripId &&
            segment?.tripId !==
              previousSegment?.tripId
          )

        return (
          <div
            className="route-path-item"
            key={`${station.id}-${index}`}
          >
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

            {!isLast && segment && (
              <div className="route-path-segment">
                <div
                  className="route-path-line"
                  style={{
                    backgroundColor:
                      segment.transfer
                        ? '#d9dde3'
                        : (
                            segment.line?.color ||
                            '#d9dde3'
                          ),
                  }}
                />

                <div className="route-path-train">
                  {segment.transfer ? (
                    <div className="route-path-train-info">
                      <span>
                        도보 환승
                      </span>
                    </div>
                  ) : (
                    showTrainInfo && (
                      <div className="route-path-train-info">
                        <span>
                          {segment.serviceType || '열차'}
                        </span>

                        {segment.destination && (
                          <span>
                            {' · '}
                            {segment.destination}행
                          </span>
                        )}
                      </div>
                    )
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