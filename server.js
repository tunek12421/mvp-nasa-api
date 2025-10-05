/**
 * Servidor simple para exponer endpoint que consume NASA POWER API
 */

import http from 'http';
import url from 'url';

const PORT = 3000;
const BASE_URL_DAILY = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const ELEVATION_API_URL = 'https://api.opentopodata.org/v1/srtm30m';

// Cache simple de elevaciones para evitar consultas repetidas
const elevationCache = new Map();

/**
 * INNOVACIÓN: Obtiene elevación usando Open Topo Data (SRTM 30m)
 * Cache de resultados para no exceder rate limit (1000 req/día)
 */
async function getElevation(lat, lon) {
  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;

  // Revisar cache primero
  if (elevationCache.has(cacheKey)) {
    console.log(`   📍 Elevación (cache): ${elevationCache.get(cacheKey)}m`);
    return elevationCache.get(cacheKey);
  }

  try {
    const url = `${ELEVATION_API_URL}?locations=${lat},${lon}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`⚠️  No se pudo obtener elevación (HTTP ${response.status}), usando 0m`);
      return 0;
    }

    const data = await response.json();

    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const elevation = data.results[0].elevation;
      elevationCache.set(cacheKey, elevation);
      console.log(`   📍 Elevación (API): ${elevation}m`);
      return elevation;
    }

    console.warn('⚠️  No se pudo obtener elevación, usando 0m');
    return 0;

  } catch (error) {
    console.warn(`⚠️  Error obteniendo elevación: ${error.message}, usando 0m`);
    return 0;
  }
}

/**
 * Obtiene datos climatológicos diarios históricos de NASA POWER
 */
async function getNasaPowerDailyData(lat, lon, startDate, endDate) {
  console.log('\n🔍 === PASO 1: Preparando consulta NASA POWER API (DAILY) ===');

  const parameters = [
    'T2M',
    'T2M_MAX',
    'T2M_MIN',
    'PRECTOTCORR',
    'RH2M',
    'WS2M',
    'WS2M_MAX',
  ].join(',');

  const apiUrl = `${BASE_URL_DAILY}?parameters=${parameters}&community=RE&longitude=${lon}&latitude=${lat}&start=${startDate}&end=${endDate}&format=JSON`;

  console.log(`📍 Ubicación: lat=${lat}, lon=${lon}`);
  console.log(`📅 Período: ${startDate} - ${endDate}`);
  console.log(`📊 Parámetros: ${parameters}`);
  console.log(`🔗 URL: ${apiUrl.substring(0, 100)}...`);

  console.log('\n⏳ Consultando NASA...');
  const response = await fetch(apiUrl);

  if (!response.ok) {
    console.error(`❌ Error HTTP: ${response.status}`);
    throw new Error(`NASA API error: ${response.status}`);
  }

  console.log('✅ Respuesta recibida de NASA');
  const data = await response.json();

  const paramCount = Object.keys(data.properties.parameter).length;
  console.log(`📦 Parámetros recibidos: ${paramCount}`);

  return data;
}

/**
 * Utilidades
 */

// Obtener nombre del mes
function getMonthName(monthNum) {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  return months[monthNum - 1] || 'Desconocido';
}

/**
 * Interpola temperatura para una hora específica basada en min/max diarios
 * Usa curva sinusoidal que modela el ciclo diario real de temperatura
 */
function interpolateHourlyTemperature(tempMin, tempMax, hour) {
  // Parámetros del modelo:
  // - Temp mínima ocurre ~6am (hora 6)
  // - Temp máxima ocurre ~3pm (hora 15)
  // - Usa función sinusoidal desplazada

  const hourOfMin = 6;  // 6 AM
  const hourOfMax = 15; // 3 PM

  // Calcular fase del día (0 = mínimo, π = máximo)
  let phase;
  if (hour >= hourOfMin && hour <= hourOfMax) {
    // Ascenso: de mín (6am) a máx (3pm)
    phase = ((hour - hourOfMin) / (hourOfMax - hourOfMin)) * Math.PI;
  } else if (hour > hourOfMax) {
    // Descenso: de máx (3pm) a mín (6am siguiente)
    const hoursToNextMin = (24 - hour) + hourOfMin;
    const totalDescentHours = (24 - hourOfMax) + hourOfMin;
    phase = Math.PI + ((hoursToNextMin / totalDescentHours) * Math.PI);
  } else {
    // Madrugada: continuación del descenso
    const hoursFromPrevMax = (24 - hourOfMax) + hour;
    const totalDescentHours = (24 - hourOfMax) + hourOfMin;
    phase = Math.PI + ((1 - hoursFromPrevMax / totalDescentHours) * Math.PI);
  }

  // Interpolar con coseno (suaviza la curva)
  const temp = tempMin + (tempMax - tempMin) * (1 - Math.cos(phase)) / 2;
  return parseFloat(temp.toFixed(1));
}

/**
 * Calcula factor de probabilidad de lluvia por hora
 * En región andina, lluvia más probable en tarde (2-6pm)
 */
function getHourlyRainFactor(hour) {
  if (hour >= 14 && hour <= 18) {
    return 1.5; // 50% más probable en tarde
  } else if (hour >= 19 || hour <= 5) {
    return 0.3; // 70% menos probable de noche/madrugada
  }
  return 1.0; // Normal resto del día
}

/**
 * Funciones estadísticas
 */

// Calcular percentil
function calculatePercentile(arr, percentile) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

// Calcular desviación estándar
function calculateStdDev(arr, mean) {
  if (arr.length === 0) return 0;
  const squareDiffs = arr.map(value => Math.pow(value - mean, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(avgSquareDiff);
}

// Calcular intervalo de confianza 95%
function calculateConfidenceInterval(mean, stdDev, n) {
  if (n === 0) return { lower: 0, upper: 0, margin: 0 };
  const zScore = 1.96; // 95% confianza
  const marginError = zScore * (stdDev / Math.sqrt(n));

  return {
    lower: mean - marginError,
    upper: mean + marginError,
    margin: marginError
  };
}

// Calcular probabilidad real basada en datos históricos
function calculateRealProbability(values, threshold, isAbove = true) {
  if (values.length === 0) return 0;
  const count = values.filter(v =>
    isAbove ? v > threshold : v < threshold
  ).length;

  return (count / values.length) * 100;
}

// Calcular estadísticas completas de un array
function calculateStatistics(values) {
  if (values.length === 0) {
    return {
      mean: 0,
      median: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      count: 0,
      percentiles: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
      confidenceInterval95: { lower: 0, upper: 0, margin: 0 }
    };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = calculateStdDev(values, mean);
  const ci95 = calculateConfidenceInterval(mean, stdDev, values.length);

  return {
    mean: parseFloat(mean.toFixed(2)),
    median: parseFloat(calculatePercentile(values, 50).toFixed(2)),
    stdDev: parseFloat(stdDev.toFixed(2)),
    min: parseFloat(Math.min(...values).toFixed(2)),
    max: parseFloat(Math.max(...values).toFixed(2)),
    count: values.length,
    percentiles: {
      p10: parseFloat(calculatePercentile(values, 10).toFixed(2)),
      p25: parseFloat(calculatePercentile(values, 25).toFixed(2)),
      p50: parseFloat(calculatePercentile(values, 50).toFixed(2)),
      p75: parseFloat(calculatePercentile(values, 75).toFixed(2)),
      p90: parseFloat(calculatePercentile(values, 90).toFixed(2))
    },
    confidenceInterval95: {
      lower: parseFloat(ci95.lower.toFixed(2)),
      upper: parseFloat(ci95.upper.toFixed(2)),
      margin: parseFloat(ci95.margin.toFixed(2))
    }
  };
}

/**
 * Calcula probabilidades de condiciones extremas con análisis estadístico completo (DIARIO)
 * INNOVACIÓN: Aplica corrección topográfica por elevación
 */
function calculateDailyProbabilities(data, targetDate, elevation = 0) {
  console.log('\n🔍 === PASO 2: Procesando datos diarios ===');
  console.log(`📅 Fecha objetivo: ${targetDate}`);
  console.log(`🏔️  Elevación: ${elevation}m`);

  const params = data.properties.parameter;

  // NOTA: Los umbrales se calcularán dinámicamente después del análisis de tendencia
  // (ver después de calcular tempMaxTrend y tempMinTrend)
  const baseThresholds = {
    veryHot: 35,
    veryCold: 5,
    veryWindy: 10,
    veryHumid: 80,
    heavyRain: 10 // Para días específicos, 10mm es lluvia significativa
  };

  // Extraer mes y día del target date (formato: MMDD)
  const targetMonth = parseInt(targetDate.substring(0, 2));
  const targetDay = parseInt(targetDate.substring(2, 4));

  // Obtener TODOS los valores del mismo día/mes de todos los años históricos CON AÑO
  const getDailyValuesWithYear = (paramName) => {
    const values = [];
    const paramData = params[paramName];

    if (!paramData) return [];

    // Los datos diarios vienen como "YYYYMMDD": valor
    for (const [dateStr, value] of Object.entries(paramData)) {
      if (dateStr.length === 8) { // Formato YYYYMMDD
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6));
        const day = parseInt(dateStr.substring(6, 8));

        // Comparar mismo día y mes de diferentes años
        // Filtrar valores -999 (datos faltantes en NASA POWER API)
        if (month === targetMonth && day === targetDay && typeof value === 'number' && value > -900) {
          values.push({ year, value });
        }
      }
    }

    return values.sort((a, b) => a.year - b.year); // Ordenar por año
  };

  // Obtener valores del día anterior para análisis de persistencia
  const getPreviousDayValues = (paramName) => {
    const values = [];
    const paramData = params[paramName];

    if (!paramData) return [];

    // Calcular día anterior (simplificado, no maneja cambio de mes)
    const prevDay = targetDay - 1;
    if (prevDay < 1) return []; // Skip si es el primer día del mes

    for (const [dateStr, value] of Object.entries(paramData)) {
      if (dateStr.length === 8) {
        const month = parseInt(dateStr.substring(4, 6));
        const day = parseInt(dateStr.substring(6, 8));

        if (month === targetMonth && day === prevDay && typeof value === 'number' && value > -900) {
          values.push(value);
        }
      }
    }

    return values;
  };

  // Obtener valores de todos los años para cada parámetro CON ANÁLISIS DE TENDENCIA
  console.log('\n📊 Extrayendo valores históricos del mismo día...');
  const tempMaxData = getDailyValuesWithYear('T2M_MAX');
  const tempMinData = getDailyValuesWithYear('T2M_MIN');
  const tempAvgData = getDailyValuesWithYear('T2M');

  // Extraer solo valores para estadísticas tradicionales
  const tempMaxValues = tempMaxData.map(d => d.value);
  const tempMinValues = tempMinData.map(d => d.value);
  const tempAvgValues = tempAvgData.map(d => d.value);
  const windMaxValues = getDailyValuesWithYear('WS2M_MAX').map(d => d.value);
  const windAvgValues = getDailyValuesWithYear('WS2M').map(d => d.value);
  const humidityValues = getDailyValuesWithYear('RH2M').map(d => d.value);
  const rainValues = getDailyValuesWithYear('PRECTOTCORR').map(d => d.value);

  // ANÁLISIS DE TENDENCIA: Calcular si hay calentamiento/enfriamiento
  // INNOVACIÓN: Usa regresión PONDERADA para dar más peso a años recientes
  const calculateTrend = (dataWithYear, currentYear) => {
    if (dataWithYear.length < 10) return { slope: 0, confidence: 'low', method: 'insufficient_data' };

    // WEIGHTED REGRESSION: Mayor peso a años recientes (decaimiento exponencial)
    // τ = 5 años (constante de tiempo)
    const dataWithWeights = dataWithYear.map(d => ({
      ...d,
      weight: Math.exp(-(currentYear - d.year) / 5)
    }));

    const sumWeights = dataWithWeights.reduce((sum, d) => sum + d.weight, 0);
    const sumWX = dataWithWeights.reduce((sum, d) => sum + d.weight * d.year, 0);
    const sumWY = dataWithWeights.reduce((sum, d) => sum + d.weight * d.value, 0);
    const sumWXY = dataWithWeights.reduce((sum, d) => sum + d.weight * d.year * d.value, 0);
    const sumWXX = dataWithWeights.reduce((sum, d) => sum + d.weight * d.year * d.year, 0);

    const slope = (sumWXY - (sumWX * sumWY) / sumWeights) / (sumWXX - (sumWX * sumWX) / sumWeights);
    const intercept = (sumWY - slope * sumWX) / sumWeights;

    // Calcular R² ponderado para confianza
    const yMeanWeighted = sumWY / sumWeights;
    const ssTotalWeighted = dataWithWeights.reduce((sum, d) =>
      sum + d.weight * Math.pow(d.value - yMeanWeighted, 2), 0);
    const ssResidualWeighted = dataWithWeights.reduce((sum, d) => {
      const predicted = slope * d.year + intercept;
      return sum + d.weight * Math.pow(d.value - predicted, 2);
    }, 0);
    const rSquared = 1 - (ssResidualWeighted / ssTotalWeighted);

    return {
      slope: parseFloat(slope.toFixed(4)),
      intercept: parseFloat(intercept.toFixed(2)),
      rSquared: parseFloat(rSquared.toFixed(3)),
      confidence: rSquared > 0.5 ? 'high' : rSquared > 0.2 ? 'medium' : 'low',
      method: 'weighted_regression'
    };
  };

  // PREDICCIÓN AJUSTADA POR TENDENCIA para año actual
  const currentYear = new Date().getFullYear();

  const tempMaxTrend = calculateTrend(tempMaxData, currentYear);
  const tempMinTrend = calculateTrend(tempMinData, currentYear);

  console.log(`   📈 Tendencia Temp Max: ${tempMaxTrend.slope > 0 ? '+' : ''}${tempMaxTrend.slope}°C/año (R²=${tempMaxTrend.rSquared})`);
  console.log(`   📈 Tendencia Temp Min: ${tempMinTrend.slope > 0 ? '+' : ''}${tempMinTrend.slope}°C/año (R²=${tempMinTrend.rSquared})`);

  console.log(`   🌡️  Temp Max: ${tempMaxValues.length} años`);
  console.log(`   🌡️  Temp Min: ${tempMinValues.length} años`);
  console.log(`   💨 Viento: ${windMaxValues.length} años`);
  console.log(`   💧 Humedad: ${humidityValues.length} años`);
  console.log(`   🌧️  Lluvia: ${rainValues.length} años`);

  // Calcular estadísticas completas para cada parámetro
  console.log('\n🔢 === PASO 3: Calculando estadísticas ===');
  console.log('   Calculando percentiles (p10, p25, p50, p75, p90)...');
  console.log('   Calculando desviación estándar...');
  console.log('   Calculando intervalos de confianza 95%...');

  const tempMaxStats = calculateStatistics(tempMaxValues);
  const tempMinStats = calculateStatistics(tempMinValues);
  const tempAvgStats = calculateStatistics(tempAvgValues);
  const windMaxStats = calculateStatistics(windMaxValues);
  const windAvgStats = calculateStatistics(windAvgValues);
  const humidityStats = calculateStatistics(humidityValues);
  const rainStats = calculateStatistics(rainValues);

  let predictedTempMax = tempMaxTrend.slope * currentYear + tempMaxTrend.intercept;
  let predictedTempMin = tempMinTrend.slope * currentYear + tempMinTrend.intercept;

  console.log('✅ Estadísticas calculadas');
  console.log(`\n🎯 === Predicción ajustada por tendencia (${currentYear}) ===`);
  console.log(`   Temp Max predicha: ${predictedTempMax.toFixed(1)}°C (vs mediana histórica: ${tempMaxStats.median}°C)`);
  console.log(`   Temp Min predicha: ${predictedTempMin.toFixed(1)}°C (vs mediana histórica: ${tempMinStats.median}°C)`);

  // NOTA: NASA POWER ya incluye ajuste por elevación del punto consultado
  // No aplicamos corrección adicional (los datos satelitales ya están calibrados)
  const elevationCorrection = 0; // Sin corrección (datos ya ajustados)

  // INNOVACIÓN: UMBRALES ADAPTATIVOS basados en velocidad de cambio climático
  // Ajustar umbrales dinámicamente según tendencia de próxima década
  const decadeProjection = 10; // años hacia adelante
  const thresholds = {
    veryHot: baseThresholds.veryHot + (tempMaxTrend.slope * decadeProjection),
    veryCold: baseThresholds.veryCold + (tempMinTrend.slope * decadeProjection),
    veryWindy: baseThresholds.veryWindy, // Sin cambio (no hay tendencia de viento clara)
    veryHumid: baseThresholds.veryHumid,
    heavyRain: baseThresholds.heavyRain
  };

  console.log(`\n🎯 === UMBRALES ADAPTATIVOS (ajustados por climate velocity) ===`);
  console.log(`   Muy caluroso: ${baseThresholds.veryHot}°C → ${thresholds.veryHot.toFixed(1)}°C (${tempMaxTrend.slope > 0 ? '+' : ''}${(tempMaxTrend.slope * decadeProjection).toFixed(1)}°C)`);
  console.log(`   Muy frío: ${baseThresholds.veryCold}°C → ${thresholds.veryCold.toFixed(1)}°C (${tempMinTrend.slope > 0 ? '+' : ''}${(tempMinTrend.slope * decadeProjection).toFixed(1)}°C)`);

  // Calcular probabilidades reales basadas en umbrales ADAPTATIVOS
  console.log('\n🎲 === PASO 4: Calculando probabilidades ===');
  const probVeryHot = calculateRealProbability(tempMaxValues, thresholds.veryHot, true);
  const probVeryCold = calculateRealProbability(tempMinValues, thresholds.veryCold, false);
  const probVeryWindy = calculateRealProbability(windMaxValues, thresholds.veryWindy, true);
  const probVeryHumid = calculateRealProbability(humidityValues, thresholds.veryHumid, true);
  const probHeavyRain = calculateRealProbability(rainValues, thresholds.heavyRain, true);

  console.log(`   ☀️  Muy caluroso (>${thresholds.veryHot.toFixed(1)}°C): ${probVeryHot.toFixed(1)}%`);
  console.log(`   ❄️  Muy frío (<${thresholds.veryCold.toFixed(1)}°C): ${probVeryCold.toFixed(1)}%`);
  console.log(`   💨 Muy ventoso (>${thresholds.veryWindy}m/s): ${probVeryWindy.toFixed(1)}%`);
  console.log(`   💧 Muy húmedo (>${thresholds.veryHumid}%): ${probVeryHumid.toFixed(1)}%`);
  console.log(`   🌧️  Lluvia intensa (>${thresholds.heavyRain}mm): ${probHeavyRain.toFixed(1)}%`);

  // INNOVACIÓN: COMPOUND RISK SCORES
  // Combinar múltiples variables para evaluar riesgos específicos
  console.log('\n⚠️  === PASO 5: Calculando Risk Scores Compuestos ===');

  // Risk Score: HELADA (frost)
  // Factores: temp mín baja + humedad alta + viento bajo
  const frostRiskRaw = (
    Math.max(0, (10 - predictedTempMin)) * 50 +  // Peso 50%: más riesgo si temp < 10°C
    (humidityStats.mean) * 0.3 +                  // Peso 30%: humedad alta aumenta riesgo
    Math.max(0, (5 - windAvgStats.mean)) * 20     // Peso 20%: viento bajo aumenta riesgo
  );
  const frostRisk = Math.min(100, frostRiskRaw); // Cap a 100

  // Risk Score: TORMENTA (storm)
  // Factores: lluvia alta + viento alto + humedad alta
  const stormRiskRaw = (
    probHeavyRain * 0.5 +                         // Peso 50%: probabilidad de lluvia
    (windMaxStats.mean / 15) * 30 +               // Peso 30%: viento fuerte
    (humidityStats.mean / 100) * 20               // Peso 20%: humedad alta
  );
  const stormRisk = Math.min(100, stormRiskRaw);

  // Risk Score: ESTRÉS TÉRMICO (heat stress)
  // Factores: temp alta + humedad alta + viento bajo
  const heatStressRiskRaw = (
    Math.max(0, (predictedTempMax - 30)) * 3 +    // Peso alto: cada °C sobre 30°C
    (humidityStats.mean / 100) * 30 +             // Peso 30%: humedad dificulta enfriamiento
    Math.max(0, (5 - windAvgStats.mean)) * 10     // Peso 10%: viento bajo empeora
  );
  const heatStressRisk = Math.min(100, heatStressRiskRaw);

  const getRiskLevel = (score) => {
    if (score >= 70) return 'ALTO';
    if (score >= 40) return 'MEDIO';
    return 'BAJO';
  };

  const getRiskRecommendations = (riskType, score) => {
    const recommendations = {
      frost: {
        ALTO: ['Cubrir cultivos sensibles', 'Implementar calefacción nocturna', 'Evitar riego en la tarde'],
        MEDIO: ['Monitorear temperaturas nocturnas', 'Preparar coberturas'],
        BAJO: ['Sin acción necesaria']
      },
      storm: {
        ALTO: ['Asegurar estructuras', 'Postponer actividades al aire libre', 'Revisar drenajes'],
        MEDIO: ['Monitorear condiciones', 'Tener plan de contingencia'],
        BAJO: ['Sin precauciones especiales']
      },
      heat: {
        ALTO: ['Aumentar frecuencia de riego', 'Aplicar mulch', 'Evitar trabajo pesado en horas pico'],
        MEDIO: ['Monitorear estrés hídrico', 'Riego temprano/tarde'],
        BAJO: ['Manejo normal']
      }
    };
    return recommendations[riskType][getRiskLevel(score)];
  };

  console.log(`   ❄️  Riesgo Helada: ${frostRisk.toFixed(1)}/100 (${getRiskLevel(frostRisk)})`);
  console.log(`   ⛈️  Riesgo Tormenta: ${stormRisk.toFixed(1)}/100 (${getRiskLevel(stormRisk)})`);
  console.log(`   🌡️  Riesgo Estrés Térmico: ${heatStressRisk.toFixed(1)}/100 (${getRiskLevel(heatStressRisk)})`);

  return {
    trendPrediction: {
      tempMax: parseFloat(predictedTempMax.toFixed(2)),
      tempMin: parseFloat(predictedTempMin.toFixed(2)),
      year: currentYear,
      trend: {
        max: {
          slope: tempMaxTrend.slope,
          rSquared: tempMaxTrend.rSquared,
          confidence: tempMaxTrend.confidence
        },
        min: {
          slope: tempMinTrend.slope,
          rSquared: tempMinTrend.rSquared,
          confidence: tempMinTrend.confidence
        }
      }
    },
    temperature: {
      statistics: tempAvgStats,
      max: {
        statistics: tempMaxStats,
        unit: '°C'
      },
      min: {
        statistics: tempMinStats,
        unit: '°C'
      },
      conditions: {
        veryHot: {
          probability: parseFloat(probVeryHot.toFixed(2)),
          threshold: thresholds.veryHot,
          yearsExceeded: Math.round((probVeryHot / 100) * tempMaxValues.length),
          totalYears: tempMaxValues.length,
          unit: '°C'
        },
        veryCold: {
          probability: parseFloat(probVeryCold.toFixed(2)),
          threshold: thresholds.veryCold,
          yearsExceeded: Math.round((probVeryCold / 100) * tempMinValues.length),
          totalYears: tempMinValues.length,
          unit: '°C'
        }
      }
    },
    wind: {
      statistics: windAvgStats,
      max: {
        statistics: windMaxStats,
        unit: 'm/s'
      },
      conditions: {
        veryWindy: {
          probability: parseFloat(probVeryWindy.toFixed(2)),
          threshold: thresholds.veryWindy,
          yearsExceeded: Math.round((probVeryWindy / 100) * windMaxValues.length),
          totalYears: windMaxValues.length,
          unit: 'm/s'
        }
      }
    },
    humidity: {
      statistics: humidityStats,
      conditions: {
        veryHumid: {
          probability: parseFloat(probVeryHumid.toFixed(2)),
          threshold: thresholds.veryHumid,
          yearsExceeded: Math.round((probVeryHumid / 100) * humidityValues.length),
          totalYears: humidityValues.length,
          unit: '%'
        }
      }
    },
    precipitation: {
      statistics: rainStats,
      conditions: {
        heavyRain: {
          probability: parseFloat(probHeavyRain.toFixed(2)),
          threshold: thresholds.heavyRain,
          yearsExceeded: Math.round((probHeavyRain / 100) * rainValues.length),
          totalYears: rainValues.length,
          unit: 'mm'
        }
      }
    },
    riskScores: {
      frost: {
        score: parseFloat(frostRisk.toFixed(1)),
        level: getRiskLevel(frostRisk),
        recommendations: getRiskRecommendations('frost', frostRisk),
        description: 'Riesgo de helada basado en temp mín, humedad y viento'
      },
      storm: {
        score: parseFloat(stormRisk.toFixed(1)),
        level: getRiskLevel(stormRisk),
        recommendations: getRiskRecommendations('storm', stormRisk),
        description: 'Riesgo de tormenta basado en lluvia, viento y humedad'
      },
      heatStress: {
        score: parseFloat(heatStressRisk.toFixed(1)),
        level: getRiskLevel(heatStressRisk),
        recommendations: getRiskRecommendations('heat', heatStressRisk),
        description: 'Riesgo de estrés térmico basado en temp máx, humedad y viento'
      }
    },
    elevationData: {
      elevation: elevation,
      correction: 0,
      unit: 'm',
      note: 'NASA POWER data ya incluye ajuste por elevación del punto consultado'
    }
  };
}

/**
 * Servidor HTTP
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Endpoint de prueba
  if (parsedUrl.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'NASA POWER API MVP Server - Daily & Hourly Weather Analysis',
      endpoints: {
        '/weather': 'GET - Obtener probabilidades de clima extremo para fecha específica',
        'params': 'lat, lon, date (MMDD), hour (0-23, opcional)'
      },
      examples: {
        daily: '/weather?lat=-17.3935&lon=-66.157&date=1004',
        hourly: '/weather?lat=-17.3935&lon=-66.157&date=1004&hour=15'
      },
      note: 'Analiza datos históricos del mismo día. Si incluyes hour, interpolamos temperatura y probabilidades por hora.'
    }));
    return;
  }

  // Endpoint principal - ahora acepta fecha específica y hora opcional
  if (parsedUrl.pathname === '/weather') {
    try {
      const { lat, lon, date, hour } = parsedUrl.query;

      if (!lat || !lon || !date) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Faltan parámetros: lat, lon, date son requeridos',
          example: '/weather?lat=-17.3935&lon=-66.157&date=1004&hour=15 (hora opcional)'
        }));
        return;
      }

      // Validar formato de fecha MMDD
      if (date.length !== 4) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'date debe tener formato MMDD (ej: 1004 para 4 de octubre)',
          received: date
        }));
        return;
      }

      const month = parseInt(date.substring(0, 2));
      const day = parseInt(date.substring(2, 4));

      if (month < 1 || month > 12 || day < 1 || day > 31) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Fecha inválida. Mes debe ser 01-12, día debe ser 01-31'
        }));
        return;
      }

      // Validar hora si se proporciona
      let hourNum = null;
      if (hour !== undefined) {
        hourNum = parseInt(hour);
        if (hourNum < 0 || hourNum > 23) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'hour debe ser entre 0 y 23',
            received: hour
          }));
          return;
        }
      }

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🚀 Nueva petición recibida`);
      if (hourNum !== null) {
        console.log(`⏰ Con predicción horaria para las ${hourNum}:00`);
      }
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      // Consultar datos diarios históricos (últimos 30 años aprox)
      const currentYear = new Date().getFullYear();
      const startYear = currentYear - 30;

      const data = await getNasaPowerDailyData(
        parseFloat(lat),
        parseFloat(lon),
        `${startYear}0101`,
        `${currentYear}1231`
      );

      // INNOVACIÓN: Obtener elevación para corrección topográfica
      console.log('\n🏔️  === Obteniendo elevación ===');
      const elevation = await getElevation(parseFloat(lat), parseFloat(lon));

      const analysis = calculateDailyProbabilities(data, date, elevation);

      // Si se proporciona hora, agregar predicción horaria
      let hourlyForecast = null;
      if (hourNum !== null) {
        // Usar predicción por tendencia (más preciso que percentiles)
        const tempMin = analysis.trendPrediction.tempMin;
        const tempMax = analysis.trendPrediction.tempMax;
        const hourlyTemp = interpolateHourlyTemperature(tempMin, tempMax, hourNum);

        const rainFactor = getHourlyRainFactor(hourNum);
        const baseRainProb = analysis.precipitation.conditions.heavyRain.probability;

        hourlyForecast = {
          hour: hourNum,
          temperature: {
            expected: hourlyTemp,
            range: {
              min: parseFloat((hourlyTemp - analysis.temperature.statistics.stdDev * 0.5).toFixed(1)),
              max: parseFloat((hourlyTemp + analysis.temperature.statistics.stdDev * 0.5).toFixed(1))
            },
            unit: '°C',
            note: `Predicción por regresión lineal de tendencia histórica (${analysis.trendPrediction.year})`
          },
          precipitation: {
            probability: parseFloat((Math.min(baseRainProb * rainFactor, 100)).toFixed(1)),
            note: rainFactor > 1 ? 'Hora de mayor probabilidad de lluvia' :
                  rainFactor < 1 ? 'Hora de menor probabilidad de lluvia' : 'Probabilidad normal'
          },
          historicalComparison: {
            median: interpolateHourlyTemperature(
              analysis.temperature.min.statistics.median,
              analysis.temperature.max.statistics.median,
              hourNum
            ),
            p25: interpolateHourlyTemperature(
              analysis.temperature.min.statistics.percentiles.p25,
              analysis.temperature.max.statistics.percentiles.p25,
              hourNum
            ),
            p75: interpolateHourlyTemperature(
              analysis.temperature.min.statistics.percentiles.p75,
              analysis.temperature.max.statistics.percentiles.p75,
              hourNum
            ),
            p90: interpolateHourlyTemperature(
              analysis.temperature.min.statistics.percentiles.p90,
              analysis.temperature.max.statistics.percentiles.p90,
              hourNum
            )
          }
        };
      }

      console.log('\n✅ === PASO 5: Enviando respuesta al cliente ===');
      console.log(`📤 JSON generado con análisis completo`);
      if (hourlyForecast) {
        console.log(`⏰ Temperatura esperada a las ${hourNum}:00 → ${hourlyForecast.temperature.expected}°C`);
      }
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      const response = {
        location: { lat: parseFloat(lat), lon: parseFloat(lon) },
        date: date,
        day: day,
        month: month,
        monthName: getMonthName(month),
        period: `${startYear}-${currentYear}`,
        dataSource: 'NASA POWER API (Daily)',
        analysis: analysis,
        metadata: {
          description: `Análisis estadístico basado en datos históricos del ${day} de ${getMonthName(month)}`,
          confidence: '95%',
          yearsAnalyzed: currentYear - startYear
        }
      };

      if (hourlyForecast) {
        response.hourlyForecast = hourlyForecast;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response, null, 2));

    } catch (error) {
      console.error('❌ Error:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Error al consultar NASA POWER API',
        details: error.message
      }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint no encontrado' }));
});

server.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📡 Prueba: http://localhost:${PORT}/weather?lat=-17.3935&lon=-66.157&date=1004`);
  console.log(`   (Analiza el 4 de octubre en Cochabamba basado en datos históricos)\n`);
});
