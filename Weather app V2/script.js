/* =============================================
   VIBE CHECK WEATHER — ENGINE
   Core logic preserved · Adapted for minimal UI
   ============================================= */

/* ---- Config ---- */
const API_KEY = 'ac36308770a40f08dfdbea3911fca151';
const BASE_URL = 'https://api.openweathermap.org/data/2.5';
const GEO_URL = 'https://api.openweathermap.org/geo/1.0';

/* ---- Helper ---- */
const $ = (id) => document.getElementById(id);

/* ---- DOM References ---- */
const cityInput = $('city-input');
const searchBtn = $('search-btn');
const locationBtn = $('location-btn');
const initialState = $('initial-state');
const loadingState = $('loading-state');
const errorState = $('error-state');
const weatherContent = $('weather-content');
const errorMessage = $('error-message');
const particles = $('particles');
const suggestions = $('suggestions');
const retryBtn = $('retry-btn');
const unitToggle = $('unit-toggle');
const unitLabel = $('unit-label');
const themeToggle = $('theme-toggle');
const themeIcon = $('theme-icon');
const degreeUnit = $('degree-unit');

const weatherIconEl = $('weather-icon');
const temperatureEl = $('temperature');
const descriptionEl = $('description');
const cityNameEl = $('city-name');
const dateTimeEl = $('date-time');
const windEl = $('wind');
const humidityEl = $('humidity');
const visibilityEl = $('visibility');
const feelsLikeEl = $('feels-like');
const pressureEl = $('pressure');
const cloudsEl = $('clouds');
const sunriseEl = $('sunrise');
const sunsetEl = $('sunset');
const tempHighEl = $('temp-high');
const tempLowEl = $('temp-low');
const hourlyForecast = $('hourly-forecast');
const dailyForecast = $('daily-forecast');
const sunArcFill = $('sun-arc-fill');
const sunArcDot = $('sun-arc-dot');
const iconGlow = $('icon-glow');

/* ---- App State ---- */
let unit = localStorage.getItem('vibe-unit') || 'metric';   // metric | imperial
let theme = localStorage.getItem('vibe-theme') || 'light';  // light | dark  (light-first)
let lastCity = localStorage.getItem('vibe-last-city') || '';
let currentWeatherData = null;
let currentForecastData = null;
let searchTimeout = null;
let activeSuggestion = -1;

/* ---- Weather Emoji Map ---- */
const weatherIcons = {
    '01d': '☀️', '01n': '🌙',
    '02d': '⛅', '02n': '☁️',
    '03d': '☁️', '03n': '☁️',
    '04d': '☁️', '04n': '☁️',
    '09d': '🌧️', '09n': '🌧️',
    '10d': '🌦️', '10n': '🌧️',
    '11d': '⛈️', '11n': '⛈️',
    '13d': '❄️', '13n': '❄️'
};
// Removed explicit fog emoji (🌫️) so haze now falls back to cloudy/sunny states with animation.

/* =============================================
   INIT
   ============================================= */
function init() {
    applyUnit();
    applyTheme();

    // Auto-load last searched city
    if (lastCity) {
        fetchWeather(lastCity);
    }
}

/* =============================================
   STATE MANAGEMENT
   ============================================= */
function showState(state) {
    [initialState, loadingState, errorState, weatherContent]
        .forEach(el => el.classList.add('hidden'));

    switch (state) {
        case 'initial': initialState.classList.remove('hidden'); break;
        case 'loading': loadingState.classList.remove('hidden'); break;
        case 'error': errorState.classList.remove('hidden'); break;
        case 'weather': weatherContent.classList.remove('hidden'); break;
    }
}

/* =============================================
   UNIT TOGGLE
   ============================================= */
function applyUnit() {
    const label = unit === 'metric' ? '°C' : '°F';
    unitLabel.textContent = label;
    degreeUnit.textContent = label;
}

function toggleUnit() {
    unit = unit === 'metric' ? 'imperial' : 'metric';
    localStorage.setItem('vibe-unit', unit);
    applyUnit();
    if (currentWeatherData) {
        displayWeather(currentWeatherData, currentForecastData);
    }
}

/* =============================================
   THEME TOGGLE  (light-first; dark class added)
   ============================================= */
function applyTheme() {
    if (theme === 'dark') {
        document.body.classList.add('dark');
        themeIcon.textContent = 'light_mode';
    } else {
        document.body.classList.remove('dark');
        themeIcon.textContent = 'dark_mode';
    }
}

function toggleTheme() {
    theme = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('vibe-theme', theme);
    applyTheme();
}

/* =============================================
   SEARCH SUGGESTIONS (Geocoding API)
   ============================================= */
async function fetchSuggestions(query) {
    if (query.length < 2) { hideSuggestions(); return; }

    try {
        const resp = await fetch(
            `${GEO_URL}/direct?q=${encodeURIComponent(query)}&limit=5&appid=${API_KEY}`
        );
        if (!resp.ok) return;
        const cities = await resp.json();

        if (!cities.length) { hideSuggestions(); return; }

        suggestions.innerHTML = cities.map((c, i) => {
            const state = c.state ? `, ${c.state}` : '';
            return `
                <div class="suggestion-item" role="option"
                     data-name="${c.name}" data-lat="${c.lat}"
                     data-lon="${c.lon}" data-index="${i}">
                    <span class="material-symbols-rounded">location_on</span>
                    <span>${c.name}${state}</span>
                    <span class="suggestion-country">${c.country}</span>
                </div>`;
        }).join('');

        suggestions.classList.remove('hidden');
        activeSuggestion = -1;

        suggestions.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                cityInput.value = item.dataset.name;
                hideSuggestions();
                fetchWeatherByCoords(item.dataset.lat, item.dataset.lon);
            });
        });
    } catch (_) { /* fail silently */ }
}

function hideSuggestions() {
    suggestions.classList.add('hidden');
    suggestions.innerHTML = '';
    activeSuggestion = -1;
}

function navigateSuggestions(dir) {
    const items = suggestions.querySelectorAll('.suggestion-item');
    if (!items.length) return;

    items.forEach(i => i.classList.remove('active'));
    activeSuggestion += dir;
    if (activeSuggestion < 0) activeSuggestion = items.length - 1;
    if (activeSuggestion >= items.length) activeSuggestion = 0;
    items[activeSuggestion].classList.add('active');
    cityInput.value = items[activeSuggestion].dataset.name;
}

/* =============================================
   FORMATTERS
   ============================================= */
function formatTime(timestamp, timezone) {
    const d = new Date((timestamp + timezone) * 1000);
    return d.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC'
    });
}

function formatDate(timezone) {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const local = new Date(utc + timezone * 1000);
    return local.toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    });
}

function tempConvert(c) {
    return unit === 'imperial' ? Math.round(c * 9 / 5 + 32) : Math.round(c);
}

function windConvert(mps) {
    return unit === 'imperial'
        ? `${Math.round(mps * 2.237)} mph`
        : `${Math.round(mps * 3.6)} km/h`;
}

function getDayName(ts) {
    return new Date(ts * 1000).toLocaleDateString('en-US', { weekday: 'short' });
}

/* =============================================
   WEATHER THEMES & PARTICLES
   (Kept subtle for minimalist look)
   ============================================= */
function setWeatherTheme(code, isNight, tempC) {
    document.body.classList.remove('sunny', 'cloudy', 'rainy', 'snowy', 'stormy', 'night');
    clearParticles();

    if (isNight) {
        document.body.classList.add('night');
        createStars();
        return;
    }

    const c = code.toString();
    let theme = 'cloudy';

    if (c.startsWith('2') || c.startsWith('3') || c.startsWith('5')) {
        theme = 'rainy';
    } else if (c.startsWith('6')) {
        theme = 'snowy';
    } else if (c === '800') {
        theme = 'sunny';
    }

    // Temperature-based override (per request: sun / rain / storm by temperature)
    if (typeof tempC === 'number') {
        if (tempC >= 30) {
            theme = 'sunny';
        } else if (tempC <= 10) {
            theme = 'stormy';
        } else if (tempC <= 18 && theme === 'cloudy') {
            theme = 'rainy';
        }
    }

    switch (theme) {
        case 'sunny':
            document.body.classList.add('sunny');
            createSunParticles();
            break;
        case 'rainy':
            document.body.classList.add('rainy');
            createRain();
            break;
        case 'snowy':
            document.body.classList.add('snowy');
            createSnow();
            break;
        case 'stormy':
            document.body.classList.add('stormy');
            createStorm();
            break;
        default:
            document.body.classList.add('cloudy');
            createFloatingParticles();
    }
}

function clearParticles() { particles.innerHTML = ''; }

function createFloatingParticles() {
    for (let i = 0; i < 10; i++) {
        const p = document.createElement('div');
        p.className = 'particle glow';
        const s = 60 + Math.random() * 80;
        Object.assign(p.style, {
            width: s + 'px', height: s + 'px',
            left: Math.random() * 100 + '%', top: Math.random() * 100 + '%',
            animationDelay: Math.random() * 8 + 's',
            animationDuration: 18 + Math.random() * 10 + 's'
        });
        particles.appendChild(p);
    }
}

function createRain() {
    for (let i = 0; i < 50; i++) {
        const d = document.createElement('div');
        d.className = 'rain-drop';
        Object.assign(d.style, {
            left: Math.random() * 100 + '%',
            animationDelay: Math.random() * 2 + 's',
            animationDuration: .5 + Math.random() * .4 + 's'
        });
        particles.appendChild(d);
    }
}

function createSnow() {
    for (let i = 0; i < 30; i++) {
        const f = document.createElement('div');
        f.className = 'snowflake';
        const s = 3 + Math.random() * 5;
        Object.assign(f.style, {
            left: Math.random() * 100 + '%',
            width: s + 'px', height: s + 'px',
            animationDelay: Math.random() * 4 + 's',
            animationDuration: 4 + Math.random() * 3 + 's'
        });
        particles.appendChild(f);
    }
}

function createSunParticles() {
    for (let i = 0; i < 8; i++) {
        const p = document.createElement('div');
        p.className = 'particle glow';
        const s = 80 + Math.random() * 120;
        Object.assign(p.style, {
            background: 'radial-gradient(circle, rgba(245,158,11,0.08), transparent 70%)',
            width: s + 'px', height: s + 'px',
            left: Math.random() * 100 + '%', top: Math.random() * 100 + '%',
            animationDelay: Math.random() * 8 + 's'
        });
        particles.appendChild(p);
    }
}

function createStorm() {
    createRain();
    for (let i = 0; i < 4; i++) {
        const flash = document.createElement('div');
        flash.className = 'storm-flash';
        Object.assign(flash.style, {
            animationDelay: `${Math.random() * 2}s`
        });
        particles.appendChild(flash);
    }
}

function createStars() {
    for (let i = 0; i < 30; i++) {
        const s = document.createElement('div');
        s.className = 'particle';
        const sz = 1 + Math.random() * 2;
        Object.assign(s.style, {
            background: 'var(--text-3)',
            width: sz + 'px', height: sz + 'px',
            left: Math.random() * 100 + '%', top: Math.random() * 100 + '%',
            animation: 'twinkle 2.5s ease-in-out infinite',
            animationDelay: Math.random() * 2 + 's'
        });
        particles.appendChild(s);
    }

    if (!document.getElementById('twinkle-style')) {
        const st = document.createElement('style');
        st.id = 'twinkle-style';
        st.textContent = `
            @keyframes twinkle {
                0%,100% { opacity:.2; transform:scale(1); }
                50%     { opacity:.8; transform:scale(1.3); }
            }`;
        document.head.appendChild(st);
    }
}

/* =============================================
   API CALLS  (core logic kept identical)
   ============================================= */
async function fetchWeather(city) {
    showState('loading');

    try {
        const [weatherResp, forecastResp] = await Promise.all([
            fetch(`${BASE_URL}/weather?q=${encodeURIComponent(city)}&units=metric&appid=${API_KEY}`),
            fetch(`${BASE_URL}/forecast?q=${encodeURIComponent(city)}&units=metric&appid=${API_KEY}`)
        ]);

        if (!weatherResp.ok) {
            throw new Error(
                weatherResp.status === 404
                    ? 'City not found. Try another name!'
                    : 'Unable to fetch weather data'
            );
        }

        const weatherData = await weatherResp.json();
        const forecastData = forecastResp.ok ? await forecastResp.json() : null;

        currentWeatherData = weatherData;
        currentForecastData = forecastData;
        localStorage.setItem('vibe-last-city', city);

        displayWeather(weatherData, forecastData);
    } catch (err) {
        showState('error');
        errorMessage.textContent = err.message;
    }
}

async function fetchWeatherByCoords(lat, lon) {
    showState('loading');

    try {
        const [weatherResp, forecastResp] = await Promise.all([
            fetch(`${BASE_URL}/weather?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`),
            fetch(`${BASE_URL}/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`)
        ]);

        if (!weatherResp.ok) throw new Error('Unable to fetch weather data');

        const weatherData = await weatherResp.json();
        const forecastData = forecastResp.ok ? await forecastResp.json() : null;

        currentWeatherData = weatherData;
        currentForecastData = forecastData;
        localStorage.setItem('vibe-last-city', weatherData.name);

        displayWeather(weatherData, forecastData);
    } catch (err) {
        showState('error');
        errorMessage.textContent = err.message;
    }
}

/* =============================================
   DISPLAY  (core logic preserved)
   ============================================= */
function displayWeather(data, forecast) {
    const isNight = data.weather[0].icon.includes('n');
    setWeatherTheme(data.weather[0].id, isNight, data.main.temp);

    // Hero
    const iconCode = data.weather[0].icon;
    weatherIconEl.textContent = weatherIcons[iconCode] || '🌡️';
    temperatureEl.textContent = tempConvert(data.main.temp);
    descriptionEl.textContent = data.weather[0].description;

    // High / Low
    tempHighEl.textContent = `H: ${tempConvert(data.main.temp_max)}°`;
    tempLowEl.textContent = `L: ${tempConvert(data.main.temp_min)}°`;

    // Location
    cityNameEl.textContent = `${data.name}, ${data.sys.country}`;
    dateTimeEl.textContent = formatDate(data.timezone);

    // Details
    windEl.textContent = windConvert(data.wind.speed);
    humidityEl.textContent = `${data.main.humidity}%`;
    visibilityEl.textContent = `${(data.visibility / 1000).toFixed(1)} km`;
    feelsLikeEl.textContent = `${tempConvert(data.main.feels_like)}°`;
    pressureEl.textContent = `${data.main.pressure} hPa`;
    cloudsEl.textContent = `${data.clouds.all}%`;

    // Sunrise / Sunset
    sunriseEl.textContent = formatTime(data.sys.sunrise, data.timezone);
    sunsetEl.textContent = formatTime(data.sys.sunset, data.timezone);
    updateSunArc(data.sys.sunrise, data.sys.sunset, data.timezone);

    // Forecasts
    if (forecast && forecast.list) {
        displayHourlyForecast(forecast.list.slice(0, 8), data.timezone);
        displayDailyForecast(forecast.list);
    }

    showState('weather');

    // Notify tourist module of weather update
    window.dispatchEvent(new CustomEvent('weather-updated'));
}

function displayHourlyForecast(hours, timezone) {
    hourlyForecast.innerHTML = hours.map(h => {
        const icon = weatherIcons[h.weather[0].icon] || '🌡️';
        const temp = tempConvert(h.main.temp);
        const time = formatTime(h.dt, timezone);
        return `
            <div class="hour-card">
                <div class="time">${time}</div>
                <div class="icon">${icon}</div>
                <div class="temp">${temp}°</div>
            </div>`;
    }).join('');
}

function displayDailyForecast(list) {
    const days = {};
    list.forEach(item => {
        const day = getDayName(item.dt);
        if (!days[day]) {
            days[day] = { temps: [], icon: item.weather[0].icon, desc: item.weather[0].description };
        }
        days[day].temps.push(item.main.temp);
    });

    let gMin = Infinity, gMax = -Infinity;
    Object.values(days).forEach(d => {
        const lo = Math.min(...d.temps), hi = Math.max(...d.temps);
        if (lo < gMin) gMin = lo;
        if (hi > gMax) gMax = hi;
    });
    const range = gMax - gMin || 1;

    dailyForecast.innerHTML = Object.keys(days).slice(0, 5).map(name => {
        const d = days[name];
        const hi = Math.max(...d.temps);
        const lo = Math.min(...d.temps);
        const icon = weatherIcons[d.icon] || '🌡️';
        const barL = ((lo - gMin) / range) * 100;
        const barW = ((hi - lo) / range) * 100 || 8;

        return `
            <div class="day-card">
                <span class="day-name">${name}</span>
                <span class="day-icon">${icon}</span>
                <span class="day-desc">${d.desc}</span>
                <div class="day-temps">
                    <span class="day-low">${tempConvert(lo)}°</span>
                    <div class="day-temp-bar">
                        <div class="day-temp-fill" style="margin-left:${barL}%;width:${barW}%"></div>
                    </div>
                    <span class="day-high">${tempConvert(hi)}°</span>
                </div>
            </div>`;
    }).join('');
}

function updateSunArc(sunrise, sunset, timezone) {
    const now = new Date();
    const utcNow = now.getTime() / 1000 + now.getTimezoneOffset() * 60;
    const local = utcNow + timezone;
    const total = sunset - sunrise;
    if (total <= 0) return;

    const pct = Math.max(0, Math.min(100, ((local - sunrise) / total) * 100));
    requestAnimationFrame(() => {
        sunArcFill.style.width = pct + '%';
        sunArcDot.style.left = pct + '%';
    });
}

/* =============================================
   EVENT LISTENERS
   ============================================= */

// Search button
searchBtn.addEventListener('click', () => {
    const city = cityInput.value.trim();
    if (city) { fetchWeather(city); hideSuggestions(); }
});

// Keyboard on input
cityInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const city = cityInput.value.trim();
        if (city) { fetchWeather(city); hideSuggestions(); }
    } else if (e.key === 'ArrowDown') {
        e.preventDefault(); navigateSuggestions(1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault(); navigateSuggestions(-1);
    } else if (e.key === 'Escape') {
        hideSuggestions();
    }
});

// Autocomplete on typing
cityInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => fetchSuggestions(cityInput.value.trim()), 300);
});

// Close suggestions on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) hideSuggestions();
});

// Geolocation
locationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
        showState('error');
        errorMessage.textContent = 'Geolocation not supported.';
        return;
    }
    showState('loading');
    navigator.geolocation.getCurrentPosition(
        pos => fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude),
        () => {
            showState('error');
            errorMessage.textContent = 'Location access denied.';
        }
    );
});

// Retry
retryBtn.addEventListener('click', () => {
    showState('initial');
    cityInput.focus();
});

// Toggles
unitToggle.addEventListener('click', toggleUnit);
themeToggle.addEventListener('click', toggleTheme);

/* =============================================
   EXPOSE SHARED STATE (for tourist.js module)
   ============================================= */
window.currentWeatherData = null;
window.currentForecastData = null;

// Keep window refs in sync with local vars
Object.defineProperty(window, 'currentWeatherData', {
    get() { return currentWeatherData; },
    set(v) { currentWeatherData = v; },
    configurable: true
});
Object.defineProperty(window, 'currentForecastData', {
    get() { return currentForecastData; },
    set(v) { currentForecastData = v; },
    configurable: true
});

// Expose API config for tourist module
window.WEATHER_API = { BASE_URL, API_KEY };

/* =============================================
   BOOT
   ============================================= */
init();
