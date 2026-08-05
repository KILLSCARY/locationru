export type TokenPair = { accessToken: string; refreshToken: string };

import type { TripStatus } from '@resilient-taxi/contracts';

export type { TripStatus };

export type Trip = {
  id: string;
  status: TripStatus;
  version: number;
  pickup: {
    formattedAddress: string;
    latitude: number;
    longitude: number;
    providerPlaceId: string | null;
  };
  destination: {
    formattedAddress: string;
    latitude: number;
    longitude: number;
    providerPlaceId: string | null;
  };
  passengerPriceKopecks: number;
  estimatedDistanceMeters: number;
  estimatedDurationSeconds: number;
};

export type DriverBid = {
  id: string;
  tripId: string;
  offeredPriceKopecks: number;
  estimatedPickupSeconds: number;
  distanceToPickupMeters: number;
  expiresAt: string;
  driver: { firstName: string; lastName: string; rating: number };
  vehicle: {
    brand: string;
    model: string;
    color: string;
    registrationNumber: string;
  };
};
