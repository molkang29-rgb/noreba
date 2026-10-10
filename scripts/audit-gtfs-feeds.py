#!/usr/bin/env python3
"""Audit raw Toei and Tokyo Metro GTFS ZIPs using only Python's standard library."""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FEEDS = {
    "toei": ROOT / "data/raw/Toei-Train-GTFS.zip",
    "tokyometro": ROOT / "data/raw/TokyoMetro-Train-GTFS.zip",
}

def read_csv(archive, filename):
    try:
        data = archive.read(filename).decode("utf-8-sig")
    except KeyError:
        return []
    return list(csv.DictReader(io.StringIO(data, newline="")))

def audit_feed(operator, file_path):
    if not file_path.exists():
        raise FileNotFoundError(f"Missing GTFS feed: {file_path}")
    with zipfile.ZipFile(file_path) as archive:
        names = set(archive.namelist())
        required = {"routes.txt", "stops.txt", "trips.txt", "stop_times.txt"}
        missing = sorted(required - names)
        if missing:
            raise AssertionError(f"{operator}: required GTFS files missing: {missing}")
        routes = read_csv(archive, "routes.txt")
        stops = read_csv(archive, "stops.txt")
        trips = read_csv(archive, "trips.txt")
        stop_times = read_csv(archive, "stop_times.txt")
        feed_info = read_csv(archive, "feed_info.txt")
        calendar = read_csv(archive, "calendar.txt")
        calendar_dates = read_csv(archive, "calendar_dates.txt")

    route_ids = {row.get("route_id", "") for row in routes}
    stop_ids = {row.get("stop_id", "") for row in stops}
    trip_by_id = {row.get("trip_id", ""): row for row in trips}
    service_ids = {row.get("service_id", "") for row in calendar + calendar_dates}
    unknown_route_trips = [row.get("trip_id", "") for row in trips if row.get("route_id", "") not in route_ids]
    unknown_services = [row.get("trip_id", "") for row in trips if row.get("service_id", "") not in service_ids]
    unknown_trip_refs = [row.get("trip_id", "") for row in stop_times if row.get("trip_id", "") not in trip_by_id]
    unknown_stop_refs = [row.get("stop_id", "") for row in stop_times if row.get("stop_id", "") not in stop_ids]
    untimed = [row for row in stop_times if not row.get("arrival_time") or not row.get("departure_time")]
    untimed_serviceable = [row for row in untimed if (row.get("pickup_type") or "0") != "1" or (row.get("drop_off_type") or "0") != "1"]

    result = {
        "operator": operator,
        "file": str(file_path.relative_to(ROOT)),
        "feedInfo": feed_info,
        "routes": len(routes),
        "stops": len(stops),
        "trips": len(trips),
        "stopTimes": len(stop_times),
        "untimedPassThroughStops": len(untimed),
        "untimedServiceableStops": len(untimed_serviceable),
        "unknownRouteTrips": len(unknown_route_trips),
        "unknownServiceTrips": len(unknown_services),
        "unknownTripRefsInStopTimes": len(unknown_trip_refs),
        "unknownStopRefsInStopTimes": len(unknown_stop_refs),
    }
    assert not unknown_route_trips, f"{operator}: trips refer to unknown routes"
    assert not unknown_services, f"{operator}: trips refer to unknown service calendars"
    assert not unknown_trip_refs, f"{operator}: stop_times refer to unknown trips"
    assert not unknown_stop_refs, f"{operator}: stop_times refer to unknown stops"
    assert not untimed_serviceable, f"{operator}: untimed records allow passenger boarding or alighting ({len(untimed_serviceable)})"
    return result

def main():
    results = [audit_feed(operator, file_path) for operator, file_path in FEEDS.items()]
    print(json.dumps({"status": "PASS", "feeds": results}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"GTFS audit FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
