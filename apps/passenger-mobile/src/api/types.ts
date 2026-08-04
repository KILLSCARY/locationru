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

export type TripPlace = {
  address: string;
  latitude: number;
  longitude: number;
};

// Task 29 section 22 allow-list — the only driver/vehicle fields a passenger
// may ever see. Never add documents, passport data, unmasked VIN/plate,
// insurance, review history, or address here.
export type PassengerVisibleDriver = {
  firstName: string;
  lastName: string;
  rating: number;
  completedTripsCount: number;
  verified: boolean;
  photoUrl: string | null;
  vehicle: {
    brand: string;
    model: string;
    color: string;
    registrationNumberMasked: string;
  };
};

// Matches TripController.getById's PassengerTripDetails response.
export type Trip = {
  id: string;
  status: TripStatus;
  version: number;
  pickup: TripPlace;
  destination: TripPlace;
  passengerPriceKopecks: number;
  finalPriceKopecks: number | null;
  selectedDriverId: string | null;
  selectedVehicleId: string | null;
  assignedDriver: PassengerVisibleDriver | null;
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
