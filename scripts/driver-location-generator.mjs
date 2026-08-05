const apiUrl = requiredEnvironment('API_URL').replace(/\/$/, '');
const driverPhone = requiredEnvironment('SEED_DRIVER_PHONE');
const otpCode = requiredEnvironment('AUTH_DEVELOPMENT_OTP_CODE');
const latitude = numericEnvironment('DEV_DRIVER_LATITUDE', -90, 90);
const longitude = numericEnvironment('DEV_DRIVER_LONGITUDE', -180, 180);
const intervalMs = numericEnvironment(
  'DEV_DRIVER_LOCATION_INTERVAL_MS',
  1_000,
  60_000,
);

if (!/^\d{6}$/.test(otpCode)) {
  throw new Error('AUTH_DEVELOPMENT_OTP_CODE must contain exactly six digits');
}

let stopped = false;
let accessToken = '';
let sequence = 0;

process.once('SIGINT', () => {
  stopped = true;
});
process.once('SIGTERM', () => {
  stopped = true;
});

await waitForApi();
accessToken = await authenticate();
await post('/drivers/me/online', {}, accessToken);
console.log(
  JSON.stringify({ event: 'development.driver_location_generator.started' }),
);

while (!stopped) {
  try {
    const angle = sequence / 8;
    await post(
      '/drivers/me/location',
      {
        recordedAt: new Date().toISOString(),
        latitude: latitude + Math.sin(angle) * 0.0001,
        longitude: longitude + Math.cos(angle) * 0.0001,
        accuracyMeters: 8,
        speedMetersPerSecond: 1.5,
        bearingDegrees: (angle * 57.2958) % 360,
        altitudeMeters: 156,
        provider: 'development-generator',
        confidence: 'HIGH',
        suspectedSpoofing: false,
        satellitesVisible: 12,
        cellCount: 4,
      },
      accessToken,
    );
    sequence += 1;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      accessToken = await authenticate();
      await post('/drivers/me/online', {}, accessToken);
    } else {
      console.error(
        JSON.stringify({
          event: 'development.driver_location_generator.failed',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  await delay(intervalMs);
}

async function waitForApi() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      await get('/health');
      return;
    } catch {
      await delay(1_000);
    }
  }

  throw new Error('API did not become healthy within 60 seconds');
}

async function authenticate() {
  await post('/auth/request-code', { phone: driverPhone });
  const tokens = await post('/auth/verify-code', {
    phone: driverPhone,
    code: otpCode,
    deviceId: 'development-location-generator',
    platform: 'WEB',
  });

  if (!tokens || typeof tokens.accessToken !== 'string') {
    throw new Error(
      'Development driver authentication returned no access token',
    );
  }

  return tokens.accessToken;
}

async function get(path) {
  return request(path, { method: 'GET' });
}

async function post(path, body, token) {
  return request(path, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
}

async function request(path, options) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new HttpError(response.status, payload);
  }

  return payload;
}

class HttpError extends Error {
  constructor(status, payload) {
    super(`HTTP ${status}: ${JSON.stringify(payload)}`);
    this.status = status;
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numericEnvironment(name, minimum, maximum) {
  const value = Number(requiredEnvironment(name));
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
