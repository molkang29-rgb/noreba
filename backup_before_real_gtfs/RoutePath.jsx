import stations from './stations'
import lines from './lines'

function getStation(id) {
  return stations.find(
    (station) => station.id === id
  ) || null
}

function getLine(lineId) {
  return lines[lineId] || null
}

export default function RoutePath({ route }) {
  if (!route.path || route.path.length === 0) {
    return null
  }

  return (
    <div className="route-path">
      {/* 출발역 */}
      <div className="route-stop">
        <span className="route-stop-dot"></span>

        <div className="route-stop-content">
          <strong>{route.from.name}</strong>
          <span>{route.from.japanese}</span>
        </div>
      </div>

      {route.path.map((connection, index) => {
        const line = getLine(connection.lineId)
        const station = getStation(connection.to)

        const isLast =
          index === route.path.length - 1

        return (
          <div
            className="route-segment"
            key={`${connection.to}-${index}`}
          >
            {/* 이동 정보 */}
            <div
              className="route-segment-line"
              style={{
                borderLeftColor:
                  line?.color || '#d1d5db',
              }}
            >
              <div className="route-line-info">
                <span
                  className="route-line-icon"
                  style={{
                    borderColor:
                      line?.color || '#999',
                  }}
                >
                  {line?.code || '●'}
                </span>

                <div className="route-line-main">
                  <strong>
                    {line?.name || connection.lineId}
                  </strong>

                  <span>
                    {connection.duration}분
                  </span>
                </div>
              </div>

              <div className="route-train-info">
                <span className="route-train-time">
                  {connection.departureTime || '--:--'}
                </span>

                <span className="route-train-type">
                  {connection.serviceType || '일반'}
                </span>

                <span className="route-train-destination">
                  {connection.destination
                    ? `${connection.destination}행`
                    : `${station?.name || ''}행`}
                </span>
              </div>
            </div>

            {/* 다음 역 */}
            {station && (
              <div className="route-stop route-next-stop">
                <span
                  className={
                    `route-stop-dot ${
                      isLast ? 'end' : ''
                    }`
                  }
                ></span>

                <div className="route-stop-content">
                  <strong>{station.name}</strong>
                  <span>{station.japanese}</span>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}