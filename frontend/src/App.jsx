import React, { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import debounce from 'lodash.debounce';
import { useMap } from "react-leaflet";
import { useRef } from "react";
import "./App.css";

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
  const [visibleModes, setVisibleModes] = useState([3, 4, 2, 0, 1]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const mapRef = useRef(null);

  const transportModes = {
    0: { label: "Tram", icon: "🚋", color: "#FF6B35" },
    1: { label: "Metro", icon: "🚇", color: "#4CAF50" },
    2: { label: "Rail", icon: "🚆", color: "#2196F3" },
    3: { label: "Bus", icon: "🚌", color: "#FF9800" },
    4: { label: "Ferry", icon: "⛴️", color: "#00BCD4" },
    5: { label: "Cable Tram", icon: "🚠", color: "#9C27B0" },
    6: { label: "Aerial Lift", icon: "🚡", color: "#795548" },
    7: { label: "Funicular", icon: "🚞", color: "#607D8B" }
  };

  const getRandomColor = () => {
    const colors = [
      "#FF5733", "#33FF57", "#3357FF", "#F39C12", "#8E44AD",
      "#00BCD4", "#FF9800", "#009688", "#E91E63", "#9C27B0"
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  // Geolocation
  useEffect(() => {
    if (navigator.geolocation) {
      setIsLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setUserPos([latitude, longitude]);
          fetchStops(latitude, longitude);
          setIsLoading(false);
        },
        () => {
          setError("Failed to get location. Please enter manually.");
          setIsLoading(false);
        }
      );
    } else {
      setError("Geolocation not supported. Please enter manually.");
    }
  }, []);

  const handleReset = () => {
    setRouteShapes({});
    setRoutesInfo([]);
    setDestSearchTerm("");
    setDestSuggestions([]);
    setSearchTerm("");
    setSelectedRouteId(null);
    setShowShape(false);
    setDestination(null);
    setError("");
  };

  const fetchStops = async (lat, lon) => {
    try {
      setIsLoading(true);
      const url = `http://127.0.0.1:5000/stops_nearby_with_mode?lat=${lat}&lon=${lon}&radius_km=10`;
      const res = await fetch(url);
      const data = await res.json();
      setStops(data);
      setIsLoading(false);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch stops.");
      setIsLoading(false);
    }
  };

  const fetchRoutes = async (lat, lon) => {
    if (!userPos) return;
    try {
      setIsLoading(true);
      const res = await fetch(`http://127.0.0.1:5000/routes_from_to?start_lat=${userPos[0]}&start_lon=${userPos[1]}&end_lat=${lat}&end_lon=${lon}&radius_km=1.5`);
      const data = await res.json();
      setRoutesInfo(data);
      setError(data.length === 0 ? "No routes found between these locations" : "");

      const colorMap = {};
      for (const route of data) {
        colorMap[route.route_id] = getRandomColor();
      }
      setRouteColors(colorMap);

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
      setIsLoading(false);
    } catch (e) {
      setError("Failed to load routes");
      setIsLoading(false);
    }
  };

  const debouncedSearch = useCallback(
    debounce((val) => {
      searchDestByName(val);
    }, 300),
    []
  );

  const searchDestByName = async (name) => {
    try {
      setIsLoading(true);
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
      setIsLoading(false);
    } catch (err) {
      console.error("Photon fetch error:", err);
      setError("Failed to fetch suggestions.");
      setDestSuggestions([]);
      setIsLoading(false);
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
    setDestSearchTerm(stop.stop_name);
    setDestSuggestions([]);
    setError("");
    setShowShape(false);

    try {
      setIsLoading(true);
      const res = await fetch(
        `http://127.0.0.1:5000/routes_from_to?start_lat=${userPos[0]}&start_lon=${userPos[1]}&end_lat=${stop.lat}&end_lon=${stop.lon}&radius_km=1.5`
      );
      const data = await res.json();

      setRoutesInfo(data);
      setRouteShapes({});

      const colorMap = {};
      for (const route of data) {
        colorMap[route.route_id] = getRandomColor();
      }
      setRouteColors(colorMap);

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

      if (data.length > 0) {
        setSelectedRouteId(data[0].route_id);
        setShowShape(true);
      } else {
        setSelectedRouteId(null);
      }
      setIsLoading(false);
    } catch (err) {
      console.error("Error fetching route:", err);
      setError("Failed to fetch route to selected stop.");
      setRoutesInfo([]);
      setSelectedRouteId(null);
      setIsLoading(false);
    }
  };

  const handleManualSubmit = () => {
    const coords = manualLat.split(",").map(s => s.trim());
    if (coords.length === 2) {
      const lat = parseFloat(coords[0]);
      const lon = parseFloat(coords[1]);
      if (!isNaN(lat) && !isNaN(lon)) {
        setUserPos([lat, lon]);
        fetchStops(lat, lon);
        setError("");
      } else {
        setError("Please enter valid latitude and longitude.");
      }
    } else {
      setError("Please enter coordinates in format: lat,lon");
    }
  };

  const createCustomIcon = (mode) => {
    const modeInfo = transportModes[mode] || transportModes[0];
    return new L.DivIcon({
      html: `<div style="
        background: ${modeInfo.color};
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        font-weight: bold;
      ">${modeInfo.icon}</div>`,
      className: 'custom-marker',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  };

  const AutoFitMap = ({ shape }) => {
    const map = useMap();

    useEffect(() => {
      if (shape && shape.length > 0) {
        const bounds = shape.map(([lat, lon]) => [lat, lon]);
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    }, [shape, map]);

    return null;
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <h1>🚇 Kochi Transit</h1>
          <button 
            className="collapse-btn"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '→' : '←'}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="sidebar-content">
            {error && (
              <div className="error-message">
                <span className="error-icon">⚠️</span>
                {error}
              </div>
            )}
            
            {isLoading && (
              <div className="loading-indicator">
                <div className="loading-spinner"></div>
                Loading...
              </div>
            )}

            {!userPos && (
              <div className="location-section">
                <h3>📍 Set Your Location</h3>
                <p className="section-description">Enter your coordinates to find nearby transit options</p>
                <input
                  type="text"
                  placeholder="Enter lat,lon (e.g., 9.9312, 76.2673)"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  className="input-field"
                />
                <button onClick={handleManualSubmit} className="primary-button">
                  Set Location
                </button>
              </div>
            )}

            {userPos && (
              <>
                <div className="search-section">
                  <h3>🎯 Find Routes</h3>
                  <p className="section-description">Search for destinations or enter coordinates</p>
                  <input
                    type="text"
                    placeholder="Search destination or enter lat,lon..."
                    value={destSearchTerm}
                    onChange={(e) => handleUnifiedDestSearch(e.target.value)}
                    className="input-field"
                  />

                  {destSuggestions.length > 0 && (
                    <div className="suggestions-list">
                      {destSuggestions.map((stop) => (
                        <div
                          key={stop.stop_id}
                          className="suggestion-item"
                          onClick={() => handleSetDestination(stop)}
                        >
                          <div className="suggestion-name">{stop.stop_name}</div>
                          <div className="suggestion-details">
                            {stop.state && `${stop.state}, `}India
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="filter-section">
                  <h3>🚊 Transport Modes</h3>
                  <p className="section-description">Filter stops by transport type</p>
                  <div className="mode-filters">
                    {Object.entries(transportModes).map(([mode, info]) => (
                      <button
                        key={mode}
                        className={`mode-filter ${visibleModes.includes(parseInt(mode)) ? 'active' : ''}`}
                        onClick={() =>
                          setVisibleModes((prev) =>
                            prev.includes(parseInt(mode))
                              ? prev.filter((m) => m !== parseInt(mode))
                              : [...prev, parseInt(mode)]
                          )
                        }
                        style={{ 
                          '--mode-color': info.color,
                          backgroundColor: visibleModes.includes(parseInt(mode)) ? info.color : 'transparent',
                          borderColor: info.color
                        }}
                      >
                        <span className="mode-icon">{info.icon}</span>
                        <span className="mode-label">{info.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {routesInfo.length > 0 && (
                  <div className="routes-section">
                    <div className="routes-header">
                      <h3>🛤️ Available Routes ({routesInfo.length})</h3>
                      <button onClick={handleReset} className="clear-button">
                        Clear All
                      </button>
                    </div>
                    
                    <div className="routes-list">
                      {routesInfo.map((route) => (
                        <div 
                          key={route.route_id} 
                          className={`route-card ${selectedRouteId === route.route_id ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedRouteId(route.route_id);
                            setShowShape(true);
                          }}
                        >
                          <div className="route-header">
                            <div 
                              className="route-color-indicator"
                              style={{ backgroundColor: routeColors[route.route_id] }}
                            ></div>
                            <div className="route-name">
                              {route.route_id || 'Unknown Route'}
                            </div>
                          </div>
                          
                          <div className="route-stops">
                            <div className="stop-info">
                              <span className="stop-label">From:</span>
                              <span className="stop-name">{route.start_stop.stop_name}</span>
                              <span className="stop-distance">({route.start_stop.distance_km} km)</span>
                            </div>
                            <div className="stop-info">
                              <span className="stop-label">To:</span>
                              <span className="stop-name">{route.end_stop.stop_name}</span>
                              <span className="stop-distance">({route.end_stop.distance_km} km)</span>
                            </div>
                          </div>

                          {route.next_departures && route.next_departures.length > 0 && (
                            <div className="departures">
                              <span className="departures-label">⏰ Next departures:</span>
                              <div className="departure-times">
                                {route.next_departures.slice(0, 3).map((time, idx) => (
                                  <span key={idx} className="departure-time">{time}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {userPos && (
                  <div className="location-info">
                    <h3>📍 Current Location</h3>
                    <p className="coordinates">
                      {userPos[0].toFixed(4)}, {userPos[1].toFixed(4)}
                    </p>
                    <p className="nearby-count">
                      {stops.filter(s => visibleModes.includes(s.mode)).length} nearby stops
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Map Container */}
      <div className="map-container">
        {userPos && (
          <MapContainer 
            center={userPos} 
            zoom={14} 
            style={{ height: "100%", width: "100%" }}
            whenCreated={(mapInstance) => { mapRef.current = mapInstance; }}
          >
            <TileLayer 
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://carto.com/">CARTO</a>' 
            />
            
            {/* User Location Marker */}
            <Marker position={userPos}>
              <Popup>
                <div className="popup-content">
                  <strong>📍 Your Location</strong>
                  <br />
                  <small>{userPos[0].toFixed(4)}, {userPos[1].toFixed(4)}</small>
                </div>
              </Popup>
            </Marker>

            {/* Transit Stops */}
            {stops
              .filter(s => s.lat !== undefined && s.lon !== undefined)
              .filter(s => s.stop_name.toLowerCase().includes(searchTerm.toLowerCase()))
              .filter(s => visibleModes.includes(s.mode))
              .map((stop) => (
                <Marker
                  key={stop.stop_id}
                  position={[stop.lat, stop.lon]}
                  icon={createCustomIcon(stop.mode)}
                >
                  <Popup>
                    <div className="popup-content">
                      <strong>{stop.stop_name}</strong>
                      <br />
                      <span className="popup-mode">
                        {transportModes[stop.mode]?.icon} {transportModes[stop.mode]?.label}
                      </span>
                      <br />
                      <span className="popup-distance">{stop.distance_km} km away</span>
                      <br />
                      <button
                        className="popup-button"
                        onClick={() => handleSetDestination(stop)}
                      >
                        Get Route Here
                      </button>
                    </div>
                  </Popup>
                </Marker>
              ))}

            {/* Route Shapes */}
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
                        opacity={0.8}
                      />
                    </>
                  )}
                  <Marker position={[r.end_stop.lat, r.end_stop.lon]}>
                    <Popup>
                      <div className="popup-content">
                        <strong>🎯 {r.end_stop.stop_name}</strong>
                        <br />
                        <span className="popup-route">Route: {r.route_id}</span>
                      </div>
                    </Popup>
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