/* =============================================
   TOURIST MODE — Smart Recommendation Engine
   Separate module · Does NOT touch weather core
   ============================================= */

/* ---- Constants ---- */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const SEARCH_RADIUS = 15000;   // 15 km radius search
const MAX_TRAVEL_MIN = 60;     // max travel time in minutes
const MIN_TRAVEL_MIN = 5;      // min travel time
const AVG_SPEED_KMH  = 30;    // average city driving speed

/* ---- DOM Refs ---- */
const touristToggle   = document.getElementById('tourist-toggle');
const touristPanel    = document.getElementById('tourist-panel');
const touristLoading  = document.getElementById('tourist-loading');
const touristError    = document.getElementById('tourist-error');
const touristErrorMsg = document.getElementById('tourist-error-msg');
const touristRetry    = document.getElementById('tourist-retry-btn');
const touristResults  = document.getElementById('tourist-results');
const touristGrid     = document.getElementById('tourist-grid');
const touristEmpty    = document.getElementById('tourist-empty');
const chipIcon        = document.getElementById('chip-icon');
const chipText        = document.getElementById('chip-text');

/* ---- State ---- */
let touristActive = false;
let touristCoords = null;     // { lat, lon }

/* ---- Category Icons ---- */
const categoryConfig = {
    indoor: {
        icon: '🏛️',
        class: 'cat-indoor',
        types: ['museum', 'art_gallery', 'library', 'cinema', 'theatre', 'mall', 'shopping_centre']
    },
    covered: {
        icon: '☕',
        class: 'cat-covered',
        types: ['cafe', 'restaurant', 'fast_food', 'pub', 'bar', 'food_court']
    },
    outdoor: {
        icon: '🌳',
        class: 'cat-outdoor',
        types: ['park', 'garden', 'playground', 'sports_centre', 'stadium', 'beach', 'nature_reserve']
    },
    scenic: {
        icon: '🌅',
        class: 'cat-scenic',
        types: ['viewpoint', 'monument', 'memorial', 'bridge', 'fountain', 'artwork', 'ruins', 'castle']
    }
};

/* =============================================
   OVERPASS QUERY BUILDER
   Fetches real POIs from OpenStreetMap
   ============================================= */
function buildOverpassQuery(lat, lon, radius, types) {
    // Query multiple tourism/amenity/leisure types
    const filters = [];

    // Tourism types
    const tourismTypes = ['museum', 'art_gallery', 'viewpoint', 'monument', 'artwork', 'castle'];
    // Amenity types
    const amenityTypes = ['cafe', 'restaurant', 'fast_food', 'pub', 'bar', 'cinema', 'theatre', 'library'];
    // Leisure types
    const leisureTypes = ['park', 'garden', 'playground', 'sports_centre', 'nature_reserve', 'stadium', 'beach_resort'];
    // Shop types (malls)
    const shopTypes = ['mall', 'department_store'];

    // Build queries for each tag type
    const area = `(around:${radius},${lat},${lon})`;

    tourismTypes.forEach(t => {
        filters.push(`node["tourism"="${t}"]${area};`);
        filters.push(`way["tourism"="${t}"]${area};`);
    });
    amenityTypes.forEach(t => {
        filters.push(`node["amenity"="${t}"]${area};`);
    });
    leisureTypes.forEach(t => {
        filters.push(`node["leisure"="${t}"]${area};`);
        filters.push(`way["leisure"="${t}"]${area};`);
    });
    shopTypes.forEach(t => {
        filters.push(`node["shop"="${t}"]${area};`);
        filters.push(`way["shop"="${t}"]${area};`);
    });

    // Also search named "historic" places
    filters.push(`node["historic"]${area};`);
    filters.push(`way["historic"]${area};`);

    return `[out:json][timeout:15];(${filters.join('')});out center 80;`;
}

/* =============================================
   FETCH NEARBY PLACES
   ============================================= */
async function fetchNearbyPlaces(lat, lon) {
    const query = buildOverpassQuery(lat, lon, SEARCH_RADIUS);
    const resp = await fetch(OVERPASS_URL, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!resp.ok) throw new Error('Places API error');

    const data = await resp.json();
    return data.elements
        .filter(el => el.tags && el.tags.name)  // only named places
        .map(el => {
            const elLat = el.lat || (el.center && el.center.lat);
            const elLon = el.lon || (el.center && el.center.lon);
            if (!elLat || !elLon) return null;

            const dist = haversine(lat, lon, elLat, elLon);
            const travelMin = Math.round((dist / AVG_SPEED_KMH) * 60);

            return {
                name: el.tags.name,
                lat: elLat,
                lon: elLon,
                distance: dist,
                travelMin: travelMin,
                tags: el.tags,
                type: detectPlaceType(el.tags),
                category: detectCategory(el.tags)
            };
        })
        .filter(p => p && p.travelMin >= MIN_TRAVEL_MIN && p.travelMin <= MAX_TRAVEL_MIN);
}

/* =============================================
   DISTANCE CALCULATION (Haversine)
   ============================================= */
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* =============================================
   TYPE & CATEGORY DETECTION
   ============================================= */
function detectPlaceType(tags) {
    if (tags.tourism)  return tags.tourism;
    if (tags.amenity)  return tags.amenity;
    if (tags.leisure)  return tags.leisure;
    if (tags.shop)     return tags.shop;
    if (tags.historic) return tags.historic;
    return 'place';
}

function detectCategory(tags) {
    const type = detectPlaceType(tags);

    // Indoor
    if (['museum', 'art_gallery', 'library', 'cinema', 'theatre',
         'mall', 'department_store', 'shopping_centre'].includes(type)) {
        return 'indoor';
    }

    // Covered (food & drink)
    if (['cafe', 'restaurant', 'fast_food', 'pub', 'bar', 'food_court'].includes(type)) {
        return 'covered';
    }

    // Scenic
    if (['viewpoint', 'monument', 'memorial', 'artwork', 'ruins',
         'castle', 'bridge', 'fountain', 'archaeological_site'].includes(type)) {
        return 'scenic';
    }

    // Outdoor
    return 'outdoor';
}

/* =============================================
   WEATHER-SMART RECOMMENDATION LOGIC
   ============================================= */
function getWeatherCondition(weatherData) {
    if (!weatherData) return { type: 'unknown', reason: '' };

    const temp = weatherData.main.temp;          // Celsius (API returns metric)
    const code = weatherData.weather[0].id;
    const icon = weatherData.weather[0].icon;
    const isNight = icon.includes('n');
    const desc = weatherData.weather[0].description;

    // Determine primary condition
    const isRaining = code >= 200 && code < 600;      // thunderstorm, drizzle, rain
    const isSnowing = code >= 600 && code < 700;
    const isClear   = code === 800;
    const isHot     = temp > 32;
    const isCold    = temp < 5;
    const isPleasant = temp >= 15 && temp <= 28;
    const isEvening = isNight || (new Date().getHours() >= 17);

    // Priority-based condition mapping
    if (isRaining) {
        return {
            type: 'rainy',
            chipIcon: '🌧️',
            chipText: `Rainy · ${Math.round(temp)}°C — Suggesting covered spots`,
            filter: (places) => prioritize(places, ['covered', 'indoor']),
            reason: (cat) => cat === 'covered' ? 'Stay dry and cozy' : 'Perfect shelter from rain'
        };
    }

    if (isSnowing) {
        return {
            type: 'snowy',
            chipIcon: '❄️',
            chipText: `Snowing · ${Math.round(temp)}°C — Warm indoor picks`,
            filter: (places) => prioritize(places, ['indoor', 'covered']),
            reason: (cat) => cat === 'indoor' ? 'Warm escape from snow' : 'Cozy spot for snowy days'
        };
    }

    if (isHot) {
        return {
            type: 'hot',
            chipIcon: '🔥',
            chipText: `Hot · ${Math.round(temp)}°C — Cool indoor suggestions`,
            filter: (places) => prioritize(places, ['indoor', 'covered']),
            reason: (cat) => cat === 'indoor' ? 'Beat the heat indoors' : 'Cool down with a drink'
        };
    }

    if (isEvening && isClear) {
        return {
            type: 'evening_clear',
            chipIcon: '🌅',
            chipText: `Clear evening · ${Math.round(temp)}°C — Sunset & scenic spots`,
            filter: (places) => prioritize(places, ['scenic', 'outdoor']),
            reason: (cat) => cat === 'scenic' ? 'Perfect for a sunset view' : 'Enjoy the evening breeze'
        };
    }

    if (isCold) {
        return {
            type: 'cold',
            chipIcon: '🥶',
            chipText: `Cold · ${Math.round(temp)}°C — Warm retreats`,
            filter: (places) => prioritize(places, ['covered', 'indoor']),
            reason: (cat) => cat === 'covered' ? 'Warm up with hot drinks' : 'Escape the cold'
        };
    }

    if (isPleasant && isClear) {
        return {
            type: 'pleasant',
            chipIcon: '☀️',
            chipText: `Pleasant · ${Math.round(temp)}°C — Great for outdoors`,
            filter: (places) => prioritize(places, ['outdoor', 'scenic']),
            reason: (cat) => cat === 'outdoor' ? 'Perfect weather for fresh air' : 'Beautiful conditions for sightseeing'
        };
    }

    // Default: pleasant/mixed
    return {
        type: 'mixed',
        chipIcon: '⛅',
        chipText: `${desc} · ${Math.round(temp)}°C — Mixed suggestions`,
        filter: (places) => places,
        reason: () => 'Good spot to explore'
    };
}

/**
 * Prioritize places by preferred categories.
 * Preferred categories come first, but include others as fallbacks.
 */
function prioritize(places, preferredCats) {
    const preferred = places.filter(p => preferredCats.includes(p.category));
    const others    = places.filter(p => !preferredCats.includes(p.category));
    return [...preferred, ...others];
}

/* =============================================
   RENDER TOURIST RESULTS
   ============================================= */
function renderTouristPlaces(places, condition) {
    // Deduplicate by name
    const seen = new Set();
    const unique = places.filter(p => {
        const key = p.name.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Apply weather filter & limit
    const filtered = condition.filter(unique).slice(0, 8);

    if (filtered.length === 0) {
        showTouristState('empty');
        return;
    }

    touristGrid.innerHTML = filtered.map(p => {
        const cat = categoryConfig[p.category] || categoryConfig.outdoor;
        const reason = condition.reason(p.category);
        const distStr = p.distance < 1
            ? `${Math.round(p.distance * 1000)}m`
            : `${p.distance.toFixed(1)} km`;

        const typePretty = p.type.replace(/_/g, ' ');

        return `
            <div class="place-card">
                <div class="place-icon-wrap ${cat.class}">
                    ${cat.icon}
                </div>
                <div class="place-info">
                    <div class="place-name" title="${p.name}">${p.name}</div>
                    <div class="place-meta">
                        <span class="material-symbols-rounded">directions_car</span>
                        <span>~${p.travelMin} min</span>
                        <span>·</span>
                        <span>${distStr}</span>
                        <span>·</span>
                        <span style="text-transform:capitalize">${typePretty}</span>
                    </div>
                    <span class="place-reason">${reason}</span>
                </div>
            </div>`;
    }).join('');

    showTouristState('results');
}

/* =============================================
   STATE MANAGEMENT (Tourist panel)
   ============================================= */
function showTouristState(state) {
    touristLoading.classList.add('hidden');
    touristError.classList.add('hidden');
    touristResults.classList.add('hidden');
    touristEmpty.classList.add('hidden');

    switch (state) {
        case 'loading':  touristLoading.classList.remove('hidden');  break;
        case 'error':    touristError.classList.remove('hidden');    break;
        case 'results':  touristResults.classList.remove('hidden');  break;
        case 'empty':    touristEmpty.classList.remove('hidden');    break;
    }
}

/* =============================================
   MAIN TOURIST FLOW
   ============================================= */
async function activateTouristMode() {
    touristPanel.classList.remove('hidden');
    showTouristState('loading');

    // Step 1: Get coordinates
    try {
        const wd = window.currentWeatherData;
        if (wd && wd.coord) {
            touristCoords = { lat: wd.coord.lat, lon: wd.coord.lon };
        } else {
            // Fallback to geolocation
            const pos = await new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error('Geolocation not supported'));
                    return;
                }
                navigator.geolocation.getCurrentPosition(resolve, reject);
            });
            touristCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        }
    } catch (err) {
        touristErrorMsg.textContent = 'Location access needed for tourist mode';
        showTouristState('error');
        return;
    }

    // Step 2: Determine weather condition
    let weatherCondition;
    if (window.currentWeatherData) {
        weatherCondition = getWeatherCondition(window.currentWeatherData);
    } else {
        try {
            const api = window.WEATHER_API || {};
            const resp = await fetch(
                `${api.BASE_URL}/weather?lat=${touristCoords.lat}&lon=${touristCoords.lon}&units=metric&appid=${api.API_KEY}`
            );
            if (resp.ok) {
                const wd2 = await resp.json();
                window.currentWeatherData = wd2;
                weatherCondition = getWeatherCondition(wd2);
            } else {
                weatherCondition = getWeatherCondition(null);
            }
        } catch {
            weatherCondition = getWeatherCondition(null);
        }
    }

    // Update chip
    chipIcon.textContent = weatherCondition.chipIcon || '☁️';
    chipText.textContent = weatherCondition.chipText || 'Checking conditions…';

    // Step 3: Fetch nearby places
    try {
        const places = await fetchNearbyPlaces(touristCoords.lat, touristCoords.lon);
        renderTouristPlaces(places, weatherCondition);
    } catch (err) {
        console.warn('Tourist places fetch error:', err);
        touristErrorMsg.textContent = 'Could not load nearby places. Try again!';
        showTouristState('error');
    }
}

function deactivateTouristMode() {
    touristPanel.classList.add('hidden');
}

/* =============================================
   EVENT LISTENERS
   ============================================= */

// Toggle button
touristToggle.addEventListener('click', () => {
    touristActive = !touristActive;
    touristToggle.classList.toggle('active', touristActive);

    if (touristActive) {
        activateTouristMode();
    } else {
        deactivateTouristMode();
    }
});

// Retry
touristRetry.addEventListener('click', () => {
    activateTouristMode();
});

// Re-run tourist mode when weather changes (if active)
window.addEventListener('weather-updated', () => {
    if (touristActive) {
        activateTouristMode();
    }
});
