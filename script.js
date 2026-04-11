const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";

const ui = {
  searchForm: document.getElementById("searchForm"),
  locationInput: document.getElementById("locationInput"),
  myLocationBtn: document.getElementById("myLocationBtn"),
  statusText: document.getElementById("statusText"),
  locationName: document.getElementById("locationName"),
  coordinates: document.getElementById("coordinates"),
  tempC: document.getElementById("tempC"),
  tempF: document.getElementById("tempF"),
  humidityValue: document.getElementById("humidityValue"),
  windValue: document.getElementById("windValue"),
  pressureValue: document.getElementById("pressureValue"),
  precipValue: document.getElementById("precipValue"),
  dewValue: document.getElementById("dewValue"),
  feelsLikeValue: document.getElementById("feelsLikeValue"),
  dataNote: document.getElementById("dataNote"),
  dailySpan: document.getElementById("dailySpan"),
  dailyCards: document.getElementById("dailyCards"),
  observationTime: document.getElementById("observationTime"),
  hourlyRows: document.getElementById("hourlyRows"),
  mapCaption: document.getElementById("mapCaption"),
  mapSkeleton: document.getElementById("mapSkeleton"),
  sourceChip: document.getElementById("sourceChip"),
};

let map;
let marker;

const DEFAULT_LOCATION = {
  lat: 38.883,
  lon: -77.0163,
  name: "Washington, D.C., United States",
};

const toPrettyDate = (isoDate) => {
  return new Date(isoDate).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

const toLocalLabel = (isoDateTime) => {
  return new Date(isoDateTime).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const isValid = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));

const round = (value, digits = 1) => {
  if (!isValid(value)) return "--";
  return Number(value).toFixed(digits);
};

const cToF = (celsius) => (celsius * 9) / 5 + 32;

const calculateFeelsLike = (tempC, humidity) => {
  if (!isValid(tempC) || !isValid(humidity)) return null;

  // Heat index approximation for warm/humid conditions.
  if (tempC >= 27 && humidity >= 40) {
    const tempF = cToF(tempC);
    const hi =
      -42.379 +
      2.04901523 * tempF +
      10.14333127 * humidity -
      0.22475541 * tempF * humidity -
      0.00683783 * tempF * tempF -
      0.05481717 * humidity * humidity +
      0.00122874 * tempF * tempF * humidity +
      0.00085282 * tempF * humidity * humidity -
      0.00000199 * tempF * tempF * humidity * humidity;
    return (hi - 32) * (5 / 9);
  }

  return tempC;
};

const setStatus = (message, tone = "normal") => {
  ui.statusText.textContent = message;
  ui.statusText.style.color =
    tone === "error" ? "var(--danger)" : tone === "ok" ? "var(--ok)" : "var(--ink-soft)";
};

const setLoadingState = (isLoading) => {
  document.body.classList.toggle("loading", isLoading);
  if (ui.mapSkeleton) {
    ui.mapSkeleton.style.display = isLoading ? "block" : "none";
  }
};

const updateMap = (lat, lon, label) => {
  if (!map) {
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView([lat, lon], 8);

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri",
      }
    ).addTo(map);

    L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution: "Labels &copy; Esri",
      }
    ).addTo(map);
  } else {
    map.setView([lat, lon], 8);
  }

  if (!marker) {
    marker = L.marker([lat, lon]).addTo(map);
  } else {
    marker.setLatLng([lat, lon]);
  }

  marker.bindPopup(label).openPopup();
  ui.mapCaption.textContent = `${label} (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
};

const geocodePlace = async (query) => {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) throw new Error("Failed to resolve location");

  const places = await response.json();
  if (!Array.isArray(places) || places.length === 0) {
    throw new Error("No location matches that query");
  }

  const place = places[0];
  return {
    name: place.display_name,
    lat: Number(place.lat),
    lon: Number(place.lon),
  };
};

const reverseGeocode = async (lat, lon) => {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

  const place = await response.json();
  return place.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
};

const fetchLiveWeather = async (lat, lon) => {
  const search = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: "auto",
    forecast_days: "7",
    past_days: "1",
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,surface_pressure,wind_speed_10m,dew_point_2m,precipitation",
    hourly:
      "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,surface_pressure,dew_point_2m",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_max",
  });

  const response = await fetch(`${OPEN_METEO_BASE_URL}?${search.toString()}`);
  if (!response.ok) throw new Error("Live weather service is unavailable right now");

  return response.json();
};

const renderCurrentMetrics = (current, currentTime) => {
  const tempC = current.temperature_2m;
  const humidity = current.relative_humidity_2m;
  const windKmh = current.wind_speed_10m;
  const pressureHpa = current.surface_pressure;
  const precip = current.precipitation;
  const dew = current.dew_point_2m;
  const apparent = current.apparent_temperature;
  const feelsLike = isValid(apparent) ? apparent : calculateFeelsLike(tempC, humidity);

  ui.tempC.textContent = `${round(tempC)}°C`;
  ui.tempF.textContent = `${round(cToF(tempC))}°F`;
  ui.humidityValue.textContent = `${round(humidity)}%`;
  ui.windValue.textContent = `${round(windKmh / 3.6)} m/s (${round(windKmh)} km/h)`;
  ui.pressureValue.textContent = `${round(pressureHpa / 10, 2)} kPa`;
  ui.precipValue.textContent = `${round(precip, 2)} mm/h`;
  ui.dewValue.textContent = `${round(dew)} °C`;
  ui.feelsLikeValue.textContent = isValid(feelsLike) ? `${round(feelsLike)} °C` : "-- °C";
  ui.observationTime.textContent = currentTime
    ? `Observation (Local): ${toLocalLabel(currentTime)}`
    : "Observation (Local): --";
};

const renderDailyCards = (daily) => {
  const dates = daily?.time || [];
  const last7 = dates.slice(0, 7);
  ui.dailyCards.innerHTML = "";

  if (last7.length === 0) {
    ui.dailyCards.innerHTML = '<p class="day-label">No daily records available.</p>';
    return;
  }

  last7.forEach((date, index) => {
    const item = document.createElement("article");
    item.className = "day-card";
    item.innerHTML = `
      <p class="day-label">${toPrettyDate(date)}</p>
      <p class="day-temp">${round(daily.temperature_2m_max?.[index])} / ${round(daily.temperature_2m_min?.[index])}°C</p>
      <p class="day-meta">Rain: ${round(daily.precipitation_sum?.[index], 2)} mm</p>
      <p class="day-meta">RH: ${round(daily.relative_humidity_2m_mean?.[index])}%</p>
      <p class="day-meta">Wind: ${round((daily.wind_speed_10m_max?.[index] || 0) / 3.6)} m/s</p>
    `;
    ui.dailyCards.appendChild(item);
  });

  ui.dailySpan.textContent = `${toPrettyDate(last7[0])} - ${toPrettyDate(last7[last7.length - 1])}`;
};

const renderHourlyTable = (hourly) => {
  const times = hourly?.time || [];
  const now = Date.now();
  const rows = [];

  for (let i = 0; i < times.length; i += 1) {
    const ts = new Date(times[i]).getTime();
    if (Number.isNaN(ts) || ts > now) continue;

    const temp = hourly.temperature_2m?.[i];
    const humidity = hourly.relative_humidity_2m?.[i];
    const windKmh = hourly.wind_speed_10m?.[i];
    const precip = hourly.precipitation?.[i];

    if ([temp, humidity, windKmh, precip].some((value) => isValid(value))) {
      rows.push({
        time: times[i],
        temp,
        humidity,
        windMps: isValid(windKmh) ? windKmh / 3.6 : null,
        precip,
      });
    }
  }

  const latest24 = rows.slice(-24).reverse();
  ui.hourlyRows.innerHTML = "";

  if (latest24.length === 0) {
    ui.hourlyRows.innerHTML = '<tr><td colspan="5">No hourly records available.</td></tr>';
    return;
  }

  latest24.forEach((rowData) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${toLocalLabel(rowData.time)}</td>
      <td>${round(rowData.temp)}</td>
      <td>${round(rowData.humidity)}</td>
      <td>${round(rowData.windMps)}</td>
      <td>${round(rowData.precip, 2)}</td>
    `;
    ui.hourlyRows.appendChild(row);
  });
};

const loadWeatherForCoords = async ({ lat, lon, name, accuracy }) => {
  try {
    setLoadingState(true);
    setStatus("Fetching live weather feed...", "normal");

    const weather = await fetchLiveWeather(lat, lon);
    if (!weather?.current) {
      throw new Error("Live weather data is not available for this location");
    }

    ui.locationName.textContent = name;
    ui.coordinates.textContent = `Lat ${lat.toFixed(4)}, Lon ${lon.toFixed(4)}${
      typeof accuracy === "number" ? ` (GPS ±${Math.round(accuracy)}m)` : ""
    }`;
    renderCurrentMetrics(weather.current, weather.current.time);
    renderDailyCards(weather.daily);
    renderHourlyTable(weather.hourly);
    updateMap(lat, lon, name);

    if (ui.sourceChip) ui.sourceChip.textContent = "Source: Open-Meteo Live";

    ui.dataNote.textContent =
      "Live feed active from Open-Meteo. Values reflect latest same-day updates and near-term model refreshes.";
    setStatus("Data updated successfully.", "ok");
  } catch (error) {
    setStatus(error.message || "Failed to load weather data", "error");
  } finally {
    setLoadingState(false);
  }
};

const getCurrentPosition = (options) =>
  new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });

const detectAndLoadCurrentLocation = async ({ fallbackToDefault = false } = {}) => {
  if (!navigator.geolocation) {
    if (fallbackToDefault) {
      setStatus("Geolocation unsupported. Showing default location.", "error");
      await loadWeatherForCoords(DEFAULT_LOCATION);
      return;
    }
    setStatus("Geolocation is not supported by your browser", "error");
    return;
  }

  try {
    setStatus("Locating your device...", "normal");

    let position = await getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0,
    });

    // Retry once when the browser returns a very coarse fix.
    if (position.coords.accuracy > 10000) {
      setStatus("Location is coarse, retrying for better accuracy...", "normal");
      position = await getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 25000,
        maximumAge: 0,
      });
    }

    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    const name = await reverseGeocode(lat, lon);
    await loadWeatherForCoords({ lat, lon, name, accuracy });
  } catch {
    if (fallbackToDefault) {
      setStatus("Could not access your location. Showing default location.", "error");
      await loadWeatherForCoords(DEFAULT_LOCATION);
      return;
    }
    setStatus("Location permission denied. Search by city instead.", "error");
  }
};

ui.searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = ui.locationInput.value.trim();
  if (!query) return;

  try {
    setStatus("Resolving location...", "normal");
    const place = await geocodePlace(query);
    await loadWeatherForCoords(place);
  } catch (error) {
    setStatus(error.message || "Unable to resolve that location", "error");
  }
});

ui.myLocationBtn.addEventListener("click", () => {
  detectAndLoadCurrentLocation({ fallbackToDefault: false });
});

// Try real device location first; only then fall back to a default location.
detectAndLoadCurrentLocation({ fallbackToDefault: true });
