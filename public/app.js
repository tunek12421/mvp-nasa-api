// Global variables
let map;
let marker;
let currentLat = -17.3935;
let currentLon = -66.1570;
let tempChart = null;
let conditionsChart = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initEventListeners();
  setDefaultDate();
});

// Initialize Leaflet map
function initMap() {
  map = L.map('map').setView([currentLat, currentLon], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(map);

  marker = L.marker([currentLat, currentLon], { draggable: true }).addTo(map);

  // Update coordinates when marker is dragged
  marker.on('dragend', (e) => {
    const position = e.target.getLatLng();
    updateCoordinates(position.lat, position.lng);
  });

  // Update coordinates when map is clicked
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    marker.setLatLng([lat, lng]);
    updateCoordinates(lat, lng);
  });
}

// Update coordinate displays
function updateCoordinates(lat, lon) {
  currentLat = parseFloat(lat.toFixed(4));
  currentLon = parseFloat(lon.toFixed(4));
  document.getElementById('lat-display').textContent = currentLat;
  document.getElementById('lon-display').textContent = currentLon;
}

// Set default date to today
function setDefaultDate() {
  const today = new Date();
  const dateString = today.toISOString().split('T')[0];
  document.getElementById('date-input').value = dateString;
}

// Initialize event listeners
function initEventListeners() {
  document.getElementById('analyze-btn').addEventListener('click', analyzeWeather);
  document.getElementById('search-btn').addEventListener('click', searchLocation);

  // Allow Enter key in search
  document.getElementById('location-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchLocation();
    }
  });
}

// Search location using Nominatim API
async function searchLocation() {
  const query = document.getElementById('location-search').value.trim();

  if (!query) {
    alert('Por favor ingresa una ubicación');
    return;
  }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`
    );
    const results = await response.json();

    if (results.length === 0) {
      alert('No se encontró la ubicación. Intenta con otro nombre.');
      return;
    }

    const { lat, lon, display_name } = results[0];
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);

    // Update map and coordinates
    map.setView([latNum, lonNum], 10);
    marker.setLatLng([latNum, lonNum]);
    updateCoordinates(latNum, lonNum);

    console.log(`Ubicación encontrada: ${display_name}`);
  } catch (error) {
    console.error('Error buscando ubicación:', error);
    alert('Error al buscar la ubicación. Intenta nuevamente.');
  }
}

// Analyze weather
async function analyzeWeather() {
  const dateInput = document.getElementById('date-input').value;
  const hourInput = document.getElementById('hour-input').value;

  if (!dateInput) {
    alert('Por favor selecciona una fecha');
    return;
  }

  // Convert date to MMDD format
  const date = new Date(dateInput);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateMMDD = `${month}${day}`;

  // Show loading
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('results').classList.add('hidden');
  document.getElementById('analyze-btn').disabled = true;

  try {
    // Build API URL
    let apiUrl = `http://localhost:3000/weather?lat=${currentLat}&lon=${currentLon}&date=${dateMMDD}`;
    if (hourInput) {
      apiUrl += `&hour=${hourInput}`;
    }

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const data = await response.json();
    displayResults(data);

  } catch (error) {
    console.error('Error al analizar clima:', error);
    alert('Error al consultar la API. Asegúrate de que el servidor esté corriendo en el puerto 3000.');
  } finally {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('analyze-btn').disabled = false;
  }
}

// Display results
function displayResults(data) {
  // Show results section
  document.getElementById('results').classList.remove('hidden');

  // Scroll to results
  document.getElementById('results').scrollIntoView({ behavior: 'smooth' });

  // Location info
  document.getElementById('result-location').textContent =
    `${data.location.lat}, ${data.location.lon}`;
  document.getElementById('result-date').textContent =
    `${data.day} de ${data.monthName} | Análisis basado en ${data.metadata.yearsAnalyzed} años de datos históricos`;

  // Hourly forecast (if available)
  if (data.hourlyForecast) {
    document.getElementById('hourly-section').classList.remove('hidden');
    document.getElementById('hourly-temp').textContent =
      `${data.hourlyForecast.temperature.expected}°C`;
    document.getElementById('hourly-rain').textContent =
      `${data.hourlyForecast.precipitation.probability}%`;
    document.getElementById('hourly-note').textContent =
      data.hourlyForecast.precipitation.note;
  } else {
    document.getElementById('hourly-section').classList.add('hidden');
  }

  // Risk scores
  displayRiskScores(data.analysis.riskScores);

  // Temperature stats
  displayTemperatureStats(data.analysis);

  // Charts
  displayCharts(data.analysis);

  // Detailed stats table
  displayStatsTable(data.analysis);
}

// Display risk scores
function displayRiskScores(riskScores) {
  const risks = [
    { id: 'frost', data: riskScores.frost },
    { id: 'storm', data: riskScores.storm },
    { id: 'heat', data: riskScores.heatStress }
  ];

  risks.forEach(({ id, data }) => {
    const card = document.getElementById(`${id}-risk`);
    const level = data.level.toLowerCase();

    // Update card styling
    card.className = 'risk-card risk-' + level;

    // Update score
    document.getElementById(`${id}-score`).textContent = data.score;

    // Update level
    document.getElementById(`${id}-level`).textContent = data.level;

    // Update recommendations
    const recList = document.getElementById(`${id}-recommendations`);
    recList.innerHTML = '';
    data.recommendations.forEach(rec => {
      const li = document.createElement('li');
      li.textContent = rec;
      recList.appendChild(li);
    });
  });
}

// Display temperature statistics
function displayTemperatureStats(analysis) {
  const trend = analysis.trendPrediction;

  // Max temperature
  document.getElementById('temp-max-pred').textContent =
    `${trend.tempMax}°C`;
  document.getElementById('temp-max-trend').textContent =
    `Tendencia: ${trend.trend.max.slope > 0 ? '+' : ''}${trend.trend.max.slope}°C/año`;

  // Min temperature
  document.getElementById('temp-min-pred').textContent =
    `${trend.tempMin}°C`;
  document.getElementById('temp-min-trend').textContent =
    `Tendencia: ${trend.trend.min.slope > 0 ? '+' : ''}${trend.trend.min.slope}°C/año`;

  // Average temperature
  document.getElementById('temp-avg').textContent =
    `${analysis.temperature.statistics.mean}°C`;
  document.getElementById('temp-range').textContent =
    `Rango: ${analysis.temperature.statistics.min}°C - ${analysis.temperature.statistics.max}°C`;
}

// Display charts
function displayCharts(analysis) {
  // Temperature distribution chart
  const tempCtx = document.getElementById('temp-chart').getContext('2d');

  if (tempChart) {
    tempChart.destroy();
  }

  tempChart = new Chart(tempCtx, {
    type: 'bar',
    data: {
      labels: ['P10', 'P25', 'Mediana', 'Media', 'P75', 'P90'],
      datasets: [
        {
          label: 'Temp. Máxima (°C)',
          data: [
            analysis.temperature.max.statistics.percentiles.p10,
            analysis.temperature.max.statistics.percentiles.p25,
            analysis.temperature.max.statistics.median,
            analysis.temperature.max.statistics.mean,
            analysis.temperature.max.statistics.percentiles.p75,
            analysis.temperature.max.statistics.percentiles.p90
          ],
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderColor: 'rgba(239, 68, 68, 1)',
          borderWidth: 1
        },
        {
          label: 'Temp. Mínima (°C)',
          data: [
            analysis.temperature.min.statistics.percentiles.p10,
            analysis.temperature.min.statistics.percentiles.p25,
            analysis.temperature.min.statistics.median,
            analysis.temperature.min.statistics.mean,
            analysis.temperature.min.statistics.percentiles.p75,
            analysis.temperature.min.statistics.percentiles.p90
          ],
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'top',
        },
        title: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: false
        }
      }
    }
  });

  // Conditions probabilities chart
  const condCtx = document.getElementById('conditions-chart').getContext('2d');

  if (conditionsChart) {
    conditionsChart.destroy();
  }

  conditionsChart = new Chart(condCtx, {
    type: 'doughnut',
    data: {
      labels: [
        `Muy caluroso (${analysis.temperature.conditions.veryHot.probability}%)`,
        `Muy frío (${analysis.temperature.conditions.veryCold.probability}%)`,
        `Muy ventoso (${analysis.wind.conditions.veryWindy.probability}%)`,
        `Muy húmedo (${analysis.humidity.conditions.veryHumid.probability}%)`,
        `Lluvia intensa (${analysis.precipitation.conditions.heavyRain.probability}%)`
      ],
      datasets: [{
        data: [
          analysis.temperature.conditions.veryHot.probability,
          analysis.temperature.conditions.veryCold.probability,
          analysis.wind.conditions.veryWindy.probability,
          analysis.humidity.conditions.veryHumid.probability,
          analysis.precipitation.conditions.heavyRain.probability
        ],
        backgroundColor: [
          'rgba(239, 68, 68, 0.7)',
          'rgba(59, 130, 246, 0.7)',
          'rgba(156, 163, 175, 0.7)',
          'rgba(16, 185, 129, 0.7)',
          'rgba(99, 102, 241, 0.7)'
        ],
        borderColor: [
          'rgba(239, 68, 68, 1)',
          'rgba(59, 130, 246, 1)',
          'rgba(156, 163, 175, 1)',
          'rgba(16, 185, 129, 1)',
          'rgba(99, 102, 241, 1)'
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'right',
        }
      }
    }
  });
}

// Display stats table
function displayStatsTable(analysis) {
  const tbody = document.getElementById('stats-table-body');
  tbody.innerHTML = '';

  const variables = [
    { name: 'Temperatura Promedio', stats: analysis.temperature.statistics, unit: '°C' },
    { name: 'Temperatura Máxima', stats: analysis.temperature.max.statistics, unit: '°C' },
    { name: 'Temperatura Mínima', stats: analysis.temperature.min.statistics, unit: '°C' },
    { name: 'Viento Promedio', stats: analysis.wind.statistics, unit: 'm/s' },
    { name: 'Viento Máximo', stats: analysis.wind.max.statistics, unit: 'm/s' },
    { name: 'Humedad', stats: analysis.humidity.statistics, unit: '%' },
    { name: 'Precipitación', stats: analysis.precipitation.statistics, unit: 'mm' }
  ];

  variables.forEach(({ name, stats, unit }) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${name}</strong></td>
      <td>${stats.mean}${unit}</td>
      <td>${stats.median}${unit}</td>
      <td>${stats.min}${unit}</td>
      <td>${stats.max}${unit}</td>
      <td>${stats.stdDev}${unit}</td>
    `;
    tbody.appendChild(row);
  });
}
