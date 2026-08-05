import { IsBoolean, IsOptional } from 'class-validator';

/** Absent (older client build) is treated as granted — only an explicit `false` blocks eligibility, see DriverEligibilityService. */
export class GoOnlineDto {
  @IsOptional()
  @IsBoolean()
  locationPermissionGranted?: boolean;
}
