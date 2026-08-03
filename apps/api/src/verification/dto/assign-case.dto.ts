import { IsOptional, IsUUID } from 'class-validator';

export class AssignCaseDto {
  /** Omit to self-assign the acting admin. */
  @IsOptional()
  @IsUUID()
  assigneeAdminId?: string;
}
