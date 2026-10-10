import { useState } from 'react'

import stations from './stations'
import meta from '../data/processed/meta.json'

import {
  findRoutes,
  sortRoutes,
  searchStations,
} from './router'

import RoutePath from './RoutePath'

function App() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [fromStationId, setFromStationId] = useState('')
  const [toStationId, setToStationId] = useState('')
  const [viaStations, setViaStations] = useState([])

  const [fromSelected, setFromSelected] = useState(false)
  const [toSelected, setToSelected] = useState(false)

  const tokyoDateTimeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const tokyoPart = (type) => tokyoDateTimeParts.find((part) => part.type === type)?.value || ''
  const currentTime = `${tokyoPart('hour')}:${tokyoPart('minute')}`
  const currentDate = `${tokyoPart('year')}-${tokyoPart('month')}-${tokyoPart('day')}`
  const metroFeedInfo = meta.sources?.tokyoMetroGtfs?.feedInfo?.[0] || null
  const metroFeedStart = metroFeedInfo?.feed_start_date || ''
  const metroFeedEnd = metroFeedInfo?.feed_end_date || ''
  const metroFeedStartDate = metroFeedStart.length === 8
    ? `${metroFeedStart.slice(0, 4)}-${metroFeedStart.slice(4, 6)}-${metroFeedStart.slice(6, 8)}`
    : ''
  const metroFeedEndDate = metroFeedEnd.length === 8
    ? `${metroFeedEnd.slice(0, 4)}-${metroFeedEnd.slice(4, 6)}-${metroFeedEnd.slice(6, 8)}`
    : ''
  const selectedViaStationIds = viaStations
    .filter((station) => station.selected && station.stationId)
    .map((station) => station.stationId)
  const [departureTime, setDepartureTime] =
    useState(currentTime)

  const [departureDate, setDepartureDate] =
    useState(currentDate)

  const compactDepartureDate = departureDate.replaceAll('-', '')

  const [timeMode, setTimeMode] = useState('departure')
  const [timeSelectorOpen, setTimeSelectorOpen] =
    useState(false)

  const [searched, setSearched] = useState(false)
  const [route, setRoute] = useState(null)
  // The graph includes Tokyo Metro connections even for searches whose selected
  // endpoints are Toei stations, so coverage warnings must not depend only on
  // endpoint/via station ID prefixes.
  const metroDateOutsideFeed = Boolean(
    metroFeedStart && metroFeedEnd &&
    (compactDepartureDate < metroFeedStart || compactDepartureDate > metroFeedEnd)
  )

  const [sortMode, setSortMode] = useState('fastest')
  const [expandedRoute, setExpandedRoute] = useState(null)
  const routeRankLabel = sortMode === 'fastest'
    ? '빠른순'
    : sortMode === 'fewest-transfers'
      ? '환승 적은순'
      : sortMode === 'cheapest'
        ? '저렴한순'
        : '빠른순'

  const [recentSearches, setRecentSearches] = useState(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = window.localStorage.getItem('noreba-recent-searches')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // 출발역 / 도착역 교체
  const swapStations = () => {
    setFrom(to)
    setTo(from)
    setFromStationId(toStationId)
    setToStationId(fromStationId)
    setFromSelected(toSelected)
    setToSelected(fromSelected)

    setSearched(false)
    setRoute(null)
  }

  // 경유지 미리 추가
  const addViaStation = () => {
    setViaStations((prev) => [
      ...prev,
      {
        value: '',
        selected: false,
        stationId: '',
      },
    ])
  }

  const updateViaStation = (index, value) => {
    setViaStations((prev) =>
      prev.map((station, i) =>
        i === index
          ? {
              ...station,
              value,
              selected: false,
              stationId: '',
            }
          : station
      )
    )

    setSearched(false)
    setRoute(null)
  }

  const selectViaStation = (index, station) => {
    setViaStations((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              value: station.name,
              selected: true,
              stationId: station.id,
            }
          : item
      )
    )

    setSearched(false)
    setRoute(null)
  }

  const removeViaStation = (index) => {
    setViaStations((prev) =>
      prev.filter((_, i) => i !== index)
    )

    setSearched(false)
    setRoute(null)
  }

  // 역 검색
  const findStations = (value) => {
    return searchStations(value)
  }

  const fromResults = findStations(from)
  const toResults = findStations(to)

  // 경로 검색
  const searchRoute = () => {
    if (!fromStationId || !toStationId) {
      return
    }

    const [hours, minutes] =
      departureTime.split(':').map(Number)

    const startSeconds =
      hours * 3600 +
      minutes * 60

    const [year, month, day] =
      departureDate.split('-').map(Number)

    const targetDate = {
      year,
      month,
      day,
    }

    const viaStationIds = selectedViaStationIds

    const result = findRoutes(
      fromStationId,
      toStationId,
      startSeconds,
      targetDate,
      timeMode,
      viaStationIds
    )

    setRoute(result)
    setSortMode('fastest')
    setSearched(true)
    setExpandedRoute(null)

    // 최근 검색 저장
    const searchedFrom = stations.find((station) => station.id === fromStationId)
    const searchedTo = stations.find((station) => station.id === toStationId)

    if (searchedFrom && searchedTo) {
      const newSearch = {
        from: searchedFrom,
        to: searchedTo,
      }

      const updatedSearches = [
        newSearch,
        ...recentSearches.filter(
          (item) =>
            item.from.id !== searchedFrom.id ||
            item.to.id !== searchedTo.id
        ),
      ].slice(0, 5)

      setRecentSearches(updatedSearches)

      try {
        window.localStorage.setItem(
          'noreba-recent-searches',
          JSON.stringify(updatedSearches)
        )
      } catch {
        // Searching still succeeds when browser storage is blocked or full.
      }
    }
  }

  // 선택된 역은 이름이 아니라 GTFS 역 ID로 식별한다.
  const selectedFrom = stations.find((station) => station.id === fromStationId)
  const selectedTo = stations.find((station) => station.id === toStationId)

  // 최근 검색 전체 삭제
  const clearRecentSearches = () => {
    setRecentSearches([])
    try {
      window.localStorage.removeItem('noreba-recent-searches')
    } catch {
      // Clearing in-memory history still succeeds when browser storage is blocked.
    }
  }

  return (
    <div className="app">

      {/* 헤더 */}
      <header className="header">
        <div className="brand">
          <div className="brand-main">
            <img
              className="noreba-logo"
              src="/noreba-logo.png"
              alt="NOREBA"
            />

            <div className="brand-text">
              <div className="logo">
                NOREBA
              </div>

              <div className="subtitle">
                도쿄, 쉬워지다.
              </div>

              <div className="tagline">
                乗るべき道だけ、ノレバいいじゃん。
              </div>
            </div>
          </div>
        </div>

        <button className="menu-button">
          ☰
        </button>
      </header>

      <main className="main">

        {/* =========================
            검색 카드
        ========================== */}

        <section className="search-card">

          {/* 출발역 */}

          <div className="station-row">

            <div className="station-icon from-icon">
              ●
            </div>

            <div className="input-area">

              <span className="input-label">
                출발역
              </span>

              <input
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  setFromStationId('')
                  setFromSelected(false)

                  setSearched(false)
                  setRoute(null)
                }}
                placeholder="역 이름을 입력하세요"
              />

              {fromResults.length > 0 &&
                !fromSelected && (
                  <div className="station-results">

                    {fromResults.map(
                      (station) => (
                        <button
                          key={station.id}
                          className="station-result"
                          type="button"
                          onClick={() => {
                            setFrom(station.name)
                            setFromStationId(station.id)
                            setFromSelected(true)

                            setSearched(false)
                            setRoute(null)
                          }}
                        >

                          <div>
                            <strong>
                              {station.korean ||
                                station.name}
                            </strong>

                            <span>
                              {station.japanese}

                              {station.romanized && (
                                <>
                                  {' · '}
                                  {station.romanized}
                                </>
                              )}
                            </span>
                          </div>

                          <div className="station-result-lines">
                            {station.lines.map(
                              (line) => (
                                <span
                                  key={line.code}
                                  className="station-result-line"
                                  style={{
                                    borderColor:
                                      line.color,
                                    color:
                                      line.color,
                                  }}
                                >
                                  <b>
                                    {line.code}
                                  </b>
                                  {line.name}
                                </span>
                              )
                            )}
                          </div>

                        </button>
                      )
                    )}

                  </div>
                )}

            </div>

          </div>

          {/* 출발역 ↔ 도착역 */}

          <div className="line-area">

            <div className="vertical-line"></div>

            <button
              className="swap-button"
              type="button"
              onClick={swapStations}
            >
              ⇅
            </button>

            <button
              className="add-via-circle-button"
              type="button"
              onClick={addViaStation}
            >
              +
            </button>

          </div>

          {/* 경유지 */}

          {viaStations.map(
            (viaStation, index) => {
              const viaResults =
                findStations(
                  viaStation.value
                )

              return (
                <div
                  className="via-station-block"
                  key={index}
                >

                  <div className="station-row">

                    <div className="station-icon via-icon">
                      ●
                    </div>

                    <div className="input-area">

                      <div className="via-input-header">
                        <span className="input-label">
                          경유지
                        </span>

                        <button
                          type="button"
                          className="via-remove-button"
                          onClick={() =>
                            removeViaStation(
                              index
                            )
                          }
                        >
                          ×
                        </button>
                      </div>

                      <input
                        value={
                          viaStation.value
                        }
                        onChange={(e) =>
                          updateViaStation(
                            index,
                            e.target.value
                          )
                        }
                        placeholder="역 이름을 입력하세요"
                      />

                      {viaResults.length > 0 &&
                        !viaStation.selected && (
                          <div className="station-results">

                            {viaResults.map(
                              (station) => (
                                <button
                                  key={station.id}
                                  className="station-result"
                                  type="button"
                                  onClick={() =>
                                    selectViaStation(
                                      index,
                                      station
                                    )
                                  }
                                >

                                  <div>
                                    <strong>
                                      {station.korean ||
                                        station.name}
                                    </strong>

                                    <span>
                                      {station.japanese}

                                      {station.romanized && (
                                        <>
                                          {' · '}
                                          {
                                            station.romanized
                                          }
                                        </>
                                      )}
                                    </span>
                                  </div>

                                  <div className="station-result-lines">
                                    {station.lines.map(
                                      (line) => (
                                        <span
                                          key={
                                            line.code
                                          }
                                          className="station-result-line"
                                          style={{
                                            borderColor:
                                              line.color,
                                            color:
                                              line.color,
                                          }}
                                        >
                                          <b>
                                            {
                                              line.code
                                            }
                                          </b>
                                          {line.name}
                                        </span>
                                      )
                                    )}
                                  </div>

                                </button>
                              )
                            )}

                          </div>
                        )}

                    </div>

                  </div>

                </div>
              )
            }
          )}

          {/* 도착역 */}

          <div className="station-row">

            <div className="station-icon to-icon">
              ●
            </div>

            <div className="input-area">

              <span className="input-label">
                도착역
              </span>

              <input
                value={to}
                onChange={(e) => {
                  setTo(e.target.value)
                  setToStationId('')
                  setToSelected(false)

                  setSearched(false)
                  setRoute(null)
                }}
                placeholder="역 이름을 입력하세요"
              />

              {toResults.length > 0 &&
                !toSelected && (
                  <div className="station-results">

                    {toResults.map(
                      (station) => (
                        <button
                          key={station.id}
                          className="station-result"
                          type="button"
                          onClick={() => {
                            setTo(station.name)
                            setToStationId(station.id)
                            setToSelected(true)

                            setSearched(false)
                            setRoute(null)
                          }}
                        >

                          <strong>
                            {station.korean ||
                              station.name}
                          </strong>

                          <span>
                            {station.japanese}

                            {station.romanized && (
                              <>
                                {' · '}
                                {
                                  station.romanized
                                }
                              </>
                            )}
                          </span>

                          <div className="station-result-lines">
                            {station.lines.map(
                              (line) => (
                                <span
                                  key={line.code}
                                  className="station-result-line"
                                  style={{
                                    borderColor:
                                      line.color,
                                    color:
                                      line.color,
                                  }}
                                >
                                  <b>
                                    {line.code}
                                  </b>
                                  {line.name}
                                </span>
                              )
                            )}
                          </div>

                        </button>
                      )
                    )}

                  </div>
                )}

            </div>

          </div>

          {/* 시간 선택 */}

          <button
            type="button"
            className="time-selector-toggle"
            onClick={() =>
              setTimeSelectorOpen(
                !timeSelectorOpen
              )
            }
          >
            <span>
              {departureTime
                ? `${departureTime} ${timeMode === 'arrival' ? '도착' : '출발'}`
                : timeMode === 'arrival' ? '도착 시각' : '지금 출발'}
            </span>

            <span>›</span>
          </button>

          {timeSelectorOpen && (
            <div className="time-selector">

              <div className="time-selector-label">
                시각
              </div>

              <div className="time-selector-row">

                <input
                  type="time"
                  value={departureTime}
                  onChange={(e) => {
                    setDepartureTime(e.target.value)
                    setSearched(false)
                    setRoute(null)
                    setExpandedRoute(null)
                  }}
                />

                <input
                  type="date"
                  value={departureDate}
                  onChange={(e) => {
                    setDepartureDate(e.target.value)
                    setSearched(false)
                    setRoute(null)
                    setExpandedRoute(null)
                  }}
                />

              </div>

              <div className="time-mode-buttons">

                <button
                  type="button"
                  className={
                    timeMode === 'departure'
                      ? 'active'
                      : ''
                  }
                  onClick={() => {
                    setTimeMode('departure')
                    setExpandedRoute(null)
                    setSearched(false)
                    setRoute(null)
                  }}
                >
                  출발
                </button>

                <button
                  type="button"
                  className={
                    timeMode === 'arrival'
                      ? 'active'
                      : ''
                  }
                  onClick={() => {
                    setTimeMode('arrival')
                    setExpandedRoute(null)
                    setSearched(false)
                    setRoute(null)
                  }}
                >
                  도착
                </button>

              </div>

            </div>
          )}

          {/* 검색 버튼 */}

          <button
            className="search-button"
            type="button"
            onClick={searchRoute}
            disabled={!fromStationId || !toStationId}
          >
            경로 검색

            <span>
              →
            </span>
          </button>

        </section>

        {/* =========================
            경로 결과
        ========================== */}

        {searched &&
          route &&
          selectedFrom &&
          selectedTo && (

            <section className="result-section">

              {/* 결과 제목 */}

              <div className="result-title">

                <div>

                  <span>
                    추천 경로
                  </span>

                  <h2>
                    {selectedFrom.name}

                    <b>
                      →
                    </b>

                    {selectedTo.name}
                  </h2>

                </div>

              </div>

              {metroDateOutsideFeed && route.length > 0 && (
                <div className="route-card no-route feed-coverage-warning" role="status">
                  <strong>시간표 데이터 범위 주의</strong>
                  <span>
                    도쿄메트로 시간표 데이터는 {metroFeedStartDate}부터 {metroFeedEndDate}까지 제공됩니다.
                    선택한 날짜에는 메트로가 포함되는 대체 경로가 누락되거나 실제 시간과 다를 수 있습니다.
                  </span>
                </div>
              )}

              {/* 경로 없음 */}

              {route.length === 0 && (

                <div className="route-card no-route">

                  <strong>
                    현재 연결된 노선이 없습니다.
                  </strong>

                  <span>
                    {metroDateOutsideFeed
                      ? `도쿄메트로 시간표 데이터는 ${metroFeedStartDate}부터 ${metroFeedEndDate}까지 제공됩니다. 선택한 날짜는 데이터 범위 밖이라 정확한 경로를 보장할 수 없습니다.`
                      : '선택한 날짜와 시각에 이용 가능한 경로를 찾지 못했습니다. 운행 시간표나 환승 연결 정보가 부족할 수 있습니다.'}
                  </span>

                </div>

              )}

              {/* 경로 있음 */}

              {route.length > 0 && (

                <>

                  {/* 정렬 탭 */}

                  <div className="sort-tabs">



                    <button
                      type="button"
                      className={
                        sortMode === 'fastest'
                          ? 'active'
                          : ''
                      }
                      onClick={() => {
                        setSortMode('fastest')
                        setExpandedRoute(null)
                      }}
                    >
                      ⚡ 빠른순
                    </button>

                    <button
                      type="button"
                      className={
                        sortMode ===
                        'fewest-transfers'
                          ? 'active'
                          : ''
                      }
                      onClick={() => {
                        setSortMode('fewest-transfers')
                        setExpandedRoute(null)
                      }}
                    >
                      🔄 환승 적은순
                    </button>

                    <button
                      type="button"
                      className={
                        sortMode ===
                        'cheapest'
                          ? 'active'
                          : ''
                      }
                      onClick={() => {
                        setSortMode('cheapest')
                        setExpandedRoute(null)
                      }}
                    >
                      ￥ 저렴한순
                    </button>

                  </div>

                  {/* 경로 카드 */}

                  {sortRoutes(
                    route,
                    sortMode,
                    timeMode
                  ).map(
                    (currentRoute, index) => (

                      <div
                        className={`route-card ${
                          expandedRoute === index
                            ? 'expanded'
                            : ''
                        }`}
                        key={index}
                      >

                        <div className="route-rank">
                          {routeRankLabel} {index + 1}
                        </div>

                        {/* 노선 요약 */}

                        <button
                          type="button"
                          className="route-line-summary"
                          onClick={() =>
                            setExpandedRoute(
                              expandedRoute === index
                                ? null
                                : index
                            )
                          }
                        >

                          <div className="route-line-summary-lines">

                            {currentRoute.lines.map(
                              (
                                line,
                                lineIndex
                              ) => (
                                <div
                                  className="route-line-summary-item"
                                  key={lineIndex}
                                >

                                  <span
                                    className="route-line-summary-icon"
                                    style={{
                                      borderColor:
                                        line.color,
                                      color:
                                        line.color,
                                    }}
                                  >
                                    {line.code ||
                                      '●'}
                                  </span>

                                  <div>
                                    <strong>
                                      {line.name}
                                    </strong>

                                    <span>
                                      {line.japanese}
                                    </span>
                                  </div>

                                </div>
                              )
                            )}

                          </div>

                          <span className="route-expand-icon">
                            {expandedRoute === index
                              ? '⌃'
                              : '⌄'}
                          </span>

                        </button>

                        {/* 경로 요약 정보 */}

                        <div className="route-info">

                          <div>
                            <span>
                              소요시간
                            </span>

                            <strong>
                              {currentRoute.duration !=
                              null
                                ? `${currentRoute.duration}분`
                                : '계산 예정'}
                            </strong>
                          </div>

                          <div>
                            <span>
                              환승 횟수 및 이동시간
                            </span>

                            <strong>
                              {currentRoute.transfers ?? 0}회 - {currentRoute.transferWalkSeconds > 0
                                ? `약 ${Math.round(currentRoute.transferWalkSeconds / 60)}분`
                                : '없음'}
                            </strong>
                          </div>

                          <div>
                            <span>
                              운임
                            </span>

                            <strong>
                              {currentRoute.fare?.icFare != null
                                ? `¥${currentRoute.fare.icFare} · IC`
                                : currentRoute.fareStatus?.startsWith('cross-operator')
                                  ? '통합 운임 미확인'
                                  : '운임 정보 없음'}
                            </strong>
                          </div>

                        </div>

                        {/* 경로 상세 */}

                        {expandedRoute === index && (
                          <RoutePath
                            route={currentRoute}
                          />
                        )}

                      </div>
                    )
                  )}

                </>

              )}

            </section>

          )}

        {/* =========================
            최근 검색
        ========================== */}

        <section className="recent-section">

          <div className="section-header">

            <h2>
              최근 검색
            </h2>

            <button
              type="button"
              onClick={
                clearRecentSearches
              }
            >
              전체 삭제
            </button>

          </div>

          {recentSearches.length === 0 ? (

            <div className="recent-empty">
              아직 최근 검색이 없습니다.
            </div>

          ) : (

            recentSearches.map(
              (item, index) => (

                <div
                  className="recent-item"
                  key={index}
                  onClick={() => {

                    setFrom(item.from.name)
                    setTo(item.to.name)
                    setFromStationId(item.from.id)
                    setToStationId(item.to.id)

                    setFromSelected(true)
                    setToSelected(true)

                    setSearched(false)
                    setRoute(null)

                  }}
                >

                  <div className="recent-icon">
                    ↔
                  </div>

                  <div>

                    <strong>
                      {item.from.name}
                      {' → '}
                      {item.to.name}
                    </strong>

                    <span>
                      {item.from.japanese}
                      {' → '}
                      {item.to.japanese}
                    </span>

                  </div>

                </div>

              )
            )

          )}

        </section>

        <p className="notice">
          🚉 도쿄의 전철 환승을 빠르고 간단하게
        </p>

      </main>

    </div>
  )
}

export default App