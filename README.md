# NASA Weather Risk Analysis API

Análisis de riesgos climáticos basado en datos históricos de NASA POWER.

## Uso

### Servidor
```bash
npm run dev
```

### Endpoint
```
GET /weather?lat={lat}&lon={lon}&date={MMDD}&hour={0-23}
```

**Ejemplo:**
```bash
curl "http://localhost:3000/weather?lat=-17.3935&lon=-66.157&date=1004&hour=15"
```

## Respuesta

```json
{
  "location": { "lat": -17.3935, "lon": -66.157 },
  "date": "1004",
  "analysis": {
    "trendPrediction": {
      "tempMax": 28.4,
      "tempMin": 12.1,
      "trend": { ... }
    },
    "temperature": { "statistics": { ... }, "conditions": { ... } },
    "riskScores": {
      "frost": { "score": 15.2, "level": "BAJO", "recommendations": [...] },
      "storm": { "score": 42.8, "level": "MEDIO", "recommendations": [...] },
      "heatStress": { "score": 68.5, "level": "MEDIO", "recommendations": [...] }
    }
  },
  "hourlyForecast": {
    "hour": 15,
    "temperature": { "expected": 27.8, "range": { "min": 25.2, "max": 30.4 } }
  }
}
```

## Características

- Análisis estadístico sobre 30 años de datos históricos
- Detección de tendencias climáticas con regresión ponderada
- Umbrales adaptativos basados en proyecciones
- Predicción horaria con interpolación sinusoidal
- Risk scores compuestos (helada, tormenta, estrés térmico)
- Integración con datos de elevación topográfica

## Stack

- Node.js con ES Modules
- NASA POWER API (datos climatológicos)
- Open Topo Data API (elevación)

## Fuente de datos

NASA POWER API - https://power.larc.nasa.gov/docs/
