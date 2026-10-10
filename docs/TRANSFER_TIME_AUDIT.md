# Transfer-time audit (2026-10-10)

## Scope and interpretation

This audit reviews all 270 directed transfer edges (135 bidirectional pairs) in `data/processed/transfers.json` for the current 15-line dataset (Tokyo Metro, Toei subway and Toei Arakawa tram connections represented in the data).

`duration` is in **seconds**. It is treated by `routeEngine.js` as the minimum transfer/connection allowance before the next ride can be boarded. The route engine does not append a single generic penalty after the whole trip; it schedules the next ride only after each transfer edge has elapsed.

Sources are not interchangeable:

- A Yahoo! route that is a direct walk-only result (`徒歩` / `同駅内徒歩`, 0 yen and 0 rail rides) is evidence for the displayed walking time.
- A train itinerary showing arrival at one service and departure on another is only evidence for the observed connection interval. It may contain waiting for the next train, so the notes explicitly say when the walking component is not independently measured.
- Third-party platform-by-platform guides are used only as approximate transfer-time evidence and are called out below.

## Values applied

| Transfer / node pair | Seconds | Basis | Evidence and notes |
|---|---:|---|---|
| Kuramae: Toei Asakusa Line `117` ↔ Oedo Line `412` | 840 (14 min) | User-supplied Yahoo! minimum connection | User reported Yahoo! route Asakusa → Kuramae → Shinjuku treating this connection as at least 14 min. Keep as the explicit minimum for this edge. |
| Ueno: Metro Ginza `TM-116` ↔ Hibiya `TM-318` | 360 (6 min) | Yahoo! connection interval | A route sample shows about 6 min between service steps; this is a conservative connection allowance, not a claim that every walk takes exactly 6 min. |
| Ueno-hirokoji `TM-115` ↔ Naka-okachimachi `TM-317` | 420 (7 min) | Yahoo! direct station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E4%B8%8A%E9%87%8E%E5%BA%83%E5%B0%8F%E8%B7%AF-%E4%BB%B2%E5%BE%A1%E5%BE%92%E7%94%BA) displays 7 min, 0 yen, 0 transfers. |
| Ueno-hirokoji `TM-115` ↔ Ueno-okachimachi `410` | 180 (3 min) | Yahoo! direct station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E4%B8%8A%E9%87%8E%E5%BA%83%E5%B0%8F%E8%B7%AF-%E4%B8%8A%E9%87%8E%E5%BE%A1%E5%BE%92%E7%94%BA) displays 3 min, 0 yen, 0 transfers. |
| Naka-okachimachi `TM-317` ↔ Ueno-okachimachi `410` | 240 (4 min) | Yahoo! direct station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E4%BB%B2%E5%BE%A1%E5%BE%92%E7%94%BA-%E4%B8%8A%E9%87%8E%E5%BE%A1%E5%BE%92%E7%94%BA) displays 4 min, 0 yen, 0 transfers. |
| Toranomon `TM-107` ↔ Toranomon Hills `TM-306` | 420 (7 min) | Yahoo! direct station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E8%99%8E%E3%83%8E%E9%96%80-%E8%99%8E%E3%83%8E%E9%96%80%E3%83%92%E3%83%AB%E3%82%BA) displays 7 min, 0 yen, 0 transfers. Tokyo Metro also notes the underground pedestrian corridor connection on its station page. |
| Ginza (Ginza / Marunouchi / Hibiya nodes) ↔ Ginza-itchome `TM-619` | 360 (6 min) | Yahoo! direct station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E9%8A%80%E5%BA%A7-%E9%8A%80%E5%BA%A7%E4%B8%80%E4%B8%81%E7%9B%AE) displays 6 min, 0 yen, 0 transfers. Applied to the relevant three Ginza-line station nodes. |
| Tsukiji `TM-311` ↔ Shintomicho `TM-620` | 360 (6 min) | Yahoo! direct station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E7%AF%89%E5%9C%B0-%E6%96%B0%E5%AF%8C%E7%94%BA) displays 6 min, 0 yen, 0 transfers. |
| Awajicho `TM-222` ↔ Shin-ochanomizu `TM-512` | 360 (6 min) | Yahoo! direct station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E6%B7%A1%E8%B7%AF%E7%94%BA-%E6%96%B0%E5%BE%A1%E8%8C%B6%E3%83%8E%E6%B0%B4) displays 6 min, 0 yen, 0 transfers. |
| Shin-ochanomizu `TM-512` ↔ Ogawamachi `307` | 240 (4 min) | Yahoo! direct station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E5%B0%8F%E5%B7%9D%E7%94%BA%28%E6%9D%B1%E4%BA%AC%E9%83%BD%29-%E6%96%B0%E5%BE%A1%E8%8C%B6%E3%83%8E%E6%B0%B4) displays 4 min, 0 yen, 0 transfers. |
| Awajicho `TM-222` ↔ Ogawamachi `307` | 180 (3 min) | Yahoo! direct station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E5%B0%8F%E5%B7%9D%E7%94%BA%28%E6%9D%B1%E4%BA%AC%E9%83%BD%29-%E6%9D%B1%E4%BA%AC) includes a 3-min walk between the pair. |
| Suitengumae `TM-710` ↔ Ningyocho Metro Hibiya `TM-314` / Toei Asakusa `114` | 300 (5 min) | Yahoo! station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E4%BA%BA%E5%BD%A2%E7%94%BA-%E6%B0%B4%E5%A4%A9%E5%AE%AE%E5%89%8D) displays 5 min. Both represented Ningyocho nodes use the same allowance. |
| Otemachi Marunouchi `TM-221` ↔ Hanzomon `TM-708` | 480 (8 min) | Yahoo! connection interval | A route example showed an 8-min arrival-to-departure interval. Not asserted to be pure walking time; retained as the minimum connection allowance for this specific line pair. Other Otemachi pairs are **not** automatically assigned 8 min. |
| Hibiya `TM-509` / `TM-308` ↔ Yurakucho `TM-618` | 300 (5 min) | Yahoo! direct station-to-station walk | Yahoo! station-pair route shows about 5 min. Same-name Hibiya line-to-line links remain a separately estimated 5 min where no specific walk-only source was found. |
| Akihabara Hibiya `TM-316` ↔ Iwamotocho `308` | 360 (6 min) | Yahoo! direct station-to-station walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E7%A7%8B%E8%91%89%E5%8E%9F-%E5%B2%A9%E6%9C%AC%E7%94%BA) displays 6 min, 0 yen, 0 transfers. |
| Korakuen Metro (Marunouchi `TM-225` / Namboku `TM-811`) ↔ Kasuga Toei (Mita `212` / Oedo `408`) | 360 (6 min) | Yahoo! direct walk between station complexes | Yahoo! route examples show about 6 min walking between Korakuen and Kasuga. All four graph node combinations use 6 min because they cross these named station complexes. |
| Zoshigaya Fukutoshin `TM-910` ↔ Kishibojimmae Toden `627` | 180 (3 min) | Yahoo! direct walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E9%9B%91%E5%8F%B8%E3%81%8C%E8%B0%B7-%E9%AC%BC%E5%AD%90%E6%AF%8D%E7%A5%9E%E5%89%8D) displays 3 min, 0 yen, 0 transfers. Corrects the previous generic 5-min value downward. |
| Kokkai-gijidomae ↔ Tameike-sanno (cross-station node combinations only) | 360 (6 min) | Yahoo! direct station-pair walk | [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E6%BA%9C%E6%B1%A0%E5%B1%B1%E7%8E%8B-%E5%9B%BD%E4%BC%9A%E8%AD%B0%E4%BA%8B%E5%A0%82%E5%89%8D) shows 6 min for the direct walk. Same-complex line transfers at either station remain at baseline 5 min. |
| Metro Machiya `TM-517` ↔ Toden Machiya-ekimae `606` | 120 (2 min) | Yahoo! route walk | [Yahoo! route sample](https://transit.yahoo.co.jp/search/result/%E4%BA%8C%E9%87%8D%E6%A9%8B%E5%89%8D-%E7%94%BA%E5%B1%8B%E9%A7%85%E5%89%8D) shows 2 min for the walk. |
| Metro Higashi-Ikebukuro `TM-610` ↔ Toden Higashi-Ikebukuro-yonchome `625` | 180 (3 min) | Walk-route evidence | A route search shows a 3-min foot segment; a MapFan walk route reports 162 m / 3 min. [MapFan route](https://mapfan.com/directions/points/35.726155718761%2C139.71878107009%2C%E6%9D%B1%E6%B1%A0%E8%A2%8B%E9%A7%85%EF%BC%88%E6%9C%89%E6%A5%BD%E7%94%BA%E7%B7%9A%EF%BC%89%2CSCH%2CJ%2CSKT%2C/35.725263354548%2C139.72009874394%2C%E6%9D%B1%E6%B1%A0%E8%A2%8B%E5%9B%9B%E4%B8%81%E7%9B%AE%E9%A7%85%EF%BC%88%E9%83%BD%E9%9B%BB%E8%8D%92%E5%B7%9D%E7%B7%9A%EF%BC%89%2CSCH%2CJ%2CAU4%2C/types/walk/settings/now%2C4%2C101) reports 3 min. |
| Minowa Hibiya `TM-320` ↔ Minowabashi Toden `601` | 300 (5 min) | Yahoo! route walking segment | Yahoo! route examples show a 5-min walking segment from Minowa to Minowabashi. This also aligns with third-party reports of a 3–4 min walk plus time to exit / locate the tram. [Yahoo! route](https://transit.yahoo.co.jp/search/result/%E7%8E%8B%E5%AD%90-%E4%B8%89%E3%83%8E%E8%BC%AA%E6%A9%8B) |
| Shinjuku Marunouchi `TM-211` ↔ Shinjuku-nishiguchi Oedo `402` | 300 (5 min) | Yahoo! station-pair walk | Yahoo! shows about 5 min between Shinjuku and Shinjuku-nishiguchi. |
| Akasaka-mitsuke ↔ Nagatacho cross-station node combinations | 300 (5 min) | Yahoo! station-pair walk | Yahoo! route examples show about 5 min between the named complexes. |
| Iidabashi Metro nodes (`TM-406`, `TM-613`, `TM-810`) ↔ Toei Oedo `407` | 480 (8 min) | Platform-by-platform transfer guide | Transfer guide states the Oedo platform is separated from the Metro platforms and usually takes 7–8 min, with stairs/escalators along the path. [Guide](https://wadattsu261.com/content/iidabashi-metrotozailine-toeiooedo-transfer-information/) |
| Kudanshita Hanzomon `TM-706` ↔ Tozai `TM-407` / Toei Shinjuku `305` | 180 (3 min) | Platform-by-platform transfer guide | Transfer guides describe roughly 1–3 min for Hanzomon↔Tozai and around 2 min for Hanzomon↔Toei Shinjuku. Use 3 min in both directions as a conservative allowance. [Guide](https://norikaemap.com/kudanshita/0204/) |
| Shinjuku-sanchome Marunouchi `TM-212` ↔ Toei Shinjuku `302` | 180 (3 min) | Platform-by-platform transfer guide | Guide lists about 213 m / 3 min from Toei Shinjuku Line area to Marunouchi Line. [Guide](https://eki-kara-access.tokyo/transfer-from-toeishinjuku-line-at-shinjuku3choume/) |
| Shinjuku-sanchome Fukutoshin `TM-913` ↔ Toei Shinjuku `302` | 300 (5 min) | Platform-by-platform transfer guide | A separate route guide advises allowing about 5 min for this combination. [Guide](https://tren.hatenablog.com/entry/s02-f13) |
| Shibuya Hanzomon `TM-701` ↔ Ginza `TM-101` | 300 (5 min) | Transfer guide measured walk | Published measured route reports 4 min 59 sec. [Guide](https://1rankup.jp/shibuya/dh-g.html) |
| Ikebukuro Marunouchi `TM-228` ↔ Yurakucho `TM-609` | 180 (3 min) | Transfer guide measured walk | Published measured route reports 2 min 42 sec in both directions; 3 min used as the connection allowance. [Guide](https://1rankup.jp/ikebukuro/m-y.html) |
| Ikebukuro Yurakucho `TM-609` ↔ Fukutoshin `TM-909` | 300 (5 min) | Transfer guide measured walk | Published measured route reports 5 min 13 sec; 5 min is a rounded estimate. [Guide](https://1rankup.jp/ikebukuro/y-f.html) |

## Remaining combinations to keep under review

The current graph has many same-name, same-complex line pairs. They are not automatically long transfers, and it would be misleading to assign every one a large penalty. The following still need line-pair-specific platform-to-platform data rather than an assumed blanket value:

1. **Otemachi:** other combinations besides Marunouchi↔Hanzomon (notably Chiyoda↔Tozai, Chiyoda↔Mita, Tozai↔Mita and Hanzomon↔Tozai). Keep their existing values until exact transfer paths can be checked.
2. **Iidabashi:** Metro-to-Metro combinations remain at the 5-min baseline; only Metro↔Toei Oedo is verified at 7–8 min.
3. **Shibuya:** Hanzomon↔Fukutoshin and Fukutoshin↔Ginza are not inferred from the measured Hanzomon↔Ginza path; keep their defaults pending direct route evidence.
4. **Ikebukuro:** Marunouchi↔Yurakucho and Yurakucho↔Fukutoshin have measurements above. Fukutoshin↔Marunouchi and other paths still need their own evidence.
5. **Asakusa:** Metro Ginza↔Toei Asakusa is a different platform/entrance connection even though the station names match; baseline 5 min is retained pending a route-specific walk-only result.
6. **Other multi-line complexes:** Ginza internal line changes, Hibiya internal line changes, Shinjuku, Shinjuku-sanchome, Kudanshita, Nagatacho/Akasaka-mitsuke and station-node combinations where no direct platform path was measured remain candidates for a finer, directional matrix. Do not propagate one pair's time to every pair at the same named station unless the walk path is demonstrably the same.

## Regression verification

Run from the project root:

```bash
npm run test:routes
```

The test suite checks that all 270 transfer edges have valid endpoints and reverse edges, all audited pairs have the intended seconds in both directions, and the Kuramae path cannot board its next train before the 14-minute connection allowance ends. It also preserves prior route, fare, overnight and GTFS service-calendar regression tests.

Latest observed test output: **PASS**. Key fixture: Asakusa → Ueno-hirokoji after 01:11 shows the first train 05:01–05:08 as a 7-minute ride, excluding the wait before boarding. The test suite's Kuramae-specific scheduler assertion checks an exact 840-second transfer segment, confirms the next ride departs no earlier than the segment's end, and constructs that exact Asakusa Line → Oedo Line path to assert that the transfer count is exactly 1. The generic “via Kuramae” result list can also contain routes that pass through Kuramae without changing there; those routes may have a different transfer count and should not be confused with this specific transfer path.

Build/lint have not been run in this environment because the ZIP does not include `node_modules` and dependencies could not be validated offline. Run `npm install`, `npm run lint`, and `npm run build` before deployment.
