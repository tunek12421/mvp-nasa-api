# MVP - NASA POWER API

Prueba de concepto para consumir NASA POWER API y calcular probabilidades de condiciones climáticas extremas.

## 🚀 Inicio Rápido

### 1. Probar API directamente (sin servidor)
```bash
npm test
```

Esto ejecuta `test-nasa-power.js` que:
- Consulta datos climatológicos históricos (30 años)
- Analiza temperatura, precipitación, viento, humedad
- Calcula probabilidades de condiciones extremas

### 2. Servidor HTTP con endpoint
```bash
npm run dev
```

El servidor expone:
- **URL**: `http://localhost:3000`
- **Endpoint**: `/weather?lat={lat}&lon={lon}&month={month}`

#### Ejemplo:
```bash
curl "http://localhost:3000/weather?lat=19.4326&lon=-99.1332&month=3"
```

## 📊 ¿Qué datos obtenemos?

### Parámetros de NASA POWER API:
- **T2M**: Temperatura promedio a 2m (°C)
- **T2M_MAX**: Temperatura máxima (°C)
- **T2M_MIN**: Temperatura mínima (°C)
- **PRECTOTCORR**: Precipitación total corregida (mm)
- **RH2M**: Humedad relativa a 2m (%)
- **WS2M**: Velocidad del viento a 2m (m/s)
- **WS2M_MAX**: Velocidad máxima del viento (m/s)

### Condiciones que calculamos:
1. ☀️ **Muy caluroso** (>35°C)
2. ❄️ **Muy frío** (<5°C)
3. 💨 **Muy ventoso** (>10 m/s)
4. 💧 **Muy húmedo** (>80%)
5. 🌧️ **Lluvia intensa** (>100mm)

## 📡 API Response Example

```json
{
  "location": {
    "lat": 19.4326,
    "lon": -99.1332
  },
  "month": 3,
  "period": "1991-2020",
  "conditions": {
    "veryHot": {
      "probability": 10,
      "avgTemp": 26.5,
      "threshold": 35,
      "unit": "°C"
    },
    "veryCold": {
      "probability": 10,
      "avgTemp": 12.3,
      "threshold": 5,
      "unit": "°C"
    },
    "veryWindy": {
      "probability": 50,
      "avgWind": 8.5,
      "threshold": 10,
      "unit": "m/s"
    },
    "veryHumid": {
      "probability": 50,
      "avgHumidity": 65.2,
      "threshold": 80,
      "unit": "%"
    },
    "heavyRain": {
      "probability": 10,
      "avgRain": 15.4,
      "threshold": 100,
      "unit": "mm"
    }
  }
}
```

## 🔑 Sin API Key Necesaria

NASA POWER API es **completamente gratuita** y **no requiere autenticación**.

## 📚 Documentación NASA POWER

- **API Docs**: https://power.larc.nasa.gov/docs/
- **Parámetros disponibles**: https://power.larc.nasa.gov/docs/services/api/
- **Período de datos**: 1981 - presente

## ✅ Próximos pasos para el Desafío 18

1. ✅ Consumir NASA POWER API (HECHO)
2. ✅ Calcular probabilidades basadas en históricos (HECHO)
3. 🔄 Crear interfaz web para seleccionar ubicación y fecha
4. 🔄 Integrar con mapa para selección visual de ubicación
5. 🔄 Visualizar probabilidades con gráficos
6. 🔄 Comparar con pronósticos actuales (OpenWeatherMap)

## 🛠️ Stack Técnico Actual

- Node.js (ES Modules)
- Fetch API nativa
- HTTP server nativo (sin dependencias)

## 📝 Notas

- Los datos son **promedios climatológicos** de 30 años (1991-2020)
- Las probabilidades se calculan comparando valores históricos con umbrales definidos
- Para eventos específicos se necesitaría análisis estadístico más complejo (desviación estándar, percentiles, etc.)
# mvp-nasa-api
