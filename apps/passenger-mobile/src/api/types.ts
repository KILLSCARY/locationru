export type TokenPair = { accessToken: string; refreshToken: string };

export type TripStatus =
  | 'DRAFT'
  | 'SEARCHING'
  | 'OFFERS_RECEIVED'
  | 'DRIVER_SELECTED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_RESERVED'
  | 'DRIVER_EN_ROUTE'
  | 'DRIVER_ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SETTLED'
  | 'CANCELLED_BY_PASSENGER'
  | 'CANCELLED_BY_DRIVER'
  | 'CANCELLED_BY_SYSTEM'
  | 'PAYMENT_FAILED'
  | 'DISPUTED'
  | 'REFUNDED';

export type Trip = {
  id: string;
  status: TripStatus;
  version: number;
  pickupAddress: string;
  destinationAddress: string;
  passengerPriceKopecks: number;
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
