# Tokyo Metro data accuracy audit

Generated from the Tokyo Metro GTFS feed version `20261008` and the supplied ODPT JSON snapshots.

## Timetable coverage

- Feed start: `2026-09-19`
- Feed end: `2027-03-12`
- GTFS routes: 9
- GTFS stations: 185
- GTFS trips: 9,706
- GTFS stop-time records: 176,385
- ODPT station records: 186, representing 185 unique station codes because Nakano-sakaue (`M06`) appears for the Marunouchi main line and branch.

The app must not claim a Tokyo Metro route is unavailable in general when the selected date is outside this feed's service window. It now displays the actual feed coverage in the no-route state for Metro searches outside that window.

## Important stop-time handling

The feed has 4,151 stop-time rows with blank arrival and departure times. All 4,151 have both `pickup_type=1` and `drop_off_type=1`; there are zero untimed rows that allow passenger pickup or drop-off.

These rows are therefore not treated as passenger boarding/alighting points. The merge script builds ride connections from a boardable origin to the next alightable stop, skipping intervening non-boardable/non-alightable rows. This preserves the GTFS times at the usable endpoints and does not invent times for stops where passengers cannot board or alight.

The regenerated data has:

- 384 Tokyo Metro ride-connection pairs
- 32 connection pairs with at least one trip that skips intermediate non-service stops
- 1,497 trip-level service segments that skip one or more intermediate non-service stops
- 0 untimed serviceable stop rows
- 0 missing stop/trip references
- 0 trips with missing route/calendar references

Regression coverage includes a limited-stop Hibiya-line trip (`TM-30B1743T00`) that boards at Kasumigaseki and alights at Ginza while not offering boarding or alighting at Hibiya.

## Station and graph verification

- All 185 GTFS station codes map to ODPT station records with matching Japanese names; 0 name mismatches were found.
- All 185 Metro station nodes have Korean and romanized names, coordinates, line membership, and at least one ride edge.
- The original Korean station dictionary covered the Toei Subway stations but omitted Toei-operated Nippori-Toneri Liner and Toden Arakawa Line stations. The current map fills Korean labels for all 43 previously missing station nodes; this is localization data, not a network-integrity defect.
- The directed ride/transfer graph reaches all 185 Metro stations from the first node, and all 185 can reach it in reverse traversal; no isolated Metro station was found.
- The merged Metro graph contains 384 directed ride-connection pairs and 142 directed Metro-to-Metro transfer edges. This confirms graph connectivity, not the real-world accuracy of every walking transfer duration.

## Route search (rebuilt engine)

The route engine has been rebuilt around a separation between route topology and timetable scheduling:

- A best-first path search uses minimum ride-time lower bounds and transfer durations; it explores at most 80,000 states and retains up to 60 distinct route patterns for timetable evaluation.
- A route pattern is identified by its ordered line sequence, normalized transfer endpoints, and ordered station-to-station ride path, not by the specific train trip or departure time. This preserves distinct stop/branch paths that share a line ID. Consecutive transfer links are treated as one walk, so redundant connector loops do not create extra route cards. Near-duplicate pruning is a later ranking step and requires the same corridor/line pattern, transfer count, transfer-connection time, and a short duration difference. Known fares must match; one missing fare may be treated as compatible only for a near-identical corridor, with the known-fare result preferred when all other key values tie.
- Platform nodes are grouped as station-selection alternatives only when they are transfer-connected and share the same Japanese station name. The full transfer graph is not treated as a station alias group, because its walking links can connect separately named nearby stations.
- When a direct route is available, the default result set contains only direct routes rather than transfer detours. Up to three distinct alternatives are returned when multiple route patterns are relevant; results are not padded to reach that count.
- Departure searches schedule the next feasible service for each route pattern. The displayed journey duration starts with boarding the first train and excludes the wait from the requested search time to that first train; transfer walks/connection allowances and waits between trains remain part of the journey duration. Route cards expose an estimated total transfer-connection duration so routes with similar line labels but materially different walks are explainable.
- Arrival searches work backward from the requested arrival time and retain routes that arrive no later than the target. Service calendars and exceptions are checked against the appropriate GTFS service date, including times at or after 24:00 and trips crossing midnight.

A regression test covers Asakusa → Ueno-hirokoji when searching at 01:11 on 2026-10-10. It must return one Ginza Line direct route, departing at 05:01 and arriving at 05:08, with a 7-minute journey duration—not a 226-minute duration that includes waiting for the first train. The test also verifies that choosing either the Toei Asakusa node or the Tokyo Metro Asakusa node yields the same route.

The search is bounded for browser performance; therefore it is not a mathematical guarantee that every possible topology in the full graph is exhaustively enumerated. Route recommendations are also limited to operators represented by the included GTFS/integration data.

## Transfer and fare limitations

- ODPT connecting-station references contribute 254 directed transfer edges.
- 14 additional directed Toei transfer edges are inferred from duplicate Japanese station names and nearby GTFS coordinates; 2 pre-existing manual Kuramae edges are retained.
- A default transfer duration of 300 seconds is used where no measured walking time is provided. This is a fallback, not an official station-specific transfer time.
- 177 external-operator connection references are recorded but not routed because their full operator networks are not included in this integration.
- For IC-card transfers at specified Metro/Toei transfer stations that require exiting and re-entering a fare gate, official guidance says the transfer must be completed within 60 minutes or a new fare is charged from the transfer station. NOREBA does not model the passenger leaving/re-entering fare gates or stopovers; the route fare estimate assumes a continuous eligible transfer. It does not split a fare solely because timetable waiting time exceeds 60 minutes. Source: https://www.kotsu.metro.tokyo.jp/pickup_information/news/subway/2026/sub_p_2026012812378_h.html
- Tokyo Metro and Toei fare lookup use the bundled GTFS fare rules. `fare_attributes.payment_method` follows the GTFS-JP meaning of payment timing (0 = paid after boarding, 1 = paid before boarding); it does not distinguish IC from paper fares. The prices in the included Metro and Toei fare tables have been cross-checked against published IC fare bands for the sampled operators/lines, so the engine treats source prices as IC fares and leaves `paperFare` unknown because no separate paper-fare price is encoded. Toei-only and Metro-only routes can use their own rules. Tokyo Metro + Toei is the only supported cross-operator combination: continuous operator legs are summed and the adult 70-yen discount is applied once per entire itinerary, even if the itinerary switches between the two operators multiple times. The official rule confirms a ¥70 Metro↔Toei through-fare discount; the one-discount-per-itinerary handling for repeated alternation is explicitly enforced as the app policy by regression tests. If any other operator is mixed into a route, its total fare is left unknown rather than adding separate operators without an explicit official through-fare model. For IC-card transfers that require exiting and re-entering a fare gate, the official rule says the transfer must be completed within 60 minutes or the fare is recalculated from the transfer station. The app does not track gate-out/re-entry or stopover state, so displayed fares assume a continuous eligible transfer and do not model deliberate exits or long stopovers. A route built from the real graph edges for Asakusa → Ningyocho → Roppongi → Tochomae is tested through `makeRoute()` and returns the user-checked Yahoo! IC fare ¥506; the fare regression uses synthetic monotonic timestamps to isolate fare accounting, not to claim that the bounded public route search will always rank this path. The Ningyocho↔Roppongi IC correction is keyed by explicit station IDs (`TM-314` / `TM-304`) and is based on the user-observed Yahoo! result. A repeated-crossing regression fixture locks the once-per-itinerary policy; representative live fare-search samples should continue to be added as they become available.
- The supplied ODPT train timetable and fare JSON files each contain 1,000 records and are treated as incomplete samples, not as a full timetable/fare source.

## Verification

Verified in the rebuild environment:

- `node scripts/test-route-engine.mjs` — passed. Includes the new Asakusa → Ueno-hirokoji first-train regression, station-platform alias resolution, unique route identities, weekday/holiday/weekend service calendars, overnight service-day offsets, cross-midnight arrival, explicit transfers, fares, and Metro graph reachability.
- `node --check src/routeEngine.js` — passed.
- `node --check scripts/test-route-engine.mjs` — passed.

`npm ci` could not complete in the current environment because an npm package was not available from the local cache and registry access did not finish. Consequently, `npm run lint` and the Vite production build were not run on this copy; run `npm.cmd run lint` and `npm.cmd run build` locally on Windows before deployment. The built-in Node.js audits can run without installed frontend dependencies: `npm.cmd test` and, with Python 3 available, `npm.cmd run audit:feeds`.

The UI labels station-to-station walking durations as approximate (for example, “도보 환승 · 약 5분”) because the supplied ODPT connection relationships do not include measured walking times.


## Toei pass-through stop handling

The Toei GTFS contains 540 blank-time rows where both pickup and drop-off are prohibited. The converter now skips these pass-through rows when constructing passenger ride connections and connects the previous boardable/timed origin directly to the next timed/alightable stop. All generated service entries must have valid departure and arrival times; rows allowing pickup or drop-off without times fail conversion. This aligns Toei treatment with the approach used for Tokyo Metro.
