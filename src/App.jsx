import { useEffect, useState } from 'react'

import stations from './stations'

import {
  findRoutes,
  sortRoutes,
  searchStations,
} from './router'

import RoutePath from './RoutePath'


function App() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [searched, setSearched] = useState(false)
  const [route, setRoute] = useState(null)

  const [sortMode, setSortMode] = useState('fastest')
const [expandedRoute, setExpandedRoute] = useState(null)
  const [recentSearches, setRecentSearches] =
    useState([])


  // 최근 검색 불러오기
  useEffect(() => {
    const saved =
      localStorage.getItem(
        'noreba-recent-searches'
      )

    if (saved) {
      try {
        setRecentSearches(
          JSON.parse(saved)
        )
      } catch {
        setRecentSearches([])
      }
    }
  }, [])


  // 출발역 / 도착역 교체
  const swapStations = () => {
    setFrom(to)
    setTo(from)

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
    if (!from || !to) {
      return
    }

    const result = findRoutes(
      from,
      to
    )

    setRoute(result)
    setSearched(true)
setExpandedRoute(null)

    // 최근 검색 저장
    const searchedFrom =
      stations.find(
        (station) =>
          station.name === from ||
          station.japanese === from ||
          station.romanized?.toLowerCase() ===
            from.toLowerCase()
      )

    const searchedTo =
      stations.find(
        (station) =>
          station.name === to ||
          station.japanese === to ||
          station.romanized?.toLowerCase() ===
            to.toLowerCase()
      )


    if (searchedFrom && searchedTo) {
      const newSearch = {
        from: searchedFrom,
        to: searchedTo,
      }

      const updatedSearches = [
        newSearch,

        ...recentSearches.filter(
          (item) =>
            item.from.id !==
              searchedFrom.id ||
            item.to.id !==
              searchedTo.id
        ),
      ].slice(0, 5)


      setRecentSearches(
        updatedSearches
      )

      localStorage.setItem(
        'noreba-recent-searches',
        JSON.stringify(
          updatedSearches
        )
      )
    }
  }


  // 현재 선택된 역
  const selectedFrom =
    stations.find(
      (station) =>
        station.name === from ||
        station.japanese === from ||
        station.romanized?.toLowerCase() ===
          from.toLowerCase()
    )

  const selectedTo =
    stations.find(
      (station) =>
        station.name === to ||
        station.japanese === to ||
        station.romanized?.toLowerCase() ===
          to.toLowerCase()
    )


  // 최근 검색 전체 삭제
  const clearRecentSearches = () => {
    setRecentSearches([])

    localStorage.removeItem(
      'noreba-recent-searches'
    )
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

          <div className="card-title">
            어디로 갈까요?
          </div>


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
                  setFrom(
                    e.target.value
                  )

                  setSearched(false)
                  setRoute(null)
                }}

                placeholder="역 이름을 입력하세요"
              />


              {fromResults.length > 0 && (

                <div className="station-results">

                  {fromResults.map(
                    (station) => (

                      <button
                        key={station.id}
                        className="station-result"

                        type="button"

                        onClick={() => {
                          setFrom(
                            station.name
                          )

                          setSearched(false)
                          setRoute(null)
                        }}
                      >

                        <div>

  <strong>
    {station.korean || station.name}
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


                        <small>
                          {station.lines.length}
                          개 노선
                        </small>

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

          </div>


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
                  setTo(
                    e.target.value
                  )

                  setSearched(false)
                  setRoute(null)
                }}

                placeholder="역 이름을 입력하세요"
              />


              {toResults.length > 0 && (

                <div className="station-results">

                  {toResults.map(
                    (station) => (

                      <button
                        key={station.id}
                        className="station-result"

                        type="button"

                        onClick={() => {
                          setTo(
                            station.name
                          )

                          setSearched(false)
                          setRoute(null)
                        }}
                      >

                        <strong>
  {station.korean || station.name}
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


                        <small>
                          {station.lines.length}
                          개 노선
                        </small>

                      </button>

                    )
                  )}

                </div>

              )}

            </div>

          </div>


          {/* 검색 버튼 */}

          <button
            className="search-button"
            type="button"

            onClick={searchRoute}

            disabled={!from || !to}
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


              {/* 경로 없음 */}

              {route.length === 0 && (

                <div className="route-card no-route">

                  <strong>
                    현재 연결된 노선이 없습니다.
                  </strong>

                  <span>
                    실제 GTFS 데이터를 연결하면
                    환승 경로까지 검색할 수 있습니다.
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

                      onClick={() =>
                        setSortMode(
                          'fastest'
                        )
                      }
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

                      onClick={() =>
                        setSortMode(
                          'fewest-transfers'
                        )
                      }
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

                      onClick={() =>
                        setSortMode(
                          'cheapest'
                        )
                      }
                    >
                      ￥ 저렴한순
                    </button>

                  </div>


                  {/* 경로 카드 */}

                  {sortRoutes(
                    route,
                    sortMode
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
                          추천 {index + 1}
                        </div>


                        {/* ★ 핵심
                            기존의 중복 경로 표시를 제거하고
                            RoutePath 하나만 사용
                        */}
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
    {currentRoute.lines.map((line, index) => (
      <div
        className="route-line-summary-item"
        key={index}
      >
        <span
          className="route-line-summary-icon"
          style={{
            borderColor: line.color,
            color: line.color,
          }}
        >
          {line.code || '●'}
        </span>

        <div>
          <strong>{line.name}</strong>
          <span>{line.japanese}</span>
        </div>
      </div>
    ))}
  </div>

  <span className="route-expand-icon">
    {expandedRoute === index ? '⌃' : '⌄'}
  </span>
</button>

{expandedRoute === index && (
  <RoutePath
    route={currentRoute}
  />
)}


                        {/* 경로 요약 */}

                        <div className="route-info">

                          <div>

                            <span>
                              환승
                            </span>

                            <strong>
                              {
                                currentRoute.transfers
                              }
                              회
                            </strong>

                          </div>


                          <div>

                            <span>
                              소요시간
                            </span>

                            <strong>
                              {
                                currentRoute.duration !=
                                null
                                  ? `${currentRoute.duration}분`
                                  : '계산 예정'
                              }
                            </strong>

                          </div>


                          <div>

                            <span>
                              운임
                            </span>

                            <strong>
                            {currentRoute.fare != null
  ? (
      <>
        {currentRoute.fare.icFare != null && (
          <div>
            ¥{currentRoute.fare.icFare} · IC
          </div>
        )}

      </>
    )
  : '계산 예정'}
                            </strong>

                          </div>

                        </div>

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

                    setFrom(
                      item.from.name
                    )

                    setTo(
                      item.to.name
                    )

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