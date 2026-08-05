/**
 * Fixed phone numbers for the staging seed's accounts (prisma/seed-staging.ts)
 * — shared with StagingToolsService so "clear only test data" can scope
 * itself to exactly the trips these accounts created, instead of touching
 * unrelated data.
 */
export const STAGING_SUPER_ADMIN_PHONE = '+79995551000';
export const STAGING_TEST_PASSENGER_PHONE = '+79995551001';
export const STAGING_TEST_DRIVER_PHONE = '+79995551002';
export const STAGING_TEST_VEHICLE_REGISTRATION_NUMBER = 'A001AA777';
