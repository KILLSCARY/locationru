import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RouteRequestDto } from './route-request.dto.js';

async function validateDto(payload: unknown) {
  const dto = plainToInstance(RouteRequestDto, payload);
  return validate(dto);
}

describe('RouteRequestDto coordinate validation', () => {
  it('accepts valid origin and destination coordinates', async () => {
    const errors = await validateDto({
      origin: { latitude: 59.9326, longitude: 30.3506 },
      destination: { latitude: 59.8003, longitude: 30.2625 },
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects an out-of-range latitude', async () => {
    const errors = await validateDto({
      origin: { latitude: 91, longitude: 30.3506 },
      destination: { latitude: 59.8003, longitude: 30.2625 },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an out-of-range longitude', async () => {
    const errors = await validateDto({
      origin: { latitude: 59.9326, longitude: 200 },
      destination: { latitude: 59.8003, longitude: 30.2625 },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects more than 10 waypoints', async () => {
    const errors = await validateDto({
      origin: { latitude: 59.9326, longitude: 30.3506 },
      destination: { latitude: 59.8003, longitude: 30.2625 },
      waypoints: Array.from({ length: 11 }, (_, index) => ({
        latitude: 59.9,
        longitude: 30.3,
        sequence: index,
      })),
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an invalid transport mode', async () => {
    const errors = await validateDto({
      origin: { latitude: 59.9326, longitude: 30.3506 },
      destination: { latitude: 59.8003, longitude: 30.2625 },
      transportMode: 'flying',
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
