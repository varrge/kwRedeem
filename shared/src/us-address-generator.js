export const US_ADDRESS_MAX_COUNT = 5;
export const US_ADDRESS_DEFAULT_ATTEMPTS = 8;
export const US_ADDRESS_NOMINATIM_DELAY_MS = 1100;
export const US_ADDRESS_NOMINATIM_TIMEOUT_MS = 8000;
export const US_ADDRESS_RANDOMUSER_TIMEOUT_MS = 5000;

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const RANDOMUSER_URL = "https://randomuser.me/api/";

const US_STATES = Object.freeze([
  { full: "Alabama", abbr: "AL" },
  { full: "Alaska", abbr: "AK" },
  { full: "Arizona", abbr: "AZ" },
  { full: "Arkansas", abbr: "AR" },
  { full: "California", abbr: "CA" },
  { full: "Colorado", abbr: "CO" },
  { full: "Connecticut", abbr: "CT" },
  { full: "Delaware", abbr: "DE" },
  { full: "Florida", abbr: "FL" },
  { full: "Georgia", abbr: "GA" },
  { full: "Hawaii", abbr: "HI" },
  { full: "Idaho", abbr: "ID" },
  { full: "Illinois", abbr: "IL" },
  { full: "Indiana", abbr: "IN" },
  { full: "Iowa", abbr: "IA" },
  { full: "Kansas", abbr: "KS" },
  { full: "Kentucky", abbr: "KY" },
  { full: "Louisiana", abbr: "LA" },
  { full: "Maine", abbr: "ME" },
  { full: "Maryland", abbr: "MD" },
  { full: "Massachusetts", abbr: "MA" },
  { full: "Michigan", abbr: "MI" },
  { full: "Minnesota", abbr: "MN" },
  { full: "Mississippi", abbr: "MS" },
  { full: "Missouri", abbr: "MO" },
  { full: "Montana", abbr: "MT" },
  { full: "Nebraska", abbr: "NE" },
  { full: "Nevada", abbr: "NV" },
  { full: "New Hampshire", abbr: "NH" },
  { full: "New Jersey", abbr: "NJ" },
  { full: "New Mexico", abbr: "NM" },
  { full: "New York", abbr: "NY" },
  { full: "North Carolina", abbr: "NC" },
  { full: "North Dakota", abbr: "ND" },
  { full: "Ohio", abbr: "OH" },
  { full: "Oklahoma", abbr: "OK" },
  { full: "Oregon", abbr: "OR" },
  { full: "Pennsylvania", abbr: "PA" },
  { full: "Rhode Island", abbr: "RI" },
  { full: "South Carolina", abbr: "SC" },
  { full: "South Dakota", abbr: "SD" },
  { full: "Tennessee", abbr: "TN" },
  { full: "Texas", abbr: "TX" },
  { full: "Utah", abbr: "UT" },
  { full: "Vermont", abbr: "VT" },
  { full: "Virginia", abbr: "VA" },
  { full: "Washington", abbr: "WA" },
  { full: "West Virginia", abbr: "WV" },
  { full: "Wisconsin", abbr: "WI" },
  { full: "Wyoming", abbr: "WY" }
]);

const STATE_BY_ABBR = new Map(US_STATES.map((state) => [state.abbr, state]));
const STATE_BY_NAME = new Map(US_STATES.map((state) => [state.full.toLowerCase(), state]));

const STATE_COORDINATES = Object.freeze({
  AL: [{ lat: 32.377716, lng: -86.300568 }, { lat: 33.520661, lng: -86.80249 }],
  AK: [{ lat: 61.216583, lng: -149.899597 }, { lat: 58.301598, lng: -134.419998 }],
  AZ: [{ lat: 33.448376, lng: -112.074036 }, { lat: 34.048927, lng: -111.093735 }],
  AR: [{ lat: 34.746483, lng: -92.289597 }, { lat: 36.082157, lng: -94.171852 }],
  CA: [{ lat: 34.052235, lng: -118.243683 }, { lat: 37.774929, lng: -122.419418 }],
  CO: [{ lat: 39.739235, lng: -104.99025 }, { lat: 38.833881, lng: -104.821365 }],
  CT: [{ lat: 41.76371, lng: -72.685097 }, { lat: 41.308273, lng: -72.927887 }],
  DE: [{ lat: 39.739072, lng: -75.539787 }, { lat: 38.774055, lng: -75.139351 }],
  FL: [{ lat: 30.332184, lng: -81.655647 }, { lat: 25.761681, lng: -80.191788 }],
  GA: [{ lat: 33.749001, lng: -84.387985 }, { lat: 32.083541, lng: -81.099831 }],
  HI: [{ lat: 21.306944, lng: -157.858337 }, { lat: 19.896767, lng: -155.582779 }],
  ID: [{ lat: 43.615021, lng: -116.202316 }, { lat: 47.677683, lng: -116.780466 }],
  IL: [{ lat: 41.878113, lng: -87.629799 }, { lat: 40.633125, lng: -89.398529 }],
  IN: [{ lat: 39.768402, lng: -86.158066 }, { lat: 41.593369, lng: -87.346427 }],
  IA: [{ lat: 41.586834, lng: -93.625 }, { lat: 42.5, lng: -94.166672 }],
  KS: [{ lat: 39.099728, lng: -94.578568 }, { lat: 37.687176, lng: -97.330055 }],
  KY: [{ lat: 38.252666, lng: -85.758453 }, { lat: 37.839333, lng: -84.27002 }],
  LA: [{ lat: 30.695366, lng: -91.187393 }, { lat: 29.951065, lng: -90.071533 }],
  ME: [{ lat: 44.310623, lng: -69.77949 }, { lat: 43.661471, lng: -70.255325 }],
  MD: [{ lat: 38.978447, lng: -76.49218 }, { lat: 39.290386, lng: -76.61219 }],
  MA: [{ lat: 42.360081, lng: -71.058884 }, { lat: 42.313373, lng: -71.057083 }],
  MI: [{ lat: 42.732536, lng: -84.555534 }, { lat: 42.331429, lng: -83.045753 }],
  MN: [{ lat: 44.953703, lng: -93.089958 }, { lat: 44.977753, lng: -93.265015 }],
  MS: [{ lat: 32.298756, lng: -90.184807 }, { lat: 32.366806, lng: -88.703705 }],
  MO: [{ lat: 38.576702, lng: -92.173516 }, { lat: 38.627003, lng: -90.199402 }],
  MT: [{ lat: 46.878717, lng: -113.996586 }, { lat: 45.783287, lng: -108.50069 }],
  NE: [{ lat: 41.256538, lng: -95.934502 }, { lat: 40.813618, lng: -96.702595 }],
  NV: [{ lat: 39.163914, lng: -119.767403 }, { lat: 36.114647, lng: -115.172813 }],
  NH: [{ lat: 43.208137, lng: -71.538063 }, { lat: 42.99564, lng: -71.454789 }],
  NJ: [{ lat: 40.058323, lng: -74.405663 }, { lat: 39.364285, lng: -74.422928 }],
  NM: [{ lat: 35.084385, lng: -106.650421 }, { lat: 32.319939, lng: -106.763653 }],
  NY: [{ lat: 40.712776, lng: -74.005974 }, { lat: 43.299427, lng: -74.217933 }],
  NC: [{ lat: 35.779591, lng: -78.638176 }, { lat: 35.227085, lng: -80.843124 }],
  ND: [{ lat: 46.825905, lng: -100.778275 }, { lat: 46.877186, lng: -96.789803 }],
  OH: [{ lat: 39.961178, lng: -82.998795 }, { lat: 41.499321, lng: -81.694359 }],
  OK: [{ lat: 35.46756, lng: -97.516426 }, { lat: 36.15398, lng: -95.992775 }],
  OR: [{ lat: 44.046236, lng: -123.022029 }, { lat: 45.505917, lng: -122.675049 }],
  PA: [{ lat: 40.273191, lng: -76.886701 }, { lat: 39.952583, lng: -75.165222 }],
  RI: [{ lat: 41.824009, lng: -71.412834 }, { lat: 41.580095, lng: -71.477429 }],
  SC: [{ lat: 34.00071, lng: -81.034814 }, { lat: 32.776474, lng: -79.931051 }],
  SD: [{ lat: 44.366787, lng: -100.35376 }, { lat: 43.544595, lng: -96.731103 }],
  TN: [{ lat: 36.162663, lng: -86.781601 }, { lat: 35.149532, lng: -90.048981 }],
  TX: [{ lat: 30.267153, lng: -97.743057 }, { lat: 29.760427, lng: -95.369804 }],
  UT: [{ lat: 40.76078, lng: -111.891045 }, { lat: 37.774929, lng: -111.920414 }],
  VT: [{ lat: 44.260059, lng: -72.575386 }, { lat: 44.475883, lng: -73.212074 }],
  VA: [{ lat: 37.540726, lng: -77.43605 }, { lat: 36.852924, lng: -75.977982 }],
  WA: [{ lat: 47.606209, lng: -122.332069 }, { lat: 47.252876, lng: -122.44429 }],
  WV: [{ lat: 38.34982, lng: -81.632622 }, { lat: 39.629527, lng: -79.955896 }],
  WI: [{ lat: 43.073051, lng: -89.40123 }, { lat: 43.038902, lng: -87.906471 }],
  WY: [{ lat: 41.140259, lng: -104.820236 }, { lat: 44.276569, lng: -105.507391 }]
});

const AREA_CODES_BY_STATE = Object.freeze({
  AL: ["205", "251", "256", "334", "938"],
  AK: ["907"],
  AZ: ["480", "520", "602", "623", "928"],
  AR: ["479", "501", "870"],
  CA: ["209", "213", "310", "323", "408", "415", "510", "530", "559", "562", "619", "626", "650", "661", "707", "714", "760", "805", "818", "831", "858", "909", "916", "925", "949"],
  CO: ["303", "719", "720", "970"],
  CT: ["203", "475", "860", "959"],
  DE: ["302"],
  FL: ["239", "305", "321", "352", "386", "407", "561", "727", "754", "772", "786", "813", "850", "863", "904", "941", "954"],
  GA: ["229", "404", "470", "478", "678", "706", "762", "770", "912"],
  HI: ["808"],
  ID: ["208", "986"],
  IL: ["217", "224", "309", "312", "331", "618", "630", "708", "773", "779", "815", "847", "872"],
  IN: ["219", "260", "317", "463", "574", "765", "812", "930"],
  IA: ["319", "515", "563", "641", "712"],
  KS: ["316", "620", "785", "913"],
  KY: ["270", "364", "502", "606", "859"],
  LA: ["225", "318", "337", "504", "985"],
  ME: ["207"],
  MD: ["240", "301", "410", "443", "667"],
  MA: ["339", "351", "413", "508", "617", "774", "781", "857", "978"],
  MI: ["231", "248", "269", "313", "517", "586", "616", "734", "810", "906", "947", "989"],
  MN: ["218", "320", "507", "612", "651", "763", "952"],
  MS: ["228", "601", "662", "769"],
  MO: ["314", "417", "573", "636", "660", "816"],
  MT: ["406"],
  NE: ["308", "402", "531"],
  NV: ["702", "725", "775"],
  NH: ["603"],
  NJ: ["201", "551", "609", "732", "848", "856", "862", "908", "973"],
  NM: ["505", "575"],
  NY: ["212", "315", "332", "347", "516", "518", "585", "607", "631", "646", "680", "716", "718", "838", "845", "914", "917", "929", "934"],
  NC: ["252", "336", "704", "743", "828", "910", "919", "980", "984"],
  ND: ["701"],
  OH: ["216", "234", "330", "380", "419", "440", "513", "567", "614", "740", "937"],
  OK: ["405", "539", "580", "918"],
  OR: ["458", "503", "541", "971"],
  PA: ["215", "267", "272", "412", "484", "570", "610", "717", "724", "814", "878"],
  RI: ["401"],
  SC: ["803", "839", "843", "854", "864"],
  SD: ["605"],
  TN: ["423", "615", "629", "731", "865", "901", "931"],
  TX: ["210", "214", "254", "281", "325", "346", "409", "430", "432", "469", "512", "682", "713", "737", "806", "817", "830", "832", "903", "915", "936", "940", "956", "972", "979"],
  UT: ["385", "435", "801"],
  VT: ["802"],
  VA: ["276", "434", "540", "571", "703", "757", "804"],
  WA: ["206", "253", "360", "425", "509"],
  WV: ["304", "681"],
  WI: ["262", "414", "534", "608", "715", "920"],
  WY: ["307"]
});

const FALLBACK_FIRST_NAMES = Object.freeze([
  "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles",
  "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen",
  "Jose", "Luis", "Carlos", "Juan", "Miguel", "Maria", "Ana", "Sofia", "Isabella", "Carmen",
  "Wei", "Li", "Yuki", "Hiroshi", "Jin", "Min", "Andre", "Malik", "Aaliyah", "Latoya"
]);

const FALLBACK_LAST_NAMES = Object.freeze([
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Hernandez", "Lopez", "Gonzalez", "Perez", "Sanchez", "Ramirez", "Torres", "Wang", "Li", "Zhang",
  "Chen", "Liu", "Kim", "Park", "Lee", "Nguyen", "Washington", "Jackson", "Robinson", "Brooks"
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function choice(items, random = Math.random) {
  return items[Math.floor(random() * items.length)];
}

function randomInteger(min, max, random = Math.random) {
  return Math.floor(min + random() * (max - min + 1));
}

function normalizeStateName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeTextPart(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function getUsStates() {
  return US_STATES.map((state) => ({ ...state }));
}

export function normalizeUsState(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const abbr = text.toUpperCase();
  if (STATE_BY_ABBR.has(abbr)) return STATE_BY_ABBR.get(abbr);
  return STATE_BY_NAME.get(normalizeStateName(text)) || null;
}

export function getRandomUsState(random = Math.random) {
  return choice(US_STATES, random);
}

export function getRandomLocationInState(stateAbbr, random = Math.random) {
  const stateInfo = normalizeUsState(stateAbbr);
  if (!stateInfo) return null;

  const coordinates = STATE_COORDINATES[stateInfo.abbr];
  if (!coordinates?.length) return null;

  const base = choice(coordinates, random);
  return {
    lat: Number((base.lat + (random() - 0.5) * 0.1).toFixed(6)),
    lng: Number((base.lng + (random() - 0.5) * 0.1).toFixed(6))
  };
}

function getAddressCity(address) {
  return normalizeTextPart(
    address.city
    || address.town
    || address.village
    || address.municipality
    || address.hamlet
    || address.county
  );
}

function getAddressRoad(address) {
  return normalizeTextPart(
    address.road
    || address.pedestrian
    || address.footway
    || address.path
    || address.residential
  );
}

function getNominatimState(address) {
  const isoCode = String(address?.["ISO3166-2-lvl4"] || "").toUpperCase();
  const isoMatch = /^US-([A-Z]{2})$/.exec(isoCode);
  if (isoMatch) return normalizeUsState(isoMatch[1]);
  return normalizeUsState(address?.state_code || address?.state);
}

export function formatNominatimAddress(address, requestedState) {
  const stateInfo = normalizeUsState(requestedState);
  if (!stateInfo || !address || typeof address !== "object") return null;
  if (String(address.country_code || "").toLowerCase() !== "us") return null;

  const returnedState = getNominatimState(address);
  if (returnedState && returnedState.abbr !== stateInfo.abbr) return null;

  const houseNumber = normalizeTextPart(address.house_number);
  const road = getAddressRoad(address);
  const city = getAddressCity(address);
  const postalCode = normalizeTextPart(address.postcode);
  if (!houseNumber || !road || !city || !postalCode) return null;

  const line1 = `${houseNumber} ${road}`;
  const full = `${line1}, ${city}, ${stateInfo.abbr} ${postalCode}, United States`;
  return {
    line1,
    street: line1,
    city,
    state: stateInfo.abbr,
    stateAbbr: stateInfo.abbr,
    stateFull: stateInfo.full,
    postalCode,
    zipCode: postalCode,
    country: "United States",
    countryCode: "US",
    full,
    fullAddress: full
  };
}

export function generateUsPhoneNumber(state, options = {}) {
  const random = options.random || Math.random;
  const stateInfo = normalizeUsState(state);
  const areaCodes = AREA_CODES_BY_STATE[stateInfo?.abbr] || ["202", "212", "312", "404", "415", "503", "602", "617", "713", "818"];
  const areaCode = choice(areaCodes, random);
  const exchangeCode = String(randomInteger(200, 899, random)).padStart(3, "0");
  const lineNumber = String(randomInteger(1000, 9999, random)).padStart(4, "0");
  return `(${areaCode}) ${exchangeCode}-${lineNumber}`;
}

function splitName(fullName) {
  const parts = normalizeTextPart(fullName).split(" ").filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || "";
  return { firstName, lastName, name: [firstName, lastName].filter(Boolean).join(" ") };
}

function normalizeGender(value) {
  const text = normalizeTextPart(value).toLowerCase();
  if (!text) return "Unknown";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function generateFallbackPerson(options = {}) {
  const random = options.random || Math.random;
  const firstName = choice(FALLBACK_FIRST_NAMES, random);
  const lastName = choice(FALLBACK_LAST_NAMES, random);
  return {
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
    gender: choice(["Female", "Male"], random)
  };
}

export async function fetchRandomUsPeople(count, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") return [];

  const url = new URL(RANDOMUSER_URL);
  url.searchParams.set("nat", "us");
  url.searchParams.set("results", String(count));
  url.searchParams.set("inc", "name,gender");
  url.searchParams.set("noinfo", "");

  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs || US_ADDRESS_RANDOMUSER_TIMEOUT_MS)
    });
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data?.results)) return [];

    return data.results.map((item) => {
      const firstName = normalizeTextPart(item?.name?.first);
      const lastName = normalizeTextPart(item?.name?.last);
      const name = [firstName, lastName].filter(Boolean).join(" ");
      if (!name) return null;
      return {
        ...splitName(name),
        gender: normalizeGender(item?.gender)
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export async function fetchNominatimAddress(state, options = {}) {
  const stateInfo = normalizeUsState(state);
  if (!stateInfo) throw createError("Unsupported US state", "INVALID_STATE");

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw createError("fetch is not available", "FETCH_UNAVAILABLE");
  }

  const attempts = Math.max(1, Math.min(20, Number(options.attempts || US_ADDRESS_DEFAULT_ATTEMPTS)));
  const random = options.random || Math.random;
  const errors = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const location = getRandomLocationInState(stateInfo.abbr, random);
    if (!location) throw createError("State coordinate data is missing", "STATE_COORDINATES_MISSING");

    const url = new URL(NOMINATIM_REVERSE_URL);
    url.searchParams.set("format", "json");
    url.searchParams.set("lat", String(location.lat));
    url.searchParams.set("lon", String(location.lng));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");

    try {
      const response = await fetchImpl(url, {
        headers: {
          "User-Agent": options.userAgent || "KaWang US Address API",
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(options.timeoutMs || US_ADDRESS_NOMINATIM_TIMEOUT_MS)
      });

      if (!response.ok) {
        errors.push(`Nominatim HTTP ${response.status}`);
      } else {
        const data = await response.json();
        const address = formatNominatimAddress(data?.address, stateInfo.abbr);
        if (address) {
          return {
            address,
            coordinates: location,
            provider: "openstreetmap-nominatim",
            providerMeta: {
              osmType: data?.osm_type || null,
              osmId: data?.osm_id || null,
              displayName: data?.display_name || null
            }
          };
        }
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  const details = errors.length ? `: ${errors.slice(-3).join("; ")}` : "";
  throw createError(`Unable to generate a real address for ${stateInfo.abbr}${details}`, "ADDRESS_GENERATION_FAILED");
}

function createThrottledFetch(fetchImpl, minimumDelayMs) {
  if (!minimumDelayMs || minimumDelayMs <= 0) return fetchImpl;
  let lastStartedAt = 0;

  return async (...args) => {
    const now = Date.now();
    const waitMs = lastStartedAt ? Math.max(0, minimumDelayMs - (now - lastStartedAt)) : 0;
    if (waitMs > 0) await sleep(waitMs);
    lastStartedAt = Date.now();
    return fetchImpl(...args);
  };
}

function serializePerson(person, stateInfo, options = {}) {
  if (!person) return null;
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    name: person.name,
    gender: person.gender,
    phone: generateUsPhoneNumber(stateInfo.abbr, options)
  };
}

export async function generateUsAddressRecords(options = {}) {
  const count = Math.max(1, Math.min(US_ADDRESS_MAX_COUNT, Number(options.count || 1)));
  const fixedState = options.state ? normalizeUsState(options.state) : null;
  if (options.state && !fixedState) throw createError("Unsupported US state", "INVALID_STATE");

  const random = options.random || Math.random;
  const includePerson = options.includePerson !== false;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const nominatimFetch = createThrottledFetch(fetchImpl, options.nominatimDelayMs ?? US_ADDRESS_NOMINATIM_DELAY_MS);
  const people = includePerson
    ? await fetchRandomUsPeople(count, {
      fetchImpl: options.personFetchImpl || fetchImpl,
      timeoutMs: options.personTimeoutMs
    })
    : [];

  const items = [];
  for (let index = 0; index < count; index += 1) {
    const stateInfo = fixedState || getRandomUsState(random);
    const addressResult = await fetchNominatimAddress(stateInfo.abbr, {
      attempts: options.attempts,
      fetchImpl: nominatimFetch,
      random,
      timeoutMs: options.nominatimTimeoutMs,
      userAgent: options.userAgent
    });
    const person = includePerson
      ? serializePerson(people[index] || generateFallbackPerson({ random }), stateInfo, { random })
      : null;

    items.push({
      person,
      address: {
        ...addressResult.address,
        coordinates: addressResult.coordinates,
        source: addressResult.provider,
        sourceMeta: addressResult.providerMeta,
        googleMapsUrl: `https://www.google.com/maps?q=${encodeURIComponent(addressResult.address.full)}`
      }
    });
  }

  return { items };
}
