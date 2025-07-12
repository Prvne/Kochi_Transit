import React, { useState, useEffect,useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import debounce from 'lodash.debounce';
import { useMap } from "react-leaflet";
import { useRef } from "react";



function App() {
  const [userPos, setUserPos] = useState(null);
  const [stops, setStops] = useState([]);
  const [error, setError] = useState("");
  const [manualLat, setManualLat] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [destSearchTerm, setDestSearchTerm] = useState("");
  const [destSuggestions, setDestSuggestions] = useState([]);
  const [destination, setDestination] = useState(null);
  const [routesInfo, setRoutesInfo] = useState([]);
  const [routeShapes, setRouteShapes] = useState({});
  const [routeColors, setRouteColors] = useState({});
  const [showShape, setShowShape] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [visibleModes, setVisibleModes] = useState([3, 4, 0]); // 3 = bus, 4 = ferry, 0 = metro
  const mapRef = useRef(null);
  

  const getRandomColor = () => {
  const colors = [
    "#FF5733", "#33FF57", "#3357FF", "#F39C12", "#8E44AD",
    "#00BCD4", "#FF9800", "#009688", "#E91E63", "#9C27B0"
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};


//geolocation
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setUserPos([latitude, longitude]);
          fetchStops(latitude, longitude);
        },
        () => {
          setError("Failed to get location. Please enter manually.");
        }
      );
    } else {
      setError("Geolocation not supported. Please enter manually.");
    }
  }, []);
// to clear everythn
  const handleReset = () => {
  setRouteShapes({});
  setRoutesInfo([]);
  setDestSearchTerm("");
  setDestSuggestions([]);
  setSearchTerm("");
};
//getting nearby stops
  const fetchStops = async (lat, lon) => {
    try {
      const url = `http://127.0.0.1:5000/stops_nearby_with_mode?lat=${lat}&lon=${lon}&radius_km=10`;
      const res = await fetch(url);
      const data = await res.json();
      setStops(data);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch stops.");
    }
  };
//getting routes
 const fetchRoutes = async (lat, lon) => {
  if (!userPos) return;
  try {
    const res = await fetch(`http://127.0.0.1:5000/routes_from_to?start_lat=${userPos[0]}&start_lon=${userPos[1]}&end_lat=${lat}&end_lon=${lon}&radius_km=1.5`);
    const data = await res.json();
    setRoutesInfo(data);
    setError(data.length === 0 ? "No routes found" : "");

    const colorMap = {};
for (const route of data) {
  colorMap[route.route_id] = getRandomColor();
}
setRouteColors(colorMap); // for colors of routes


 //shape for polyline
    const shapeData = {};
    for (const route of data) {
      console.log("Fetching shape for:", route.shape_id);
      if (route.shape_id) {
        const shapeRes = await fetch(
  `http://127.0.0.1:5000/route_shape?shape_id=${route.shape_id}&start_stop_id=${route.start_stop.stop_id}&end_stop_id=${route.end_stop.stop_id}`
);
        const shapeCoords = await shapeRes.json();
        shapeData[route.route_id] = shapeCoords.map(([lat, lon]) => [lat, lon]);
      }
    }
    setRouteShapes(shapeData);
  } catch (e) {
    setError("Failed to load routes");
  }
};
 //delay for autocomplete
  const debouncedSearch = useCallback(
  debounce((val) => {
    searchDestByName(val);
  }, 300),
  [] 
)
//autocomplete
  const searchDestByName = async (name) => {
  try {
    const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(name)}&lang=en&limit=10`);
    const data = await response.json();

    if (data.features.length > 0) {
      const suggestions = data.features
        .map((feature) => {
          const [lon, lat] = feature.geometry.coordinates;
          return {
            stop_id: feature.properties.osm_id || feature.properties.name,
            stop_name: feature.properties.name,
            lat,
            lon,
            country: feature.properties.country,
            state: feature.properties.state || "",
          };
        })
        .filter((s) => {
          // Restrict to Kerala only
          const withinKeralaBounds =
            s.lat >= 8.0 && s.lat <= 12.7 && s.lon >= 74.8 && s.lon <= 77.5;

          const nameContainsKerala =
            (s.state && s.state.toLowerCase().includes("kerala")) ||
            (s.country && s.country.toLowerCase().includes("india"));

          return withinKeralaBounds && nameContainsKerala;
        });

      setDestSuggestions(suggestions);
    } else {
      setDestSuggestions([]);
      setError("No matching location found.");
    }
  } catch (err) {
    console.error("Photon fetch error:", err);
    setError("Failed to fetch suggestions.");
    setDestSuggestions([]);
  }
};



  const handleUnifiedDestSearch = (value) => {
    setDestSearchTerm(value);
    const parts = value.split(",").map(s => s.trim());
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lon = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lon)) {
        const dest = { stop_id: "manual", stop_name: "Manual Destination", lat, lon };
        setDestination(dest);
        fetchRoutes(lat, lon);
        setDestSuggestions([]);
        return;
      }
    }

    if (value.length >= 3) {
      debouncedSearch(value);
    } else {
      setDestSuggestions([]);
    }
  };

  const handleSetDestination = async (stop) => {
  setDestSearchTerm(stop.stop_name);    // update input
  setDestSuggestions([]);               // clear sidebar suggestions
  setError("");                         // clear any previous errors
  setShowShape(false);                  // temporarily hide shape while fetching

  try {
    const res = await fetch(
      `http://127.0.0.1:5000/routes_from_to?start_lat=${userPos[0]}&start_lon=${userPos[1]}&end_lat=${stop.lat}&end_lon=${stop.lon}&radius_km=1.5`
    );
    const data = await res.json();

    setRoutesInfo(data);                // show routes in sidebar
    setRouteShapes({});                // clear old shapes

    // Assign colors for route highlights
    const colorMap = {};
    for (const route of data) {
      colorMap[route.route_id] = getRandomColor();
    }
    setRouteColors(colorMap);

    // ✅ Load shape data BEFORE selecting route
    const shapeData = {};
    for (const route of data) {
      if (route.shape_id) {
        const shapeRes = await fetch(
          `http://127.0.0.1:5000/route_shape?shape_id=${route.shape_id}&start_stop_id=${route.start_stop.stop_id}&end_stop_id=${route.end_stop.stop_id}`
        );
        const shapeCoords = await shapeRes.json();
        shapeData[route.route_id] = shapeCoords.map(([lat, lon]) => [lat, lon]);
      }
    }
    setRouteShapes(shapeData);

    // ✅ Now it's safe to show the first route
    if (data.length > 0) {
      setSelectedRouteId(data[0].route_id);
      setShowShape(true);
    } else {
      setSelectedRouteId(null);
    }

  } catch (err) {
    console.error("Error fetching route:", err);
    setError("Failed to fetch route to selected stop.");
    setRoutesInfo([]);
    setSelectedRouteId(null);
  }
};


  const handleManualSubmit = () => {
    const lat = parseFloat(manualLat.split(",")[0]);
    const lon = parseFloat(manualLat.split(",")[1]);
    if (!isNaN(lat) && !isNaN(lon)) {
      setUserPos([lat, lon]);
      fetchStops(lat, lon);
      setError("");
    } else {
      setError("Please enter valid latitude and longitude.");
    }
  };

  const busIcon = new L.Icon({
    iconUrl: "/my_bus_icon1.png",
    iconSize: [15, 15]
  });

  const ferryIcon = new L.Icon({
    iconUrl: "/my_ferry_icon.png",
    iconSize: [25, 25]
  });

  const defaultIcon = new L.Icon({
    iconUrl: "/my_default_icon.png",
    iconSize: [25, 25]
  });
  
  const AutoFitMap = ({ shape }) => {
  const map = useMap();

  useEffect(() => {
    if (shape && shape.length > 0) {
      const bounds = shape.map(([lat, lon]) => [lat, lon]);
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }, [shape]);

  return null;
};


  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      <div style={{
        width: "320px",
        background: "#1e1e2f",
        color: "white",
        padding: "1rem",
        boxSizing: "border-box",
        overflowY: "auto",
        height: "100vh",
        fontFamily: "Segoe UI, sans-serif",
        borderRight: "1px solid #2e2e40",
        boxShadow: "2px 0 8px rgba(0, 0, 0, 0.4)"
      }}>
        <h1 style={{ fontSize: "1.5rem", color: "#00bcd4", marginBottom: "1rem" }}>Kochi Transit Map</h1>

        {error && <p style={{ color: "#f44336", fontSize: "0.9rem", marginBottom: "1rem" }}>{error}</p>}

        {!userPos && (
          <>
            <input
              type="text"
              placeholder="Enter lat,lon"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              style={{width: "92.5%",
                padding: "10px",
                background: "#2a2a3d",
                color: "#fff",
                border: "1px solid #444",
                borderRadius: "6px",
                marginBottom: "0.75rem"
                }}
            />
            <button onClick={handleManualSubmit} style={{width: "100%",
            padding: "10px",
            background: "#2196f3",
            color: "#fff",
            border: "none",
            borderRadius: "4px",cursor: "pointer"
        }}>
              Set Location
            </button>
            
          </>
        )}
        {userPos && (
          <>

            <input
              type="text"
              placeholder="Destination (name or lat,lon)"
              value={destSearchTerm}
              onChange={(e) => handleUnifiedDestSearch(e.target.value)}
              style={{ width: "92.5%",
                padding: "10px",
                background: "#2a2a3d",
                color: "#fff",
                border: "1px solid #444",
                borderRadius: "6px",
                marginBottom: "0.75rem" }}
            />

            {destSuggestions.map((stop) => (
              <div
                key={stop.stop_id}
                style={{ cursor: "pointer",
                  padding: "0.4rem 0.6rem",
                  marginBottom: "0.25rem",
                  borderRadius: "4px",
                  background: "#2e2e40",transition: "background 0.2s" }}
                onClick={() => handleSetDestination(stop)}
              >
                {stop.stop_name}
              </div>
            ))}

            {routesInfo.length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <h3 style={{ color: "#00bcd4", marginBottom: "0.5rem" }}>Routes:</h3>
                <button 
          onClick={handleReset}
          style={{
              width: "100%",
              padding: "10px",
              marginTop: "0.5rem",
              background: "#aa3333",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer"
            }}
            >
              Clear All
            </button>
                {routesInfo.map((route) => (
                  <div key={route.route_id} style={{ marginBottom: "0.5rem" }}>
                    <button onClick={() => {setSelectedRouteId(route.route_id);setShowShape(true);}}style={{
                      background:
                      selectedRouteId === route.route_id ? "#2f2f44" : "#2a2a3d",
                      border: "none",
                      padding: "12px",
                      color: "white",
                      textAlign: "left",
                      width: "100%",
                      borderLeft: `5px solid ${
                      selectedRouteId === route.route_id ? "#00bcd4" : "transparent"}`,
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                      marginBottom: "10px",
                      transition: "background 0.2s, border-color 0.2s"}}>
                      
                    <strong>{route.route_long_name || route.route_id}</strong>
                    <br />
                    Start: {route.start_stop.stop_name} ({route.start_stop.distance_km} km)
                    <br />
                    End: {route.end_stop.stop_name} ({route.end_stop.distance_km} km)
                    <br />
                    {route.next_departures && (
                      <span style={{ color: "#ccc" }}>
                      {route.next_departures && route.next_departures.length > 0 && (
                      <div style={{ marginTop: "0.3rem", fontSize: "0.85rem", color: "#ccc" }}>
                        Next Departures:
                        <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                          {route.next_departures.map((time, idx) => (
                            <li key={idx}>{time}</li>
                            ))}
                        </ul>
                      </div>
                    )}

                      </span>)}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: "100vh" }}>
        {userPos && (
          <MapContainer center={userPos} zoom={14} style={{ height: "100%", width: "100%" }} whenCreated={(mapInstance) => { mapRef.current = mapInstance;}}>
          <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            background: "#222",
            color: "#fff",
            padding: "10px",
            borderRadius: "10px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            fontSize: "0.85rem",
            width: "140px"
            }}>
              
            {[
              { mode: 3, label: "Bus 🚌" },
              { mode: 4, label: "Ferry ⛴" },
              { mode: 2, label: "Metro 🚇" },
              { mode: 0, label: "Other 🛑" }
            ].map(({ mode, label }) => (
            <button
            key={mode}
            onClick={() =>
            setVisibleModes((prev) =>
            prev.includes(mode)
            ? prev.filter((m) => m !== mode)
            : [...prev, mode]
        )
      }
      style={{
        background: visibleModes.includes(mode) ? "#2196f3" : "#555",
        color: "#fff",
        border: "none",
        borderRadius: "4px",
        padding: "6px",
        cursor: "pointer",
        transition: "background 0.2s ease"
      }}
    >
      {label}
    </button>
  ))}
</div>

            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>' />
            <Marker position={userPos}>
              <Popup>You are here</Popup>
            </Marker>
            {stops
              .filter(s => s.lat !== undefined && s.lon !== undefined)
              .filter(s => s.stop_name.toLowerCase().includes(searchTerm.toLowerCase()))
              .filter((stop) => 
                stop.stop_name.toLowerCase().includes(searchTerm.toLowerCase())
              )
              .filter(s => visibleModes.includes(s.mode))
              .map((stop) => (
                <Marker
                  key={stop.stop_id}
                  position={[stop.lat, stop.lon]}
                  icon={
                    stop.mode === 3
                      ? busIcon
                      : stop.mode === 4
                      ? ferryIcon
                      : defaultIcon
                  }
                >
                  <Popup>
                    <strong>{stop.stop_name}</strong><br />
                    {stop.distance_km} km away<br />
                    Mode: {stop.mode === 3 ? "Bus" : stop.mode === 4 ? "Ferry" : "Other"}<br />
                    <button
                    style={{
                      background: "#2196f3",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      padding: "6px 10px",
                      cursor: "pointer"
                    }}
                    onClick={() => handleSetDestination(stop)}>
                      Route to this stop
                    </button>
                  </Popup>
                </Marker>
              ))}
              {routesInfo
  .filter(r => r.route_id === selectedRouteId && showShape)
  .map(r => (
    <React.Fragment key={r.route_id}>
      {routeShapes[r.route_id] && (
        <>
          <AutoFitMap shape={routeShapes[r.route_id]} />
          <Polyline
            positions={routeShapes[r.route_id]}
            color={routeColors[r.route_id] || "#00bcd4"}
            weight={5}
          />
        </>
      )}
      <Marker position={[r.end_stop.lat, r.end_stop.lon]}>
        <Popup>{r.end_stop.stop_name}</Popup>
      </Marker>
    </React.Fragment>
))}


          </MapContainer>
        )}
      </div>
    </div>
  );
}

export default App;
