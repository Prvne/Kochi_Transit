from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
from geopy.distance import geodesic
from services.gtfs_loader import load_all_gtfs
from datetime import datetime

app = Flask(__name__)
CORS(app)  # Enable CORS so React can access the API

# Load GTFS data at startup
gtfs_data = load_all_gtfs()
stops_df = gtfs_data["stops.txt"]
routes_df = gtfs_data["routes.txt"]
stop_times_df = gtfs_data["stop_times.txt"]
trips_df = gtfs_data["trips.txt"]
shapes_df = gtfs_data["shapes.txt"]



def get_next_departures(trip_ids, stop_id, count=3):
    now = datetime.now().time()
    print(f"[DEBUG] Trip IDs: {trip_ids}")
    print(f"[DEBUG] Stop ID: {stop_id}")
    candidates = stop_times_df[
        stop_times_df["trip_id"].isin(trip_ids) &
        (stop_times_df["stop_id"] == stop_id)
    ].copy()
    print(f"[DEBUG] Matching stop_times rows: {len(candidates)}")
    print(candidates.head())

    def parse_time(t):
        try:
            h, m, s = map(int, t.split(":"))
            if h >= 24:
                h -= 24
            return datetime.strptime(f"{h:02}:{m:02}:{s:02}", "%H:%M:%S").time()
        except:
            return None

    candidates["parsed_time"] = candidates["departure_time"].apply(parse_time)
    #future_times = candidates[candidates["parsed_time"] > now]
    future_times = candidates.sort_values("parsed_time")
    future_times_sorted = future_times.sort_values("parsed_time")

    return future_times_sorted["departure_time"].head(count).tolist()


def get_nearest_stops(lat, lon, radius_km=1.0):
    stops_df["distance_km"] = stops_df.apply(
        lambda row: geodesic((lat, lon), (row["stop_lat"], row["stop_lon"])).km,
        axis=1
    )
    nearby = stops_df[stops_df["distance_km"] <= radius_km].copy()
    return nearby.sort_values("distance_km")

@app.route("/stops_nearby_with_mode")
def stops_nearby_with_mode():
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
        radius_km = float(request.args.get("radius_km", 1))

        # Compute distances
        stops_with_dist = stops_df.copy()
        stops_with_dist["distance_km"] = stops_with_dist.apply(
            lambda row: geodesic((lat, lon), (row["stop_lat"], row["stop_lon"])).km,
            axis=1
        )

        nearby = stops_with_dist[stops_with_dist["distance_km"] <= radius_km]

        # Link stops -> stop_times -> trips -> routes to get mode
        stop_times_subset = stop_times_df[stop_times_df["stop_id"].isin(nearby["stop_id"])]
        trip_ids = stop_times_subset["trip_id"].unique()
        trips_subset = trips_df[trips_df["trip_id"].isin(trip_ids)]
        route_ids = trips_subset["route_id"].unique()
        routes_subset = routes_df[routes_df["route_id"].isin(route_ids)]

        # Map stop_id to mode (bus, ferry, etc.)
        stop_modes = {}
        for stop_id in nearby["stop_id"]:
            trip_ids_for_stop = stop_times_subset[stop_times_subset["stop_id"] == stop_id]["trip_id"]
            route_ids_for_stop = trips_subset[trips_subset["trip_id"].isin(trip_ids_for_stop)]["route_id"]
            route_types = routes_subset[routes_subset["route_id"].isin(route_ids_for_stop)]["route_type"].unique()
            
            # Pick first available type or -1 if none
            stop_modes[stop_id] = int(route_types[0]) if len(route_types) > 0 else -1

        # Build result
        results = []
        for _, row in nearby.iterrows():
            results.append({
                "stop_id": row["stop_id"],
                "stop_name": row["stop_name"],
                "lat": row["stop_lat"],
                "lon": row["stop_lon"],
                "distance_km": round(row["distance_km"], 2),
                "mode": stop_modes[row["stop_id"]]
            })

        return jsonify(results)

    except Exception as e:
        return jsonify({"error": str(e)}), 400
    
@app.route("/routes_from_to")
def routes_from_to():
    try:
        start_lat = float(request.args.get("start_lat"))
        start_lon = float(request.args.get("start_lon"))
        end_lat = float(request.args.get("end_lat"))
        end_lon = float(request.args.get("end_lon"))
        radius_km = float(request.args.get("radius_km", 1))



        start_nearby = get_nearest_stops(start_lat, start_lon, radius_km)
        end_nearby = get_nearest_stops(end_lat, end_lon, radius_km)

        start_ids = set(start_nearby["stop_id"])
        end_ids = set(end_nearby["stop_id"])

        start_trips = stop_times_df[stop_times_df["stop_id"].isin(start_ids)]["trip_id"]
        end_trips = stop_times_df[stop_times_df["stop_id"].isin(end_ids)]["trip_id"]

        common_trips = set(start_trips).intersection(set(end_trips))
        trip_info = trips_df[trips_df["trip_id"].isin(common_trips)]
        route_ids = trip_info["route_id"].unique()

        results = []
        for route_id in route_ids:
            route = routes_df[routes_df["route_id"] == route_id].iloc[0]
            trip_ids = trip_info[trip_info["route_id"] == route_id]["trip_id"]
            shape_id = trip_info[trip_info["route_id"] == route_id]["shape_id"].iloc[0]
            relevant_stop_times = stop_times_df[stop_times_df["trip_id"].isin(trip_ids)]
            

            route_start_stops = relevant_stop_times[relevant_stop_times["stop_id"].isin(start_ids)]
            route_end_stops = relevant_stop_times[relevant_stop_times["stop_id"].isin(end_ids)]


            if not route_start_stops.empty and not route_end_stops.empty:
                start_stop_id = route_start_stops.iloc[0]["stop_id"]
                end_stop_id = route_end_stops.iloc[0]["stop_id"]

                start_stop = start_nearby[start_nearby["stop_id"] == start_stop_id].iloc[0]
                end_stop = end_nearby[end_nearby["stop_id"] == end_stop_id].iloc[0]
                
                start_trip_ids = relevant_stop_times[relevant_stop_times["stop_id"] == start_stop_id]["trip_id"].tolist()
                next_departures = get_next_departures(start_trip_ids, start_stop_id)


                results.append({
                    "route_id": route.get("route_long_name", ""),
                    "shape_id": shape_id,
                    "next_departures": next_departures,
                    "start_stop": {
                        "stop_name": start_stop["stop_name"],
                        "stop_id": start_stop["stop_id"],
                        "distance_km": round(start_stop["distance_km"], 2),
                        "lat": start_stop["stop_lat"],
                        "lon": start_stop["stop_lon"]
                    },
                    "end_stop": {
                        "stop_name": end_stop["stop_name"],
                        "stop_id": end_stop["stop_id"],
                        "distance_km": round(end_stop["distance_km"], 2),
                        "lat": end_stop["stop_lat"],
                        "lon": end_stop["stop_lon"]
                    }
                })

        print(f"[routes_from_to] Found {len(results)} routes")
        unique_keys = set()
        unique_results = []
        for r in results:
            key = (r["route_id"], r["start_stop"]["stop_id"], r["end_stop"]["stop_id"])
            if key not in unique_keys:
                unique_keys.add(key)
                unique_results.append(r)
        results = sorted(unique_results, key=lambda r: r["start_stop"]["distance_km"])
        return jsonify(results)
    except Exception as e:
        print(f"[routes_from_to] ERROR: {e}")
        return jsonify({"error": str(e)}), 400
    
    
@app.route("/route_shape")
def route_shape():
    try:
        shape_id = request.args.get("shape_id")
        start_stop_id = request.args.get("start_stop_id")
        end_stop_id = request.args.get("end_stop_id")

        if not shape_id or not start_stop_id or not end_stop_id:
            return jsonify({"error": "Missing parameters"}), 400

        shape_points = shapes_df[shapes_df["shape_id"] == shape_id].sort_values("shape_pt_sequence")
        shape_coords = shape_points[["shape_pt_lat", "shape_pt_lon"]].values.tolist()

        # Get lat/lon for the stops
        start_row = stops_df[stops_df["stop_id"] == start_stop_id].iloc[0]
        end_row = stops_df[stops_df["stop_id"] == end_stop_id].iloc[0]
        start_coord = (start_row["stop_lat"], start_row["stop_lon"])
        end_coord = (end_row["stop_lat"], end_row["stop_lon"])

        # Find closest points in shape
        def closest_index(coord):
            return min(range(len(shape_coords)), key=lambda i: geodesic(coord, shape_coords[i]).meters)

        start_index = closest_index(start_coord)
        end_index = closest_index(end_coord)

        if start_index > end_index:
            shape_segment = shape_coords[end_index:start_index+1]
        else:
            shape_segment = shape_coords[start_index:end_index+1]

        return jsonify(shape_segment)
    except Exception as e:
        return jsonify({"error": str(e)}), 500



if __name__ == "__main__":
    app.run(debug=True)
