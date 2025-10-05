/**
 * Script de prueba para NASA POWER API
 * Obtiene datos históricos de clima para una ubicación específica
 */

// Configuración de la API
const BASE_URL = 'https://power.larc.nasa.gov/api/temporal/monthly/point';

/**
 * Obtiene datos climatológicos históricos de NASA POWER
 * @param {number} lat - Latitud
 * @param {number} lon - Longitud
 * @param {string} startDate - Fecha inicio (YYYYMMDD)
 * @param {string} endDate - Fecha fin (YYYYMMDD)
 */
async function getNasaPowerData(lat, lon, startDate, endDate) {
  // Parámetros que necesitamos para el desafío:
  const parameters = [
    'T2M',        // Temperatura a 2m (°C)
    'T2M_MAX',    // Temperatura máxima (°C)
    'T2M_MIN',    // Temperatura mínima (°C)
    'PRECTOTCORR',// Precipitación (mm)
    'RH2M',       // Humedad relativa (%)
    'WS2M',       // Velocidad del viento a 2m (m/s)
    'WS2M_MAX',   // Velocidad máxima del viento (m/s)
  ].join(',');

  const url = `${BASE_URL}?parameters=${parameters}&community=RE&longitude=${lon}&latitude=${lat}&start=${startDate}&end=${endDate}&format=JSON`;
  console.log('🔍 Consultando NASA POWER API...');
  console.log('📍 Ubicación:', { lat, lon });
  console.log('📅 Período:', startDate, '-', endDate);
  console.log('🔗 URL:', url);
  console.log('');

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Response:', errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Error al consultar NASA POWER API:', error.message);
    throw error;
  }
}

/**
 * Analiza los datos para calcular probabilidades
 */
function analyzeWeatherData(data) {
  console.log('📊 ANÁLISIS DE DATOS CLIMATOLÓGICOS');
  console.log('=====================================\n');

  const parameters = data.properties.parameter;

  // Mostrar información de cada parámetro
  for (const [param, monthlyData] of Object.entries(parameters)) {
    console.log(`\n🌡️  ${param}:`);

    // Los datos vienen como YYYYMM: valor
    const allValues = Object.values(monthlyData).filter(v => typeof v === 'number');

    if (allValues.length > 0) {
      const avg = allValues.reduce((a, b) => a + b, 0) / allValues.length;
      const max = Math.max(...allValues);
      const min = Math.min(...allValues);

      console.log(`   Promedio: ${avg.toFixed(2)}`);
      console.log(`   Máximo: ${max.toFixed(2)}`);
      console.log(`   Mínimo: ${min.toFixed(2)}`);
      console.log(`   Total de datos: ${allValues.length} puntos`);
    }
  }
}

/**
 * Calcula probabilidades de condiciones extremas
 */
function calculateProbabilities(data, month) {
  console.log(`\n\n🎯 PROBABILIDADES PARA EL MES ${month}`);
  console.log('=====================================\n');

  const params = data.properties.parameter;

  // Definir umbrales para condiciones extremas
  const thresholds = {
    veryHot: 35,      // > 35°C
    veryCold: 5,      // < 5°C
    veryWindy: 10,    // > 10 m/s
    veryHumid: 80,    // > 80%
    heavyRain: 100    // > 100mm/mes
  };

  // Obtener promedios del mes específico de todos los años
  const getMonthlyAverage = (paramName) => {
    const values = [];
    const paramData = params[paramName];

    if (!paramData) return 0;

    // Los datos vienen como "YYYYMM": valor
    for (const [yearMonth, value] of Object.entries(paramData)) {
      const monthStr = yearMonth.substring(4, 6); // Extraer MM de YYYYMM
      if (parseInt(monthStr) === month && typeof value === 'number') {
        values.push(value);
      }
    }

    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  };

  const temp = getMonthlyAverage('T2M_MAX');
  const tempMin = getMonthlyAverage('T2M_MIN');
  const wind = getMonthlyAverage('WS2M_MAX');
  const humidity = getMonthlyAverage('RH2M');
  const rain = getMonthlyAverage('PRECTOTCORR');

  console.log(`☀️  Muy caluroso (>${thresholds.veryHot}°C):`);
  console.log(`   Temp máxima promedio: ${temp.toFixed(1)}°C`);
  console.log(`   Probabilidad: ${temp > thresholds.veryHot ? 'ALTA' : temp > 30 ? 'MEDIA' : 'BAJA'}\n`);

  console.log(`❄️  Muy frío (<${thresholds.veryCold}°C):`);
  console.log(`   Temp mínima promedio: ${tempMin.toFixed(1)}°C`);
  console.log(`   Probabilidad: ${tempMin < thresholds.veryCold ? 'ALTA' : tempMin < 10 ? 'MEDIA' : 'BAJA'}\n`);

  console.log(`💨 Muy ventoso (>${thresholds.veryWindy} m/s):`);
  console.log(`   Viento máximo promedio: ${wind.toFixed(1)} m/s`);
  console.log(`   Probabilidad: ${wind > thresholds.veryWindy ? 'ALTA' : wind > 7 ? 'MEDIA' : 'BAJA'}\n`);

  console.log(`💧 Muy húmedo (>${thresholds.veryHumid}%):`);
  console.log(`   Humedad promedio: ${humidity.toFixed(1)}%`);
  console.log(`   Probabilidad: ${humidity > thresholds.veryHumid ? 'ALTA' : humidity > 70 ? 'MEDIA' : 'BAJA'}\n`);

  console.log(`🌧️  Lluvia intensa (>${thresholds.heavyRain}mm):`);
  console.log(`   Precipitación promedio: ${rain.toFixed(1)}mm`);
  console.log(`   Probabilidad: ${rain > thresholds.heavyRain ? 'ALTA' : rain > 50 ? 'MEDIA' : 'BAJA'}\n`);
}

// EJEMPLO DE USO
async function main() {
  try {
    // Coordenadas de ejemplo (Ciudad de México)
    const lat = 19.4326;
    const lon = -99.1332;

    // Período climatológico (30 años es estándar)
    const startDate = '1991';
    const endDate = '2020';

    console.log('🚀 INICIANDO PRUEBA DE NASA POWER API\n');

    const data = await getNasaPowerData(lat, lon, startDate, endDate);

    // Guardar datos completos para inspección
    console.log('\n✅ Datos obtenidos exitosamente!\n');

    // Debug: mostrar estructura
    console.log('📋 Estructura de datos recibida:');
    console.log(JSON.stringify(data, null, 2).substring(0, 1000));
    console.log('\n');

    analyzeWeatherData(data);

    // Ejemplo: calcular probabilidades para marzo (mes 3)
    calculateProbabilities(data, 3);

    console.log('\n\n📄 Datos completos guardados en: data-sample.json');

    // Opcional: guardar a archivo si necesitas inspeccionar
    // await import('fs').then(fs =>
    //   fs.promises.writeFile('data-sample.json', JSON.stringify(data, null, 2))
    // );

  } catch (error) {
    console.error('\n💥 Error en la ejecución:', error);
    process.exit(1);
  }
}

// Ejecutar
main();
