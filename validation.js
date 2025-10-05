/**
 * Módulo de validación de predicciones
 * Valida si las predicciones son coherentes antes de responder
 */

/**
 * Valida que los datos de análisis sean coherentes y razonables
 */
export function validatePrediction(analysis, location) {
  const errors = [];
  const warnings = [];

  // 1. Validar coherencia de temperaturas
  if (analysis.trendPrediction.tempMax < analysis.trendPrediction.tempMin) {
    errors.push('Temperatura máxima no puede ser menor que temperatura mínima');
  }

  if (analysis.trendPrediction.tempMax > 60 || analysis.trendPrediction.tempMax < -40) {
    warnings.push(`Temperatura máxima predicha (${analysis.trendPrediction.tempMax}°C) fuera del rango típico terrestre`);
  }

  if (analysis.trendPrediction.tempMin > 50 || analysis.trendPrediction.tempMin < -50) {
    warnings.push(`Temperatura mínima predicha (${analysis.trendPrediction.tempMin}°C) fuera del rango típico terrestre`);
  }

  // 2. Validar diferencia razonable entre max y min
  const tempRange = analysis.trendPrediction.tempMax - analysis.trendPrediction.tempMin;
  if (tempRange > 40) {
    warnings.push(`Rango de temperatura diario muy amplio (${tempRange.toFixed(1)}°C)`);
  }
  if (tempRange < 2) {
    warnings.push(`Rango de temperatura diario muy estrecho (${tempRange.toFixed(1)}°C)`);
  }

  // 3. Validar humedad
  if (analysis.humidity.statistics.mean < 0 || analysis.humidity.statistics.mean > 100) {
    errors.push(`Humedad fuera del rango válido (0-100%): ${analysis.humidity.statistics.mean}%`);
  }

  // 4. Validar viento
  if (analysis.wind.statistics.mean < 0) {
    errors.push(`Velocidad de viento negativa: ${analysis.wind.statistics.mean} m/s`);
  }

  if (analysis.wind.max.statistics.max > 100) {
    warnings.push(`Viento máximo muy alto (${analysis.wind.max.statistics.max} m/s), revisar datos`);
  }

  // 5. Validar precipitación
  if (analysis.precipitation.statistics.mean < 0) {
    errors.push(`Precipitación negativa: ${analysis.precipitation.statistics.mean} mm`);
  }

  // 6. Validar risk scores
  const risks = ['frost', 'storm', 'heatStress'];
  for (const risk of risks) {
    const score = analysis.riskScores[risk].score;
    if (score < 0 || score > 100) {
      errors.push(`Risk score de ${risk} fuera del rango 0-100: ${score}`);
    }
  }

  // 7. Validar confianza de tendencias
  if (analysis.trendPrediction.trend.max.rSquared < 0 || analysis.trendPrediction.trend.max.rSquared > 1) {
    warnings.push(`R² de tendencia máxima fuera del rango válido: ${analysis.trendPrediction.trend.max.rSquared}`);
  }

  // 8. Validar cantidad de datos históricos
  if (analysis.temperature.statistics.count < 10) {
    warnings.push(`Pocos datos históricos para análisis confiable (${analysis.temperature.statistics.count} años)`);
  }

  // 9. Validar coherencia de percentiles
  const tempStats = analysis.temperature.statistics;
  if (tempStats.percentiles.p25 > tempStats.percentiles.p50 ||
      tempStats.percentiles.p50 > tempStats.percentiles.p75 ||
      tempStats.percentiles.p75 > tempStats.percentiles.p90) {
    errors.push('Percentiles de temperatura no están en orden ascendente');
  }

  // 10. Validar coordenadas de ubicación
  if (Math.abs(location.lat) > 90) {
    errors.push(`Latitud inválida: ${location.lat}`);
  }
  if (Math.abs(location.lon) > 180) {
    errors.push(`Longitud inválida: ${location.lon}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    confidence: calculateConfidenceScore(analysis, errors, warnings)
  };
}

/**
 * Calcula un score de confianza basado en la calidad de los datos
 */
function calculateConfidenceScore(analysis, errors, warnings) {
  let score = 100;

  // Penalizar por errores (invalidante)
  if (errors.length > 0) {
    return 0;
  }

  // Penalizar por warnings (5 puntos cada uno)
  score -= warnings.length * 5;

  // Bonificar por buena tendencia
  const avgRSquared = (analysis.trendPrediction.trend.max.rSquared +
                       analysis.trendPrediction.trend.min.rSquared) / 2;

  if (avgRSquared > 0.5) score += 10;
  else if (avgRSquared < 0.1) score -= 15;

  // Bonificar por cantidad de datos históricos
  if (analysis.temperature.statistics.count >= 25) score += 5;
  else if (analysis.temperature.statistics.count < 15) score -= 10;

  // Penalizar por desviación estándar muy alta (datos muy variables)
  if (analysis.temperature.statistics.stdDev > 8) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Genera un resumen de validación en lenguaje natural
 */
export function getValidationSummary(validation) {
  if (!validation.isValid) {
    return {
      status: 'error',
      message: 'Los datos presentan errores que deben corregirse',
      details: validation.errors
    };
  }

  let status = 'excellent';
  let message = 'Los datos son confiables y las predicciones son coherentes';

  if (validation.confidence < 70) {
    status = 'warning';
    message = 'Los datos son válidos pero presentan algunas advertencias';
  } else if (validation.confidence < 50) {
    status = 'low';
    message = 'Los datos son válidos pero la confianza es baja';
  }

  return {
    status,
    message,
    confidence: validation.confidence,
    warnings: validation.warnings
  };
}
