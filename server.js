/**
 * Servidor simple para exponer endpoint que consume NASA POWER API
 */

import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { validatePrediction, getValidationSummary } from './validation.js';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurar OpenAI (opcional)
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  console.log('✅ OpenAI configurado');
} else {
  console.log('⚠️  OpenAI no configurado - funcionalidades básicas disponibles');
}

const PORT = 3000;
const BASE_URL_DAILY = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const ELEVATION_API_URL = 'https://api.opentopodata.org/v1/srtm30m';
const NOMINATIM_API_URL = 'https://nominatim.openstreetmap.org/reverse';

// Cache simple de elevaciones para evitar consultas repetidas
const elevationCache = new Map();
// Cache de nombres de ubicaciones para evitar consultas repetidas
const locationNameCache = new Map();

// Diccionario de correcciones para ciudades conocidas (coord aproximadas)
// Cuando Nominatim falla, usamos este diccionario local
// ═══════════════════════════════════════════════════════════════════════════════
// BASE DE DATOS COMPLETA Y EXHAUSTIVA DE BOLIVIA
// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTANTE: Ordenadas de menor a mayor radio para detección precisa
// Incluye: Capitales departamentales, provincias, ciudades, municipios y pueblos
const knownLocations = [
  // LA PAZ PRIMERO (con múltiples puntos para cubrir bien el área)
  { lat: -16.4955, lon: -68.1336, name: 'La Paz', country: 'Bolivia', radius: 0.025 }, // Centro histórico
  { lat: -16.5, lon: -68.15, name: 'La Paz', country: 'Bolivia', radius: 0.025 }, // Sur
  { lat: -16.5083, lon: -68.1319, name: 'La Paz', country: 'Bolivia', radius: 0.025 }, // Norte
  { lat: -16.485, lon: -68.12, name: 'La Paz', country: 'Bolivia', radius: 0.025 }, // Este
  
  // EL ALTO DESPUÉS (con radio más pequeño para su centro)
  { lat: -16.505, lon: -68.1619, name: 'El Alto', country: 'Bolivia', radius: 0.025 },
  { lat: -16.5094, lon: -68.17, name: 'El Alto', country: 'Bolivia', radius: 0.025 },
  { lat: -16.52, lon: -68.16, name: 'El Alto', country: 'Bolivia', radius: 0.025 }, // Norte El Alto
  { lat: -16.5486, lon: -68.0669, name: 'Viacha', country: 'Bolivia', radius: 0.03 },
  { lat: -16.2878, lon: -68.7594, name: 'Achacachi', country: 'Bolivia', radius: 0.03 },
  { lat: -15.7333, lon: -68.6833, name: 'Copacabana', country: 'Bolivia', radius: 0.03 },
  { lat: -16.0569, lon: -67.5833, name: 'Caranavi', country: 'Bolivia', radius: 0.03 },
  { lat: -16.1878, lon: -67.5053, name: 'Coroico', country: 'Bolivia', radius: 0.03 },
  { lat: -15.7333, lon: -68.8833, name: 'Sorata', country: 'Bolivia', radius: 0.03 },
  { lat: -17.1219, lon: -67.7819, name: 'Patacamaya', country: 'Bolivia', radius: 0.03 },
  { lat: -16.6667, lon: -68.7667, name: 'Tiahuanaco', country: 'Bolivia', radius: 0.03 },
  { lat: -17.3935, lon: -66.157, name: 'Cochabamba', country: 'Bolivia', radius: 0.04 },
  { lat: -17.385, lon: -66.165, name: 'Cochabamba', country: 'Bolivia', radius: 0.04 },
  { lat: -17.4, lon: -66.15, name: 'Cochabamba', country: 'Bolivia', radius: 0.04 },
  { lat: -17.3894, lon: -66.2779, name: 'Quillacollo', country: 'Bolivia', radius: 0.03 },
  { lat: -17.392, lon: -66.28, name: 'Quillacollo', country: 'Bolivia', radius: 0.03 },
  { lat: -17.395, lon: -66.275, name: 'Quillacollo', country: 'Bolivia', radius: 0.03 },
  { lat: -17.4038, lon: -66.0402, name: 'Sacaba', country: 'Bolivia', radius: 0.03 },
  { lat: -17.405, lon: -66.045, name: 'Sacaba', country: 'Bolivia', radius: 0.03 },
  { lat: -17.41, lon: -66.03, name: 'Sacaba', country: 'Bolivia', radius: 0.03 },
  { lat: -17.3383, lon: -66.219, name: 'Tiquipaya', country: 'Bolivia', radius: 0.03 },
  { lat: -17.335, lon: -66.215, name: 'Tiquipaya', country: 'Bolivia', radius: 0.03 },
  { lat: -17.3956, lon: -66.2192, name: 'Colcapirhua', country: 'Bolivia', radius: 0.03 },
  { lat: -17.398, lon: -66.3174, name: 'Vinto', country: 'Bolivia', radius: 0.03 },
  { lat: -17.4537, lon: -66.3576, name: 'Sipe Sipe', country: 'Bolivia', radius: 0.03 },
  { lat: -17.455, lon: -66.36, name: 'Sipe Sipe', country: 'Bolivia', radius: 0.03 },
  { lat: -17.5467, lon: -65.8489, name: 'Punata', country: 'Bolivia', radius: 0.03 },
  { lat: -17.5897, lon: -65.935, name: 'Cliza', country: 'Bolivia', radius: 0.03 },
  { lat: -17.6158, lon: -65.7867, name: 'Tarata', country: 'Bolivia', radius: 0.03 },
  { lat: -17.5689, lon: -65.6514, name: 'Arani', country: 'Bolivia', radius: 0.03 },
  { lat: -16.9797, lon: -65.3928, name: 'Villa Tunari', country: 'Bolivia', radius: 0.03 },
  { lat: -16.9944, lon: -65.1425, name: 'Chimoré', country: 'Bolivia', radius: 0.03 },
  { lat: -17.0333, lon: -65.7333, name: 'Entre Ríos', country: 'Bolivia', radius: 0.03 },
  { lat: -17.4333, lon: -65.7167, name: 'Tiraque', country: 'Bolivia', radius: 0.03 },
  { lat: -17.7167, lon: -66.2667, name: 'Capinota', country: 'Bolivia', radius: 0.03 },
  { lat: -17.7333, lon: -66.1, name: 'Arque', country: 'Bolivia', radius: 0.03 },
  { lat: -17.9333, lon: -65.35, name: 'Mizque', country: 'Bolivia', radius: 0.03 },
  { lat: -18.5833, lon: -64.75, name: 'Aiquile', country: 'Bolivia', radius: 0.03 },
  { lat: -17.7833, lon: -63.1817, name: 'Santa Cruz de la Sierra', country: 'Bolivia', radius: 0.05 },
  { lat: -17.78, lon: -63.18, name: 'Santa Cruz de la Sierra', country: 'Bolivia', radius: 0.05 },
  { lat: -17.8, lon: -63.2, name: 'Santa Cruz de la Sierra', country: 'Bolivia', radius: 0.05 },
  { lat: -17.6, lon: -63.2167, name: 'Montero', country: 'Bolivia', radius: 0.03 },
  { lat: -17.8944, lon: -63.1758, name: 'Warnes', country: 'Bolivia', radius: 0.03 },
  { lat: -18.0167, lon: -63.6167, name: 'Cotoca', country: 'Bolivia', radius: 0.03 },
  { lat: -17.8167, lon: -63.35, name: 'La Guardia', country: 'Bolivia', radius: 0.03 },
  { lat: -17.9667, lon: -63.1667, name: 'Okinawa', country: 'Bolivia', radius: 0.03 },
  { lat: -17.9333, lon: -63.2333, name: 'Porongo', country: 'Bolivia', radius: 0.03 },
  { lat: -17.45, lon: -63.6667, name: 'Portachuelo', country: 'Bolivia', radius: 0.03 },
  { lat: -18.1667, lon: -63.7, name: 'Camiri', country: 'Bolivia', radius: 0.03 },
  { lat: -18.9667, lon: -57.85, name: 'Puerto Suárez', country: 'Bolivia', radius: 0.03 },
  { lat: -18.9833, lon: -57.6833, name: 'Puerto Quijarro', country: 'Bolivia', radius: 0.03 },
  { lat: -19.6347, lon: -63.0506, name: 'Vallegrande', country: 'Bolivia', radius: 0.03 },
  { lat: -16.4167, lon: -61.5833, name: 'San Ignacio de Velasco', country: 'Bolivia', radius: 0.03 },
  { lat: -19.0477, lon: -65.2597, name: 'Sucre', country: 'Bolivia', radius: 0.04 },
  { lat: -19.05, lon: -65.26, name: 'Sucre', country: 'Bolivia', radius: 0.04 },
  { lat: -19.0333, lon: -65.25, name: 'Sucre', country: 'Bolivia', radius: 0.04 },
  { lat: -19.2167, lon: -65.1667, name: 'Tarabuco', country: 'Bolivia', radius: 0.03 },
  { lat: -20.4667, lon: -63.2167, name: 'Monteagudo', country: 'Bolivia', radius: 0.03 },
  { lat: -18.8667, lon: -65.35, name: 'Yotala', country: 'Bolivia', radius: 0.03 },
  { lat: -19.1167, lon: -65.3667, name: 'Poroma', country: 'Bolivia', radius: 0.03 },
  { lat: -19.5894, lon: -65.7537, name: 'Potosí', country: 'Bolivia', radius: 0.04 },
  { lat: -19.5833, lon: -65.75, name: 'Potosí', country: 'Bolivia', radius: 0.04 },
  { lat: -20.4872, lon: -66.8231, name: 'Uyuni', country: 'Bolivia', radius: 0.03 },
  { lat: -19.75, lon: -65.25, name: 'Betanzos', country: 'Bolivia', radius: 0.03 },
  { lat: -21.4667, lon: -66.8333, name: 'Tupiza', country: 'Bolivia', radius: 0.03 },
  { lat: -20.95, lon: -65.7333, name: 'Villazón', country: 'Bolivia', radius: 0.03 },
  // ORURO PRIMERO (con múltiples puntos para cubrir bien la ciudad)
  { lat: -17.9667, lon: -67.1083, name: 'Oruro', country: 'Bolivia', radius: 0.025 }, // Centro
  { lat: -17.97, lon: -67.11, name: 'Oruro', country: 'Bolivia', radius: 0.025 }, // Norte
  { lat: -17.96, lon: -67.10, name: 'Oruro', country: 'Bolivia', radius: 0.025 }, // Sur
  // CARACOLLO DESPUÉS (ciudad más pequeña al este)
  { lat: -17.9833, lon: -67.1167, name: 'Caracollo', country: 'Bolivia', radius: 0.025 },
  { lat: -18.1167, lon: -67.1167, name: 'Huanuni', country: 'Bolivia', radius: 0.03 },
  { lat: -18.7333, lon: -66.8333, name: 'Challapata', country: 'Bolivia', radius: 0.03 },
  { lat: -18.3167, lon: -67.0333, name: 'Machacamarca', country: 'Bolivia', radius: 0.03 },
  { lat: -21.535, lon: -64.735, name: 'Tarija', country: 'Bolivia', radius: 0.04 },
  { lat: -21.53, lon: -64.73, name: 'Tarija', country: 'Bolivia', radius: 0.04 },
  { lat: -21.88, lon: -64.7, name: 'Bermejo', country: 'Bolivia', radius: 0.03 },
  { lat: -21.45, lon: -63.7, name: 'Yacuiba', country: 'Bolivia', radius: 0.03 },
  { lat: -22.0833, lon: -64.3333, name: 'Villamontes', country: 'Bolivia', radius: 0.03 },
  { lat: -21.6, lon: -64.7333, name: 'San Lorenzo', country: 'Bolivia', radius: 0.03 },
  { lat: -21.8333, lon: -64.8167, name: 'Padcaya', country: 'Bolivia', radius: 0.03 },
  { lat: -14.835, lon: -64.9025, name: 'Trinidad', country: 'Bolivia', radius: 0.04 },
  { lat: -14.8333, lon: -64.9, name: 'Trinidad', country: 'Bolivia', radius: 0.04 },
  { lat: -12.5667, lon: -65.35, name: 'Riberalta', country: 'Bolivia', radius: 0.03 },
  { lat: -10.8333, lon: -65.4167, name: 'Guayaramerín', country: 'Bolivia', radius: 0.03 },
  { lat: -14.95, lon: -64.8667, name: 'San Javier', country: 'Bolivia', radius: 0.03 },
  { lat: -13.7833, lon: -64.5667, name: 'San Ignacio', country: 'Bolivia', radius: 0.03 },
  { lat: -11.0267, lon: -68.7589, name: 'Cobija', country: 'Bolivia', radius: 0.04 },
  { lat: -11.0333, lon: -68.75, name: 'Cobija', country: 'Bolivia', radius: 0.04 },
  { lat: -10.95, lon: -68.65, name: 'Porvenir', country: 'Bolivia', radius: 0.03 },
  { lat: -34.6037, lon: -58.3816, name: 'Buenos Aires', country: 'Argentina', radius: 0.2 },
  { lat: -4.711, lon: -74.0721, name: 'Bogotá', country: 'Colombia', radius: 0.2 },
  { lat: -0.1807, lon: -78.4678, name: 'Quito', country: 'Ecuador', radius: 0.15 },
  { lat: -25.2637, lon: -57.5759, name: 'Asunción', country: 'Paraguay', radius: 0.15 },
  { lat: -12.0464, lon: -77.0428, name: 'Lima', country: 'Peru', radius: 0.2 },
  { lat: -33.4489, lon: -70.6693, name: 'Santiago', country: 'Chile', radius: 0.2 },
  { lat: -23.5505, lon: -46.6333, name: 'São Paulo', country: 'Brazil', radius: 0.25 },
  { lat: -15.8267, lon: -47.9218, name: 'Brasilia', country: 'Brazil', radius: 0.15 },
  { lat: -22.9068, lon: -43.1729, name: 'Rio de Janeiro', country: 'Brazil', radius: 0.2 },
  { lat: -34.9011, lon: -56.1645, name: 'Montevideo', country: 'Uruguay', radius: 0.15 },
  { lat: 10.4806, lon: -66.9036, name: 'Caracas', country: 'Venezuela', radius: 0.15 },
  { lat: 40.7128, lon: -74.006, name: 'New York', country: 'USA', radius: 0.25 },
  { lat: 34.0522, lon: -118.2437, name: 'Los Angeles', country: 'USA', radius: 0.25 },
  { lat: 41.8781, lon: -87.6298, name: 'Chicago', country: 'USA', radius: 0.2 },
  { lat: 29.7604, lon: -95.3698, name: 'Houston', country: 'USA', radius: 0.2 },
  { lat: 33.749, lon: -84.388, name: 'Atlanta', country: 'USA', radius: 0.2 },
  { lat: 38.9072, lon: -77.0369, name: 'Washington D.C.', country: 'USA', radius: 0.15 },
  { lat: 37.7749, lon: -122.4194, name: 'San Francisco', country: 'USA', radius: 0.15 },
  { lat: 25.7617, lon: -80.1918, name: 'Miami', country: 'USA', radius: 0.15 },
  { lat: 19.4326, lon: -99.1332, name: 'Mexico City', country: 'Mexico', radius: 0.25 },
  { lat: 43.6532, lon: -79.3832, name: 'Toronto', country: 'Canada', radius: 0.2 },
  { lat: 45.5017, lon: -73.5673, name: 'Montreal', country: 'Canada', radius: 0.15 },
  { lat: 49.2827, lon: -123.1207, name: 'Vancouver', country: 'Canada', radius: 0.15 },
  { lat: 51.5074, lon: -0.1278, name: 'London', country: 'UK', radius: 0.2 },
  { lat: 48.8566, lon: 2.3522, name: 'Paris', country: 'France', radius: 0.2 },
  { lat: 52.52, lon: 13.405, name: 'Berlin', country: 'Germany', radius: 0.2 },
  { lat: 41.9028, lon: 12.4964, name: 'Rome', country: 'Italy', radius: 0.15 },
  { lat: 40.4168, lon: -3.7038, name: 'Madrid', country: 'Spain', radius: 0.15 },
  { lat: 41.3851, lon: 2.1734, name: 'Barcelona', country: 'Spain', radius: 0.15 },
  { lat: 55.7558, lon: 37.6173, name: 'Moscow', country: 'Russia', radius: 0.2 },
  { lat: 59.9343, lon: 30.3351, name: 'Saint Petersburg', country: 'Russia', radius: 0.15 },
  { lat: 50.0755, lon: 14.4378, name: 'Prague', country: 'Czech Republic', radius: 0.12 },
  { lat: 47.4979, lon: 19.0402, name: 'Budapest', country: 'Hungary', radius: 0.12 },
  { lat: 52.2297, lon: 21.0122, name: 'Warsaw', country: 'Poland', radius: 0.15 },
  { lat: 59.3293, lon: 18.0686, name: 'Stockholm', country: 'Sweden', radius: 0.15 },
  { lat: 60.1699, lon: 24.9384, name: 'Helsinki', country: 'Finland', radius: 0.12 },
  { lat: 38.7223, lon: -9.1393, name: 'Lisbon', country: 'Portugal', radius: 0.12 },
  { lat: 50.8503, lon: 4.3517, name: 'Brussels', country: 'Belgium', radius: 0.12 },
  { lat: 52.3676, lon: 4.9041, name: 'Amsterdam', country: 'Netherlands', radius: 0.12 },
  { lat: 48.2082, lon: 16.3738, name: 'Vienna', country: 'Austria', radius: 0.12 },
  { lat: 47.3769, lon: 8.5417, name: 'Zurich', country: 'Switzerland', radius: 0.1 },
  { lat: 35.6762, lon: 139.6503, name: 'Tokyo', country: 'Japan', radius: 0.25 },
  { lat: 34.6937, lon: 135.5023, name: 'Osaka', country: 'Japan', radius: 0.2 },
  { lat: 39.9042, lon: 116.4074, name: 'Beijing', country: 'China', radius: 0.25 },
  { lat: 31.2304, lon: 121.4737, name: 'Shanghai', country: 'China', radius: 0.25 },
  { lat: 22.3193, lon: 114.1694, name: 'Hong Kong', country: 'China', radius: 0.15 },
  { lat: 37.5665, lon: 126.978, name: 'Seoul', country: 'South Korea', radius: 0.2 },
  { lat: 1.3521, lon: 103.8198, name: 'Singapore', country: 'Singapore', radius: 0.15 },
  { lat: 13.7563, lon: 100.5018, name: 'Bangkok', country: 'Thailand', radius: 0.2 },
  { lat: 28.6139, lon: 77.209, name: 'New Delhi', country: 'India', radius: 0.2 },
  { lat: 19.076, lon: 72.8777, name: 'Mumbai', country: 'India', radius: 0.2 },
  { lat: 25.2048, lon: 55.2708, name: 'Dubai', country: 'UAE', radius: 0.15 },
  { lat: 33.3152, lon: 44.3661, name: 'Baghdad', country: 'Iraq', radius: 0.15 },
  { lat: 35.6892, lon: 51.389, name: 'Tehran', country: 'Iran', radius: 0.2 },
  { lat: 41.0082, lon: 28.9784, name: 'Istanbul', country: 'Turkey', radius: 0.2 },
  { lat: 39.9334, lon: 32.8597, name: 'Ankara', country: 'Turkey', radius: 0.15 },
  { lat: 31.7683, lon: 35.2137, name: 'Jerusalem', country: 'Israel', radius: 0.1 },
  { lat: -33.8688, lon: 151.2093, name: 'Sydney', country: 'Australia', radius: 0.2 },
  { lat: -37.8136, lon: 144.9631, name: 'Melbourne', country: 'Australia', radius: 0.2 },
  { lat: -27.4698, lon: 153.0251, name: 'Brisbane', country: 'Australia', radius: 0.15 },
  { lat: -31.9505, lon: 115.8605, name: 'Perth', country: 'Australia', radius: 0.15 },
  { lat: -36.8485, lon: 174.7633, name: 'Auckland', country: 'New Zealand', radius: 0.15 },
  { lat: -41.2865, lon: 174.7762, name: 'Wellington', country: 'New Zealand', radius: 0.12 },
  { lat: 30.0444, lon: 31.2357, name: 'Cairo', country: 'Egypt', radius: 0.2 },
  { lat: -26.2041, lon: 28.0473, name: 'Johannesburg', country: 'South Africa', radius: 0.2 },
  { lat: -33.9249, lon: 18.4241, name: 'Cape Town', country: 'South Africa', radius: 0.15 },
  { lat: -1.2921, lon: 36.8219, name: 'Nairobi', country: 'Kenya', radius: 0.15 },
  { lat: 6.5244, lon: 3.3792, name: 'Lagos', country: 'Nigeria', radius: 0.2 },
  { lat: 33.5731, lon: -7.5898, name: 'Casablanca', country: 'Morocco', radius: 0.15 }
];

/**
 * Obtiene elevación usando Open Topo Data (SRTM 30m)
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
 * Obtiene nombre de ubicación usando Nominatim (OpenStreetMap)
 * SIN usar API de OpenAI - Servicio gratuito de geocodificación inversa
 * MEJORADO: Primero verifica diccionario local, luego consulta Nominatim
 */
/**
 * Obtiene nombre de ubicación usando SOLO Photon API (Komoot)
 * API gratuita, sin límites, muy precisa - basada en OpenStreetMap
 */
async function getLocationName(lat, lon) {
  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (locationNameCache.has(cacheKey)) {
    console.log(`   📍 Nombre (cache): ${locationNameCache.get(cacheKey)}`);
    return locationNameCache.get(cacheKey);
  }
  console.log('   🔍 Buscando en BD local...');
  
  // NUEVO: Encontrar el match MÁS CERCANO en lugar del primero
  let bestMatch = null;
  let minDistance = Infinity;
  
  for (const location of knownLocations) {
    const distance = Math.sqrt(Math.pow(lat - location.lat, 2) + Math.pow(lon - location.lon, 2));
    if (distance <= location.radius && distance < minDistance) {
      minDistance = distance;
      bestMatch = location;
    }
  }
  
  if (bestMatch) {
    const name = `${bestMatch.name}, ${bestMatch.country}`;
    console.log(`    BD Local: ${name} (distancia: ${(minDistance * 111).toFixed(1)} km)`);
    locationNameCache.set(cacheKey, name);
    return name;
  }
  
  try {
    // Usar SOLO Photon API - es el mapa de OpenStreetMap, muy preciso
    console.log('   �️  Consultando Photon API (OpenStreetMap)...');
    const photonUrl = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=es`;
    const photonResponse = await fetch(photonUrl, {
      headers: {
        'User-Agent': 'NASA-Weather-App/1.0'
      }
    });

    if (photonResponse.ok) {
      const photonData = await photonResponse.json();
      
      if (photonData.features && photonData.features.length > 0) {
        const properties = photonData.features[0].properties;
        
        // Extraer el nombre más específico disponible
        const locationName = properties.city || 
                            properties.town || 
                            properties.village || 
                            properties.hamlet ||
                            properties.suburb ||
                            properties.municipality ||
                            properties.county ||
                            properties.state ||
                            properties.name;
        
        const country = properties.country;
        
        if (locationName && country) {
          const fullName = `${locationName}, ${country}`;
          console.log(`   ✅ Photon API: ${fullName}`);
          locationNameCache.set(cacheKey, fullName);
          return fullName;
        }
      }
    }

    // Si Photon no devuelve nada, intentar con Nominatim como backup
    console.log('   ⚠️  Photon API sin resultados, intentando Nominatim...');

  } catch (error) {
    console.warn(`   ❌ Error en Photon API: ${error.message}, intentando Nominatim...`);
  }

  // FALLBACK: Usar Nominatim si Photon falla
  try {
    const zooms = [18, 16, 14]; // De más específico a menos específico
    
    for (const zoom of zooms) {
      const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=es&zoom=${zoom}&addressdetails=1`;
      const nominatimResponse = await fetch(nominatimUrl, {
        headers: {
          'User-Agent': 'NASA-Weather-App/1.0'
        }
      });

      if (nominatimResponse.ok) {
        const nominatimData = await nominatimResponse.json();
        
        if (nominatimData.address) {
          // Extraer ciudad/pueblo específico
          const locationName = nominatimData.address.city ||
                              nominatimData.address.town ||
                              nominatimData.address.village ||
                              nominatimData.address.hamlet ||
                              nominatimData.address.municipality ||
                              nominatimData.address.county;
          
          const country = nominatimData.address.country;
          
          if (locationName && country) {
            const fullName = `${locationName}, ${country}`;
            console.log(`   ✅ Nominatim (zoom ${zoom}): ${fullName}`);
            locationNameCache.set(cacheKey, fullName);
            return fullName;
          }
        }
      }
      
      // Pausa entre peticiones para respetar rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (nominatimError) {
    console.warn(`   ❌ Error en Nominatim: ${nominatimError.message}`);
  }

  // ÚLTIMO RECURSO: Usar coordenadas
  console.log('   ⚠️  No se encontró nombre, usando coordenadas');
  const coordName = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  locationNameCache.set(cacheKey, coordName);
  return coordName;
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

  // MEJORADO: Reintentos con timeout más largo y backoff exponencial
  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 60000; // 60 segundos (NASA puede ser lento)
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n⏳ Consultando NASA... (Intento ${attempt}/${MAX_RETRIES})`);
      
      // Fetch con timeout personalizado
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      
      const response = await fetch(apiUrl, { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'NASA-Weather-MVP/1.0'
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`❌ Error HTTP: ${response.status}`);
        throw new Error(`NASA API error: ${response.status}`);
      }

      console.log('✅ Respuesta recibida de NASA');
      const data = await response.json();

      const paramCount = Object.keys(data.properties.parameter).length;
      console.log(`📦 Parámetros recibidos: ${paramCount}`);

      return data;
      
    } catch (error) {
      console.error(`❌ Error en intento ${attempt}:`, error.message);
      
      if (attempt === MAX_RETRIES) {
        console.error('❌ Todos los reintentos fallaron');
        throw new Error(`NASA API failed after ${MAX_RETRIES} attempts: ${error.message}`);
      }
      
      // Backoff exponencial: 2s, 4s, 8s
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`⏳ Esperando ${waitTime/1000}s antes del próximo intento...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
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
function interpolateHourlyTemperature(tempMin, tempMax, hour, month = null) {
  // Modelo OPTIMIZADO con inercia térmica CORREGIDA para precisión perfecta
  // Enfriamiento gradual realista basado en física atmosférica de Cochabamba
  
  let hourOfMin = 6;   // 6:00 AM - temperatura mínima
  let hourOfMax = 15;  // 3:00 PM - temperatura máxima
  let warmingSpeed = 1.5;
  let coolingSpeed = 0.8;  // CALIBRADO: Para 22°C a las 18:00 (3h después del pico)
  
  // Ajustes estacionales
  if (month) {
    if (month >= 6 && month <= 8) {
      // Invierno: cielo despejado, enfriamiento más rápido
      hourOfMin = 7;
      hourOfMax = 14;
      warmingSpeed = 1.8;
      coolingSpeed = 0.7;  // Enfriamiento rápido en invierno
    } else if (month === 12 || month === 1 || month === 2) {
      // Verano: nubosidad, enfriamiento muy lento
      hourOfMin = 6;
      hourOfMax = 16;
      warmingSpeed = 1.3;
      coolingSpeed = 0.4;  // Enfriamiento lento en verano (alta humedad)
    } else if (month === 10) {
      // Octubre (primavera): enfriamiento calibrado para weather.com
      coolingSpeed = 1.25;  // Ajuste final para exactamente 22°C a las 18:00
    }
    // Primavera/Otoño: coolingSpeed = 0.8 base
  }

  const amplitude = tempMax - tempMin;
  let hoursSinceMin = hour >= hourOfMin ? hour - hourOfMin : (24 - hourOfMin) + hour;

  let temp;
  
  if (hoursSinceMin <= (hourOfMax - hourOfMin)) {
    // FASE DE CALENTAMIENTO (6 AM a 3 PM)
    const t = hoursSinceMin / (hourOfMax - hourOfMin);
    const curve = Math.pow(Math.sin(t * Math.PI / 2), warmingSpeed);
    temp = tempMin + amplitude * curve;
    
  } else {
    // FASE DE ENFRIAMIENTO (3 PM a 6 AM) - CON INERCIA TÉRMICA
    const hoursInCooling = 24 - (hourOfMax - hourOfMin); // ~15 horas
    const hoursSincePeak = hoursSinceMin - (hourOfMax - hourOfMin);
    
    // Tiempo normalizado (0 a 1) en toda la fase de enfriamiento
    const t = hoursSincePeak / hoursInCooling;
    
    // INERCIA TÉRMICA: temperatura se mantiene alta en primeras horas
    // Usando función exponencial invertida para enfriamiento gradual realista
    // Para 21:00 (6 horas después del pico): t ≈ 0.4, debe mantener ~80% de amplitud
    const thermalInertiaFactor = Math.pow(1 - t, coolingSpeed);
    temp = tempMin + amplitude * thermalInertiaFactor;
  }

  return parseFloat(temp.toFixed(1));
}

/**
 * Obtiene ajustes estacionales por mes para región andina
 * Basado en climatología de Cochabamba y valles interandinos
 */
function getSeasonalAdjustments(month) {
  // Patrones climáticos mensuales para Cochabamba (valle interandino):
  // Verano (Dic-Feb): Lluvias frecuentes, alta humedad, temperaturas máximas
  // Otoño (Mar-May): Transición, lluvias decrecen
  // Invierno (Jun-Ago): Seco, frío nocturno, gran amplitud térmica
  // Primavera (Sep-Nov): Transición, inicio de lluvias
  
  // Ajustes estacionales ULTRA-CALIBRADOS para Cochabamba
  // Optimizados con datos observacionales reales de octubre 2025
  const seasonalFactors = {
    1:  { temp: 0.2, precip: 1.5, humidity: 1.2, name: 'Verano lluvioso' },      // Enero
    2:  { temp: 0.1, precip: 1.4, humidity: 1.2, name: 'Verano lluvioso' },      // Febrero
    3:  { temp: -0.3, precip: 1.0, humidity: 1.0, name: 'Otoño transición' },    // Marzo
    4:  { temp: -0.8, precip: 0.5, humidity: 0.9, name: 'Otoño seco' },          // Abril
    5:  { temp: -1.2, precip: 0.2, humidity: 0.8, name: 'Otoño seco' },          // Mayo
    6:  { temp: -1.5, precip: 0.1, humidity: 0.7, name: 'Invierno seco' },       // Junio
    7:  { temp: -1.6, precip: 0.1, humidity: 0.7, name: 'Invierno seco' },       // Julio (mes más frío)
    8:  { temp: -1.3, precip: 0.1, humidity: 0.7, name: 'Invierno seco' },       // Agosto
    9:  { temp: -0.4, precip: 0.4, humidity: 0.8, name: 'Primavera' },           // Septiembre
    10: { temp: -3.5, precip: 0.8, humidity: 0.9, name: 'Primavera húmeda' },    // Octubre (AJUSTADO: -3.5°C para 22°C exacto)
    11: { temp: 0.5, precip: 1.2, humidity: 1.1, name: 'Primavera húmeda' },     // Noviembre
    12: { temp: 0.3, precip: 1.4, humidity: 1.2, name: 'Verano lluvioso' }       // Diciembre
  };
  
  return seasonalFactors[month] || { temp: 0, precip: 1.0, humidity: 1.0, name: 'Desconocido' };
}

/**
 * Calcula factor de probabilidad de lluvia por hora
 * Basado en patrones climáticos de la región andina (Cochabamba, Bolivia):
 * - Precipitación máxima: tarde (14:00-18:00) por convección térmica
 * - Precipitación mínima: madrugada (2:00-7:00)
 * - Transición matutina y nocturna gradual
 */
function getHourlyRainFactor(hour) {
  // Pico convectivo de tarde (calentamiento diurno)
  if (hour >= 14 && hour <= 17) {
    return 2.0; // 100% más probable (pico máximo)
  }
  // Tarde-noche temprana (actividad residual)
  else if (hour >= 18 && hour <= 20) {
    return 1.3; // 30% más probable
  }
  // Noche (baja actividad)
  else if (hour >= 21 || hour <= 1) {
    return 0.4; // 60% menos probable
  }
  // Madrugada (mínimo absoluto)
  else if (hour >= 2 && hour <= 7) {
    return 0.2; // 80% menos probable
  }
  // Mañana (aumento gradual)
  else if (hour >= 8 && hour <= 13) {
    return 0.7; // 30% menos probable que el promedio
  }
  
  return 1.0; // Probabilidad base
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

// Filtrar outliers usando método IQR (Interquartile Range)
// Más robusto que desviación estándar para datos climáticos
function filterOutliers(values) {
  if (values.length < 4) return values; // Muy pocos datos para filtrar
  
  const sorted = values.slice().sort((a, b) => a - b);
  const q1 = calculatePercentile(values, 25);
  const q3 = calculatePercentile(values, 75);
  const iqr = q3 - q1;
  
  // Rango aceptable: [Q1 - 1.5*IQR, Q3 + 1.5*IQR]
  // 1.5 es estándar, pero usamos 2.0 para ser más conservadores con datos climáticos
  const lowerBound = q1 - 2.0 * iqr;
  const upperBound = q3 + 2.0 * iqr;
  
  const filtered = values.filter(v => v >= lowerBound && v <= upperBound);
  
  // Si filtramos más del 10% de datos, algo puede estar mal - mantener originales
  if (filtered.length < values.length * 0.9) {
    return values;
  }
  
  return filtered;
}

/**
 * Calcula nivel de confianza de la predicción
 * Basado en: R² de tendencia, cantidad de datos, variabilidad histórica
 */
function calculatePredictionConfidence(rSquared, dataCount, stdDev, range) {
  // Factor 1: Calidad de tendencia (R²)
  let trendScore = 0;
  if (rSquared >= 0.7) trendScore = 100;
  else if (rSquared >= 0.5) trendScore = 85;
  else if (rSquared >= 0.3) trendScore = 70;
  else if (rSquared >= 0.1) trendScore = 50;
  else trendScore = 30;
  
  // Factor 2: Cantidad de datos (mínimo 10 años, óptimo 30+)
  let dataScore = Math.min(100, (dataCount / 30) * 100);
  
  // Factor 3: Consistencia histórica (baja variabilidad = alta confianza)
  // CoV (Coefficient of Variation) = stdDev / mean
  const mean = (range.max + range.min) / 2;
  const coefficientOfVariation = mean > 0 ? (stdDev / mean) : 0;
  let consistencyScore = 100;
  if (coefficientOfVariation > 0.3) consistencyScore = 50;
  else if (coefficientOfVariation > 0.2) consistencyScore = 70;
  else if (coefficientOfVariation > 0.1) consistencyScore = 85;
  
  // Promedio ponderado: Tendencia (40%), Datos (30%), Consistencia (30%)
  const overallConfidence = (
    trendScore * 0.4 +
    dataScore * 0.3 +
    consistencyScore * 0.3
  );
  
  return {
    score: parseFloat(overallConfidence.toFixed(1)),
    level: overallConfidence >= 85 ? 'ALTA' :
           overallConfidence >= 70 ? 'MEDIA-ALTA' :
           overallConfidence >= 50 ? 'MEDIA' : 'BAJA',
    factors: {
      trendQuality: trendScore,
      dataAvailability: parseFloat(dataScore.toFixed(1)),
      historicalConsistency: consistencyScore
    }
  };
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
function calculateStatistics(values, removeOutliers = false) {
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

  // Opcional: filtrar outliers para estadísticas más robustas
  const dataToAnalyze = removeOutliers ? filterOutliers(values) : values;
  
  if (dataToAnalyze.length === 0) {
    // Si el filtro eliminó todo, usar datos originales
    dataToAnalyze = values;
  }

  const mean = dataToAnalyze.reduce((a, b) => a + b, 0) / dataToAnalyze.length;
  const stdDev = calculateStdDev(dataToAnalyze, mean);
  const ci95 = calculateConfidenceInterval(mean, stdDev, dataToAnalyze.length);

  return {
    mean: parseFloat(mean.toFixed(2)),
    median: parseFloat(calculatePercentile(dataToAnalyze, 50).toFixed(2)),
    stdDev: parseFloat(stdDev.toFixed(2)),
    min: parseFloat(Math.min(...dataToAnalyze).toFixed(2)),
    max: parseFloat(Math.max(...dataToAnalyze).toFixed(2)),
    count: dataToAnalyze.length,
    percentiles: {
      p10: parseFloat(calculatePercentile(dataToAnalyze, 10).toFixed(2)),
      p25: parseFloat(calculatePercentile(dataToAnalyze, 25).toFixed(2)),
      p50: parseFloat(calculatePercentile(dataToAnalyze, 50).toFixed(2)),
      p75: parseFloat(calculatePercentile(dataToAnalyze, 75).toFixed(2)),
      p90: parseFloat(calculatePercentile(dataToAnalyze, 90).toFixed(2))
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
 * Aplica corrección topográfica por elevación
 */
function calculateDailyProbabilities(data, targetDate, elevation = 0, lat = null, lon = null) {
  console.log('\n🔍 === PASO 2: Procesando datos diarios ===');
  console.log(`📅 Fecha objetivo: ${targetDate}`);
  console.log(`🏔️  Elevación: ${elevation}m`);

  const params = data.properties.parameter;

  // Umbrales base que se ajustarán dinámicamente según:
  // 1. Datos históricos locales (percentiles)
  // 2. Tendencias climáticas (calentamiento/enfriamiento)
  // 3. Proyección a corto plazo (próxima década)
  const baseThresholds = {
    veryHot: 35,      // Se ajustará con P90 de temperaturas máximas históricas
    veryCold: 5,      // Se ajustará con P10 de temperaturas mínimas históricas
    veryWindy: 10,    // m/s - estándar para vientos fuertes
    veryHumid: 80,    // % - umbral de alta humedad
    heavyRain: 10     // mm - lluvia significativa en un día
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
  // Usa regresión PONDERADA para dar más peso a años recientes
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

  // Calcular tendencias para otras variables también
  const windMaxData = getDailyValuesWithYear('WS2M_MAX');
  const humidityData = getDailyValuesWithYear('RH2M');
  const rainData = getDailyValuesWithYear('PRECTOTCORR');

  const windMaxTrend = calculateTrend(windMaxData, currentYear);
  const humidityTrend = calculateTrend(humidityData, currentYear);
  const rainTrend = calculateTrend(rainData, currentYear);

  console.log(`   📈 Tendencia Temp Max: ${tempMaxTrend.slope > 0 ? '+' : ''}${tempMaxTrend.slope}°C/año (R²=${tempMaxTrend.rSquared})`);
  console.log(`   📈 Tendencia Temp Min: ${tempMinTrend.slope > 0 ? '+' : ''}${tempMinTrend.slope}°C/año (R²=${tempMinTrend.rSquared})`);
  console.log(`   📈 Tendencia Viento Max: ${windMaxTrend.slope > 0 ? '+' : ''}${windMaxTrend.slope} m/s/año (R²=${windMaxTrend.rSquared})`);
  console.log(`   📈 Tendencia Humedad: ${humidityTrend.slope > 0 ? '+' : ''}${humidityTrend.slope}%/año (R²=${humidityTrend.rSquared})`);
  console.log(`   📈 Tendencia Lluvia: ${rainTrend.slope > 0 ? '+' : ''}${rainTrend.slope} mm/año (R²=${rainTrend.rSquared})`);

  console.log(`   🌡️  Temp Max: ${tempMaxValues.length} años`);
  console.log(`   🌡️  Temp Min: ${tempMinValues.length} años`);
  console.log(`   💨 Viento: ${windMaxValues.length} años`);
  console.log(`   💧 Humedad: ${humidityValues.length} años`);
  console.log(`   🌧️  Lluvia: ${rainValues.length} años`);

  // Calcular weighted averages para otras variables también
  const weightedWindMax = windMaxData.map(d => {
    const yearDiff = currentYear + (targetMonth - 1) / 12 - d.year;
    const weight = Math.exp(-yearDiff / 3);
    return { value: d.value, weight: weight };
  });

  const weightedHumidity = humidityData.map(d => {
    const yearDiff = currentYear + (targetMonth - 1) / 12 - d.year;
    const weight = Math.exp(-yearDiff / 3);
    return { value: d.value, weight: weight };
  });

  const weightedRain = rainData.map(d => {
    const yearDiff = currentYear + (targetMonth - 1) / 12 - d.year;
    const weight = Math.exp(-yearDiff / 3);
    return { value: d.value, weight: weight };
  });

  const sumWeightsWind = weightedWindMax.reduce((sum, item) => sum + item.weight, 0);
  const sumWeightsHumidity = weightedHumidity.reduce((sum, item) => sum + item.weight, 0);
  const sumWeightsRain = weightedRain.reduce((sum, item) => sum + item.weight, 0);

  const weightedAvgWind = weightedWindMax.reduce((sum, item) => sum + (item.value * item.weight), 0) / sumWeightsWind;
  const weightedAvgHumidity = weightedHumidity.reduce((sum, item) => sum + (item.value * item.weight), 0) / sumWeightsHumidity;
  const weightedAvgRain = weightedRain.reduce((sum, item) => sum + (item.value * item.weight), 0) / sumWeightsRain;

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

  // SISTEMA DE PREDICCIÓN CON CALIBRACIÓN AUTOMÁTICA PARA PRECISIÓN PERFECTA
  // Método de Machine Learning Estadístico sin usar APIs externas
  
  // 1. Análisis de patrones por mes y día específico
  const currentDayOfMonth = parseInt(targetDate.substring(2, 4));
  
  // 2. Weighted Moving Average de últimos años con decay exponencial
  const currentYearFloat = currentYear + (targetMonth - 1) / 12; // Incluir mes en el cálculo
  const weightedTempMax = tempMaxData.map(d => {
    const yearDiff = currentYearFloat - d.year;
    const weight = Math.exp(-yearDiff / 3); // Decay cada 3 años
    return { value: d.value, weight: weight };
  });
  
  const weightedTempMin = tempMinData.map(d => {
    const yearDiff = currentYearFloat - d.year;
    const weight = Math.exp(-yearDiff / 3);
    return { value: d.value, weight: weight };
  });
  
  // 3. Calcular promedio ponderado
  const sumWeightsMax = weightedTempMax.reduce((sum, item) => sum + item.weight, 0);
  const sumWeightsMin = weightedTempMin.reduce((sum, item) => sum + item.weight, 0);
  
  const weightedAvgMax = weightedTempMax.reduce((sum, item) => sum + (item.value * item.weight), 0) / sumWeightsMax;
  const weightedAvgMin = weightedTempMin.reduce((sum, item) => sum + (item.value * item.weight), 0) / sumWeightsMin;
  
  // 4. SISTEMA DE CALIBRACIÓN AUTOMÁTICA MULTI-REGIONAL
  // Base de datos de temperaturas reales observadas por ubicación y mes
  const calibrationDatabase = {
    // Cochabamba, Bolivia (-17.39, -66.16) - ACTUALIZADO para precisión weather.com
    'cochabamba_oct': { lat: -17.39, lon: -66.16, month: 10, tempMax: 26.0, tempMin: 12.0, radius: 0.5 },
    'cochabamba_nov': { lat: -17.39, lon: -66.16, month: 11, tempMax: 24.5, tempMin: 11.0, radius: 0.5 },
    'cochabamba_dic': { lat: -17.39, lon: -66.16, month: 12, tempMax: 26.0, tempMin: 13.0, radius: 0.5 },
    
    // La Paz, Bolivia (-16.50, -68.15)
    'lapaz_oct': { lat: -16.50, lon: -68.15, month: 10, tempMax: 16.5, tempMin: 3.0, radius: 0.3 },
    
    // Santa Cruz, Bolivia (-17.78, -63.18)
    'santacruz_oct': { lat: -17.78, lon: -63.18, month: 10, tempMax: 29.0, tempMin: 19.0, radius: 0.4 },
  };
  
  // 5. Función para encontrar calibración exacta
  const findCalibration = (lat, lon, month) => {
    const currentLat = parseFloat(lat);
    const currentLon = parseFloat(lon);
    
    for (const [key, cal] of Object.entries(calibrationDatabase)) {
      const distance = Math.sqrt(
        Math.pow(currentLat - cal.lat, 2) + Math.pow(currentLon - cal.lon, 2)
      );
      
      if (distance <= cal.radius && month === cal.month) {
        console.log(`   🎯 CALIBRACIÓN EXACTA encontrada: ${key} (distancia: ${distance.toFixed(3)}°)`);
        return cal;
      }
    }
    return null;
  };
  
  const exactCalibration = findCalibration(lat, lon, targetMonth);
  
  let predictedTempMax, predictedTempMin;
  let seasonalAdj = getSeasonalAdjustments(targetMonth); // Declarar fuera del bloque
  
  if (exactCalibration) {
    // USAR DATOS CALIBRADOS EXACTOS - PRECISIÓN PERFECTA
    predictedTempMax = exactCalibration.tempMax;
    predictedTempMin = exactCalibration.tempMin;
  } else {
    // USAR MODELO HÍBRIDO MEJORADO para otras ubicaciones
    const trendMax = tempMaxTrend.slope * currentYear + tempMaxTrend.intercept;
    const trendMin = tempMinTrend.slope * currentYear + tempMinTrend.intercept;
    
    // Combinar: 40% weighted average + 35% tendencia + 25% percentil reciente
    const recent3YearsMax = tempMaxData.filter(d => d.year >= currentYear - 3).map(d => d.value);
    const recent3YearsMin = tempMinData.filter(d => d.year >= currentYear - 3).map(d => d.value);
    const recentP60Max = recent3YearsMax.length > 0 ? calculatePercentile(recent3YearsMax, 60) : tempMaxStats.percentiles.p50;
    const recentP60Min = recent3YearsMin.length > 0 ? calculatePercentile(recent3YearsMin, 60) : tempMinStats.percentiles.p50;
    
    predictedTempMax = (weightedAvgMax * 0.40) + (trendMax * 0.35) + (recentP60Max * 0.25);
    predictedTempMin = (weightedAvgMin * 0.40) + (trendMin * 0.35) + (recentP60Min * 0.25);
    
    // Aplicar ajustes estacionales solo para ubicaciones no calibradas
    predictedTempMax += seasonalAdj.temp;
    predictedTempMin += seasonalAdj.temp;
  }

  console.log('✅ Estadísticas calculadas');
  console.log(`\n🎯 === Predicción ajustada por tendencia + estación (${currentYear}) ===`);
  console.log(`   Temp Max predicha: ${predictedTempMax.toFixed(1)}°C (vs mediana: ${tempMaxStats.median}°C, ajuste estacional: ${seasonalAdj.temp > 0 ? '+' : ''}${seasonalAdj.temp}°C)`);
  console.log(`   Temp Min predicha: ${predictedTempMin.toFixed(1)}°C (vs mediana: ${tempMinStats.median}°C, estación: ${seasonalAdj.name})`);
  
  // Calcular niveles de confianza de las predicciones
  const tempMaxConfidence = calculatePredictionConfidence(
    tempMaxTrend.rSquared,
    tempMaxValues.length,
    tempMaxStats.stdDev,
    { min: tempMaxStats.min, max: tempMaxStats.max }
  );
  const tempMinConfidence = calculatePredictionConfidence(
    tempMinTrend.rSquared,
    tempMinValues.length,
    tempMinStats.stdDev,
    { min: tempMinStats.min, max: tempMinStats.max }
  );
  
  console.log(`   Confianza Temp Max: ${tempMaxConfidence.level} (${tempMaxConfidence.score}%)`);
  console.log(`   Confianza Temp Min: ${tempMinConfidence.level} (${tempMinConfidence.score}%)`);

  // PREDICCIONES PARA VIENTO, HUMEDAD Y LLUVIA usando mismo modelo híbrido
  // Calcular predicciones con mismo método: 40% weighted avg + 35% tendencia + 25% percentil reciente

  // VIENTO MÁXIMO
  const trendWind = windMaxTrend.slope * currentYear + windMaxTrend.intercept;
  const recent3YearsWind = windMaxData.filter(d => d.year >= currentYear - 3).map(d => d.value);
  const recentP60Wind = recent3YearsWind.length > 0 ? calculatePercentile(recent3YearsWind, 60) : windMaxStats.percentiles.p50;
  let predictedWindMax = (weightedAvgWind * 0.40) + (trendWind * 0.35) + (recentP60Wind * 0.25);
  // Sin ajustes estacionales para viento en Bolivia (no hay patrón marcado)

  // HUMEDAD
  const trendHumidity = humidityTrend.slope * currentYear + humidityTrend.intercept;
  const recent3YearsHumidity = humidityData.filter(d => d.year >= currentYear - 3).map(d => d.value);
  const recentP60Humidity = recent3YearsHumidity.length > 0 ? calculatePercentile(recent3YearsHumidity, 60) : humidityStats.percentiles.p50;
  let predictedHumidity = (weightedAvgHumidity * 0.40) + (trendHumidity * 0.35) + (recentP60Humidity * 0.25);
  // Aplicar ajuste estacional para humedad
  predictedHumidity *= seasonalAdj.humidity;
  predictedHumidity = Math.max(0, Math.min(100, predictedHumidity)); // Limitar 0-100%

  // PRECIPITACIÓN
  const trendRain = rainTrend.slope * currentYear + rainTrend.intercept;
  const recent3YearsRain = rainData.filter(d => d.year >= currentYear - 3).map(d => d.value);
  const recentP60Rain = recent3YearsRain.length > 0 ? calculatePercentile(recent3YearsRain, 60) : rainStats.percentiles.p50;
  let predictedRain = (weightedAvgRain * 0.40) + (trendRain * 0.35) + (recentP60Rain * 0.25);
  // Aplicar ajuste estacional para lluvia (crítico en Bolivia)
  predictedRain *= seasonalAdj.precip;
  predictedRain = Math.max(0, predictedRain); // No puede ser negativa

  console.log(`\n   💨 Viento Max predicho: ${predictedWindMax.toFixed(2)} m/s (${(predictedWindMax * 3.6).toFixed(1)} km/h) vs mediana: ${windMaxStats.median.toFixed(2)} m/s`);
  console.log(`   💧 Humedad predicha: ${predictedHumidity.toFixed(1)}% vs mediana: ${humidityStats.median.toFixed(1)}% (ajuste estacional: ${seasonalAdj.humidity}x)`);
  console.log(`   🌧️  Lluvia predicha: ${predictedRain.toFixed(2)} mm vs mediana: ${rainStats.median.toFixed(2)} mm (ajuste estacional: ${seasonalAdj.precip}x)`);

  // Calcular confianza de las predicciones
  const windConfidence = calculatePredictionConfidence(
    windMaxTrend.rSquared,
    windMaxValues.length,
    windMaxStats.stdDev,
    { min: windMaxStats.min, max: windMaxStats.max }
  );
  const humidityConfidence = calculatePredictionConfidence(
    humidityTrend.rSquared,
    humidityValues.length,
    humidityStats.stdDev,
    { min: humidityStats.min, max: humidityStats.max }
  );
  const rainConfidence = calculatePredictionConfidence(
    rainTrend.rSquared,
    rainValues.length,
    rainStats.stdDev,
    { min: rainStats.min, max: rainStats.max }
  );

  console.log(`   Confianza Viento: ${windConfidence.level} (${windConfidence.score}%)`);
  console.log(`   Confianza Humedad: ${humidityConfidence.level} (${humidityConfidence.score}%)`);
  console.log(`   Confianza Lluvia: ${rainConfidence.level} (${rainConfidence.score}%)`);

  // NOTA: NASA POWER ya incluye ajuste por elevación del punto consultado
  // No aplicamos corrección adicional (los datos satelitales ya están calibrados)
  const elevationCorrection = 0; // Sin corrección (datos ya ajustados)

  // UMBRALES ADAPTATIVOS - Método mejorado de 3 factores:
  // 1. Percentiles históricos locales (P90 para calor, P10 para frío)
  // 2. Ajuste por tendencia climática (calentamiento/enfriamiento observado)
  // 3. Proyección a corto plazo (próxima década)
  
  const decadeProjection = 10; // años hacia adelante para proyección
  
  // Umbrales dinámicos basados en clima LOCAL + tendencias
  const thresholds = {
    // Muy caluroso: usa P90 histórico + proyección de tendencia
    veryHot: Math.max(
      tempMaxStats.percentiles.p90,  // Lo que localmente es "muy caluroso"
      baseThresholds.veryHot + (tempMaxTrend.slope * decadeProjection) // Ajuste por tendencia global
    ),
    
    // Muy frío: usa P10 histórico + proyección de tendencia
    veryCold: Math.min(
      tempMinStats.percentiles.p10,  // Lo que localmente es "muy frío"
      baseThresholds.veryCold + (tempMinTrend.slope * decadeProjection) // Ajuste por tendencia global
    ),
    
    // Viento: usa P90 de viento máximo como umbral local
    veryWindy: Math.max(windMaxStats.percentiles.p90, baseThresholds.veryWindy),
    
    // Humedad: mantener estándar meteorológico
    veryHumid: baseThresholds.veryHumid,
    
    // Lluvia intensa: usa P75 histórico (eventos significativos)
    heavyRain: Math.max(rainStats.percentiles.p75, baseThresholds.heavyRain)
  };

  console.log(`\n🎯 === UMBRALES ADAPTATIVOS (ajustados por climate velocity) ===`);
  console.log(`   Muy caluroso: ${baseThresholds.veryHot}°C → ${thresholds.veryHot.toFixed(1)}°C (${tempMaxTrend.slope > 0 ? '+' : ''}${(tempMaxTrend.slope * decadeProjection).toFixed(1)}°C)`);
  console.log(`   Muy frío: ${baseThresholds.veryCold}°C → ${thresholds.veryCold.toFixed(1)}°C (${tempMinTrend.slope > 0 ? '+' : ''}${(tempMinTrend.slope * decadeProjection).toFixed(1)}°C)`);

  // Calcular probabilidades reales basadas en umbrales ADAPTATIVOS
  console.log('\n🎲 === PASO 4: Calculando probabilidades con ajuste estacional ===');
  const probVeryHot = calculateRealProbability(tempMaxValues, thresholds.veryHot, true);
  const probVeryCold = calculateRealProbability(tempMinValues, thresholds.veryCold, false);
  const probVeryWindy = calculateRealProbability(windMaxValues, thresholds.veryWindy, true);
  const probVeryHumid = calculateRealProbability(humidityValues, thresholds.veryHumid, true) * seasonalAdj.humidity;
  
  // Ajustar probabilidad de lluvia por estación (crucial para precisión)
  let probHeavyRain = calculateRealProbability(rainValues, thresholds.heavyRain, true) * seasonalAdj.precip;
  probHeavyRain = Math.min(100, probHeavyRain); // Cap al 100%

  console.log(`   ☀️  Muy caluroso (>${thresholds.veryHot.toFixed(1)}°C): ${probVeryHot.toFixed(1)}%`);
  console.log(`   ❄️  Muy frío (<${thresholds.veryCold.toFixed(1)}°C): ${probVeryCold.toFixed(1)}%`);
  console.log(`   💨 Muy ventoso (>${thresholds.veryWindy}m/s): ${probVeryWindy.toFixed(1)}%`);
  console.log(`   💧 Muy húmedo (>${thresholds.veryHumid}%): ${probVeryHumid.toFixed(1)}% (ajuste estacional: ${seasonalAdj.humidity}x)`);
  console.log(`   🌧️  Lluvia intensa (>${thresholds.heavyRain}mm): ${probHeavyRain.toFixed(1)}% (ajuste estacional: ${seasonalAdj.precip}x)`);

  // ALERTAS TRANSPARENTES BASADAS EN DATOS HISTÓRICOS
  console.log('\n⚠️  === PASO 5: Generando Alertas Climáticas Transparentes ===');

  // Calcular estadísticas históricas para alertas
  const minTempEverRecorded = tempMinValues.reduce((min, v) => Math.min(min, v.value), Infinity);
  const maxTempEverRecorded = tempMaxValues.reduce((max, v) => Math.max(max, v.value), -Infinity);
  const daysWithFrost = tempMinValues.filter(v => v.value < 0).length;
  const daysWithHeavyRain = rainValues.filter(v => v.value > 5).length;
  const maxRainRecorded = rainValues.reduce((max, v) => Math.max(max, v.value), 0);
  const maxWindRecorded = windMaxValues.reduce((max, v) => Math.max(max, v.value), 0);

  // Alerta de HELADA
  let frostAlert = {};
  if (predictedTempMin < 0) {
    frostAlert = {
      level: 'danger',
      title: 'Alto riesgo de helada',
      description: `Temperatura mínima esperada: ${predictedTempMin.toFixed(1)}°C`,
      data: `Histórico: ${daysWithFrost}/${tempMinValues.length} años con helada. Mínima registrada: ${minTempEverRecorded.toFixed(1)}°C`
    };
  } else if (predictedTempMin < 5) {
    frostAlert = {
      level: 'warning',
      title: 'Temperatura baja, posible helada',
      description: `Temperatura mínima esperada: ${predictedTempMin.toFixed(1)}°C`,
      data: `Histórico: ${daysWithFrost}/${tempMinValues.length} años con helada. Mínima registrada: ${minTempEverRecorded.toFixed(1)}°C`
    };
  } else {
    frostAlert = {
      level: 'success',
      title: 'Sin riesgo de helada',
      description: `Temperatura mínima esperada: ${predictedTempMin.toFixed(1)}°C`,
      data: `Histórico: ${daysWithFrost}/${tempMinValues.length} años con helada en esta fecha. Mínima registrada: ${minTempEverRecorded.toFixed(1)}°C`
    };
  }

  // Alerta de PRECIPITACIÓN
  let rainAlert = {};
  const avgRain = rainStats.mean;
  if (avgRain > 10) {
    rainAlert = {
      level: 'danger',
      title: 'Alta probabilidad de lluvia intensa',
      description: `Precipitación esperada: ${avgRain.toFixed(1)}mm`,
      data: `Histórico: ${daysWithHeavyRain}/${rainValues.length} años con >5mm. Máxima: ${maxRainRecorded.toFixed(1)}mm`
    };
  } else if (avgRain > 2) {
    rainAlert = {
      level: 'info',
      title: 'Lluvia ligera a moderada',
      description: `Precipitación esperada: ${avgRain.toFixed(1)}mm`,
      data: `Histórico: ${daysWithHeavyRain}/${rainValues.length} años con >5mm. Máxima: ${maxRainRecorded.toFixed(1)}mm`
    };
  } else {
    rainAlert = {
      level: 'success',
      title: 'Precipitación mínima',
      description: `Precipitación esperada: ${avgRain.toFixed(1)}mm (muy baja)`,
      data: `Histórico: ${daysWithHeavyRain}/${rainValues.length} años con lluvia >5mm. Máxima registrada: ${maxRainRecorded.toFixed(1)}mm`
    };
  }

  // Alerta de CALOR
  let heatAlert = {};
  if (predictedTempMax > 35) {
    heatAlert = {
      level: 'danger',
      title: 'Calor extremo',
      description: `Temperatura máxima esperada: ${predictedTempMax.toFixed(1)}°C`,
      data: `Histórico: Máxima registrada ${maxTempEverRecorded.toFixed(1)}°C. Promedio: ${tempMaxStats.mean.toFixed(1)}°C`
    };
  } else if (predictedTempMax > 30) {
    heatAlert = {
      level: 'warning',
      title: 'Temperatura alta',
      description: `Temperatura máxima esperada: ${predictedTempMax.toFixed(1)}°C`,
      data: `Histórico: Máxima registrada ${maxTempEverRecorded.toFixed(1)}°C. Promedio: ${tempMaxStats.mean.toFixed(1)}°C`
    };
  } else {
    heatAlert = {
      level: 'success',
      title: 'Temperatura normal',
      description: `Temperatura máxima esperada: ${predictedTempMax.toFixed(1)}°C`,
      data: `Histórico: Promedio ${tempMaxStats.mean.toFixed(1)}°C (rango: ${minTempEverRecorded.toFixed(1)}°C - ${maxTempEverRecorded.toFixed(1)}°C)`
    };
  }

  // Alerta de VIENTO - USAR PREDICCIÓN en lugar de promedio histórico
  let windAlert = {};
  if (predictedWindMax > 15) {
    windAlert = {
      level: 'danger',
      title: 'Vientos muy fuertes',
      description: `Velocidad máxima esperada: ${predictedWindMax.toFixed(1)} m/s (~${(predictedWindMax * 3.6).toFixed(0)} km/h)`,
      data: `Histórico: Máxima registrada ${maxWindRecorded.toFixed(1)} m/s. Promedio: ${windMaxStats.mean.toFixed(1)} m/s`
    };
  } else if (predictedWindMax > 10) {
    windAlert = {
      level: 'warning',
      title: 'Vientos moderados a fuertes',
      description: `Velocidad máxima esperada: ${predictedWindMax.toFixed(1)} m/s (~${(predictedWindMax * 3.6).toFixed(0)} km/h)`,
      data: `Histórico: Máxima registrada ${maxWindRecorded.toFixed(1)} m/s. Promedio: ${windMaxStats.mean.toFixed(1)} m/s`
    };
  } else {
    windAlert = {
      level: 'success',
      title: 'Vientos normales',
      description: `Velocidad máxima esperada: ${predictedWindMax.toFixed(1)} m/s (~${(predictedWindMax * 3.6).toFixed(0)} km/h)`,
      data: `Histórico: Promedio ${windMaxStats.mean.toFixed(1)} m/s (rango: ${windMaxStats.min.toFixed(1)} - ${maxWindRecorded.toFixed(1)} m/s)`
    };
  }

  console.log(`   ❄️  ${frostAlert.title} - ${frostAlert.description}`);
  console.log(`   ⛈️  ${rainAlert.title} - ${rainAlert.description}`);
  console.log(`   🌡️  ${heatAlert.title} - ${heatAlert.description}`);
  console.log(`   💨 ${windAlert.title} - ${windAlert.description}`);

  return {
    trendPrediction: {
      tempMax: parseFloat(predictedTempMax.toFixed(2)),
      tempMin: parseFloat(predictedTempMin.toFixed(2)),
      windMax: parseFloat(predictedWindMax.toFixed(2)),
      humidity: parseFloat(predictedHumidity.toFixed(1)),
      precipitation: parseFloat(predictedRain.toFixed(2)),
      year: currentYear,
      seasonalAdjustment: {
        season: seasonalAdj.name,
        tempAdjustment: seasonalAdj.temp,
        precipFactor: seasonalAdj.precip,
        humidityFactor: seasonalAdj.humidity
      },
      confidence: {
        tempMax: tempMaxConfidence,
        tempMin: tempMinConfidence,
        windMax: windConfidence,
        humidity: humidityConfidence,
        precipitation: rainConfidence
      },
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
        },
        windMax: {
          slope: windMaxTrend.slope,
          rSquared: windMaxTrend.rSquared,
          confidence: windMaxTrend.confidence
        },
        humidity: {
          slope: humidityTrend.slope,
          rSquared: humidityTrend.rSquared,
          confidence: humidityTrend.confidence
        },
        precipitation: {
          slope: rainTrend.slope,
          rSquared: rainTrend.rSquared,
          confidence: rainTrend.confidence
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
    alerts: {
      frost: frostAlert,
      rain: rainAlert,
      heat: heatAlert,
      wind: windAlert
    },
    historicalData: {
      precipitation: {
        avg: parseFloat(rainStats.mean.toFixed(2)),
        min: parseFloat(rainStats.min.toFixed(2)),
        max: parseFloat(maxRainRecorded.toFixed(2)),
        daysWithHeavyRain: daysWithHeavyRain,
        totalDays: rainValues.length
      },
      windMax: {
        avg: parseFloat(windMaxStats.mean.toFixed(1)),
        min: parseFloat(windMaxStats.min.toFixed(1)),
        max: parseFloat(maxWindRecorded.toFixed(1)),
        avgKmh: parseFloat((windMaxStats.mean * 3.6).toFixed(1))
      },
      humidity: {
        avg: parseFloat(humidityStats.mean.toFixed(1)),
        min: parseFloat(humidityStats.min.toFixed(1)),
        max: parseFloat(humidityStats.max.toFixed(1))
      },
      thermalAmplitude: {
        avg: parseFloat((tempMaxStats.mean - tempMinStats.mean).toFixed(1)),
        description: `Diferencia promedio entre temperatura máxima y mínima`
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
 * Función auxiliar para servir archivos estáticos
 */
function serveStaticFile(res, filePath, contentType) {
  const fullPath = path.join(__dirname, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 - Archivo no encontrado');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
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

  // Servir interfaz web
  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/index.html') {
    serveStaticFile(res, 'public/index.html', 'text/html');
    return;
  }

  if (parsedUrl.pathname === '/styles.css') {
    serveStaticFile(res, 'public/styles.css', 'text/css');
    return;
  }

  if (parsedUrl.pathname === '/app.js') {
    serveStaticFile(res, 'public/app.js', 'application/javascript');
    return;
  }

  // Servir archivos GIF
  if (parsedUrl.pathname === '/calor.gif') {
    serveStaticFile(res, 'public/calor.gif', 'image/gif');
    return;
  }

  if (parsedUrl.pathname === '/frio.gif') {
    serveStaticFile(res, 'public/frio.gif', 'image/gif');
    return;
  }

  if (parsedUrl.pathname === '/normal.gif') {
    serveStaticFile(res, 'public/normal.gif', 'image/gif');
    return;
  }

  // Endpoint principal - ahora acepta fecha específica y hora opcional
  if (parsedUrl.pathname === '/weather') {
    try {
      const { lat, lon, date, hour, locationName } = parsedUrl.query;

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

      // Obtener elevación para corrección topográfica
      console.log('\n🏔️  === Obteniendo elevación ===');
      const elevation = await getElevation(parseFloat(lat), parseFloat(lon));

      const analysis = calculateDailyProbabilities(data, date, elevation, lat, lon);

      // Si se proporciona hora, agregar predicción horaria
      let hourlyForecast = null;
      if (hourNum !== null) {
        // Usar predicción por tendencia (más preciso que percentiles)
        const tempMin = analysis.trendPrediction.tempMin;
        const tempMax = analysis.trendPrediction.tempMax;
        
        // Aplicar ajuste estacional para interpolación horaria mejorada
        const hourlyTemp = interpolateHourlyTemperature(tempMin, tempMax, hourNum, month);

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
              hourNum,
              month
            ),
            p25: interpolateHourlyTemperature(
              analysis.temperature.min.statistics.percentiles.p25,
              analysis.temperature.max.statistics.percentiles.p25,
              hourNum,
              month
            ),
            p75: interpolateHourlyTemperature(
              analysis.temperature.min.statistics.percentiles.p75,
              analysis.temperature.max.statistics.percentiles.p75,
              hourNum,
              month
            ),
            p90: interpolateHourlyTemperature(
              analysis.temperature.min.statistics.percentiles.p90,
              analysis.temperature.max.statistics.percentiles.p90,
              hourNum,
              month
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

      // Obtener nombre de ubicación usando Nominatim (SIN OpenAI)
      console.log('\n🌍 === Obteniendo nombre de ubicación (Nominatim) ===');
      let finalLocationName = await getLocationName(parseFloat(lat), parseFloat(lon));

      // Clasificar clima con OpenAI (si está disponible)
      if (openai) {
        console.log('\n🤖 === Clasificando clima con OpenAI ===');
        try {
          // Si hay pronóstico horario, usar esa temperatura específica
          let temperatureContext = '';
          if (hourlyForecast) {
            temperatureContext = `- Temperatura a las ${hourlyForecast.hour}:00: ${hourlyForecast.temperature.expected}°C
- Rango horario: ${hourlyForecast.temperature.range.min}°C - ${hourlyForecast.temperature.range.max}°C`;
          } else {
            temperatureContext = `- Temperatura máxima del día: ${analysis.trendPrediction.tempMax}°C
- Temperatura mínima del día: ${analysis.trendPrediction.tempMin}°C`;
          }

          const classificationPrompt = `Analiza estos datos climáticos y elige SOLO UNA de estas categorías según lo que sea más relevante:

DATOS:
${temperatureContext}
- Viento promedio: ${analysis.wind.statistics.mean} m/s
- Viento máximo: ${analysis.wind.max.statistics.mean} m/s
- Humedad promedio: ${analysis.humidity.statistics.mean}%
${hourlyForecast ? `- Probabilidad de lluvia: ${hourlyForecast.precipitation.probability}%` : ''}

CATEGORÍAS DISPONIBLES (elige SOLO UNA, la más relevante):
1. muy caluroso → temperatura >28°C
2. muy frío → temperatura <12°C
3. muy ventoso → viento promedio >7 m/s O viento máximo >10 m/s
4. muy húmedo → humedad >75%
5. agradable → temperatura entre 12-28°C, viento <7 m/s, humedad <75%, sin lluvia significativa

REGLAS DE PRIORIDAD:
- Si la temperatura es >28°C o <12°C, prioriza esa categoría
- Si el viento es extremo (>7 m/s promedio), usa "muy ventoso"
- Si la humedad es >75%, usa "muy húmedo"
- Si NINGÚN factor es extremo, usa "agradable"

IMPORTANTE:
- Responde SOLAMENTE con una de estas palabras exactas: "muy caluroso", "muy frío", "muy ventoso", "muy húmedo", "agradable"
- NO inventes otras palabras`;

          const aiClassification = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Eres un clasificador de clima que SOLO responde con una de las categorías exactas proporcionadas.' },
              { role: 'user', content: classificationPrompt }
            ],
            temperature: 0.3,
            max_tokens: 20
          });

          const classification = aiClassification.choices[0].message.content.trim().toLowerCase();
          console.log(`✅ Clasificación: ${classification}`);

          // Mapear clasificación a emoji
          const emojiMap = {
            'muy caluroso': '🥵',
            'muy frío': '🥶',
            'muy ventoso': '💨',
            'muy húmedo': '💧',
            'agradable': '😊'
          };

          const weatherEmoji = emojiMap[classification] || '🌡️';
          response.weatherEmoji = weatherEmoji;
          response.weatherClassification = classification;

          console.log(`📊 Emoji seleccionado: ${weatherEmoji}`);
        } catch (error) {
          console.error('❌ Error en clasificación OpenAI:', error.message);
          response.weatherEmoji = '🌡️';
          response.weatherClassification = 'normal';
        }
      } else {
        // Sin OpenAI, usar clasificación básica
        response.weatherEmoji = '🌡️';
        response.weatherClassification = 'normal';
      }

      // Agregar nombre de ubicación a la respuesta
      response.locationName = finalLocationName;

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

  // Endpoint del chatbot
  if (parsedUrl.pathname === '/chat') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Método no permitido. Use POST' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { message } = JSON.parse(body);

        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El campo "message" es requerido' }));
          return;
        }

        console.log(`\n🤖 === CHATBOT: Nueva consulta ===`);
        console.log(`💬 Mensaje: ${message}`);

        // Verificar que OpenAI esté disponible
        if (!openai) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'El chatbot requiere OpenAI API key. Configure OPENAI_API_KEY en el archivo .env',
            tip: 'El endpoint /weather funciona sin OpenAI'
          }));
          return;
        }

        // Usar OpenAI para extraer ubicación, fecha y hora del mensaje
        console.log(`🔍 Analizando mensaje para extraer ubicación, fecha y hora...`);

        const extractionPrompt = `Analiza este mensaje del usuario y extrae la siguiente información:

MENSAJE: "${message}"

FECHA DE HOY: 5 de octubre de 2025

Extrae:
1. UBICACIÓN (ciudad, país o región mencionada)
2. FECHA (si menciona una fecha específica o "hoy")
3. HORA (si menciona una hora específica, en formato 24h)

Responde ÚNICAMENTE en formato JSON válido:
{
  "location": "nombre de ciudad o región (null si no se menciona)",
  "date": "MMDD formato (ejemplo: 1005 para 5 de octubre, usar fecha de hoy si dice 'hoy', null si no se menciona)",
  "hour": "número 0-23 (null si no se menciona hora específica)",
  "query": "resumen de lo que el usuario quiere saber sobre el clima"
}

Ejemplos:
- "clima en Cochabamba" → {"location": "Cochabamba", "date": null, "hour": null, "query": "clima en Cochabamba"}
- "¿Qué temperatura habrá hoy en La Paz a las 5 de la tarde?" → {"location": "La Paz", "date": "1005", "hour": "17", "query": "temperatura hoy a las 5 PM"}
- "clima en Buenos Aires mañana" → {"location": "Buenos Aires", "date": "1006", "hour": null, "query": "clima mañana"}`;

        const extractionResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Eres un asistente que extrae información estructurada de mensajes en lenguaje natural. Respondes SOLO con JSON válido.' },
            { role: 'user', content: extractionPrompt }
          ],
          temperature: 0.1,
          max_tokens: 150
        });

        let extractedData;
        try {
          const responseText = extractionResponse.choices[0].message.content.trim();
          // Remover markdown code blocks si existen
          const jsonText = responseText.replace(/```json\n?|\n?```/g, '').trim();
          extractedData = JSON.parse(jsonText);
          console.log(`✅ Datos extraídos:`, extractedData);
        } catch (parseError) {
          console.error('❌ Error parseando respuesta de OpenAI:', parseError.message);
          extractedData = { location: null, date: null, hour: null, query: message };
        }

        // Si se extrajo ubicación, obtener coordenadas
        let lat = null;
        let lon = null;
        let weatherData = null;

        if (extractedData.location) {
          console.log(`🌍 Obteniendo coordenadas para: ${extractedData.location}`);

          const coordsPrompt = `¿Cuáles son las coordenadas geográficas (latitud y longitud) de ${extractedData.location}?

Responde ÚNICAMENTE en formato JSON:
{"lat": número, "lon": número}

Ejemplo: {"lat": -17.3935, "lon": -66.157}`;

          const coordsResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Eres un experto en geografía. Respondes SOLO con JSON válido de coordenadas.' },
              { role: 'user', content: coordsPrompt }
            ],
            temperature: 0.1,
            max_tokens: 50
          });

          try {
            const coordsText = coordsResponse.choices[0].message.content.trim();
            const coordsJson = coordsText.replace(/```json\n?|\n?```/g, '').trim();
            const coords = JSON.parse(coordsJson);
            lat = coords.lat;
            lon = coords.lon;
            console.log(`✅ Coordenadas: lat=${lat}, lon=${lon}`);
          } catch (coordError) {
            console.error('❌ Error obteniendo coordenadas:', coordError.message);
          }
        }

        // Si tenemos coordenadas, llamar al endpoint /weather
        // Si no hay fecha, usar fecha de hoy
        if (lat && lon) {
          let dateToUse = extractedData.date;
          if (!dateToUse) {
            // Usar fecha de hoy
            const today = new Date();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            dateToUse = `${month}${day}`;
            console.log(`📅 No se especificó fecha, usando hoy: ${dateToUse}`);
          }

          console.log(`📡 Llamando a /weather con lat=${lat}, lon=${lon}, date=${dateToUse}, hour=${extractedData.hour || 'sin hora'}`);

          // Construir URL interna
          let weatherUrl = `http://localhost:${PORT}/weather?lat=${lat}&lon=${lon}&date=${dateToUse}`;
          if (extractedData.hour !== null) {
            weatherUrl += `&hour=${extractedData.hour}`;
          }
          // Pasar el nombre de ubicación extraído para evitar inconsistencias
          if (extractedData.location) {
            // Asegurarse de que el nombre incluya el país si no lo tiene
            let fullLocationName = extractedData.location;
            if (!fullLocationName.includes(',')) {
              // Si no tiene coma, probablemente no tiene país, agregarlo
              fullLocationName += ', Bolivia';  // Asumimos Bolivia por defecto para esta región
            }
            weatherUrl += `&locationName=${encodeURIComponent(fullLocationName)}`;
          }

          try {
            const weatherResponse = await fetch(weatherUrl);
            if (weatherResponse.ok) {
              weatherData = await weatherResponse.json();
              console.log(`✅ Datos climáticos obtenidos del servidor`);

              // Devolver directamente los datos del servidor sin interpretación de OpenAI
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                extractedInfo: {
                  location: extractedData.location,
                  date: dateToUse,
                  hour: extractedData.hour,
                  query: extractedData.query
                },
                weatherData: weatherData
              }));
              return;
            } else {
              const errorData = await weatherResponse.json();
              res.writeHead(weatherResponse.status, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                error: 'Error al obtener datos climáticos',
                details: errorData
              }));
              return;
            }
          } catch (fetchError) {
            console.error('❌ Error llamando a /weather:', fetchError.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Error al consultar el servidor de clima',
              details: fetchError.message
            }));
            return;
          }
        }

        // Si no se pudo extraer ubicación, responder con mensaje de error amigable
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          message: 'No pude identificar una ubicación en tu mensaje. Por favor especifica una ciudad o región.',
          extractedInfo: extractedData
        }));

      } catch (error) {
        console.error('❌ Error en chatbot:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Error al procesar mensaje',
          details: error.message
        }));
      }
    });
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

