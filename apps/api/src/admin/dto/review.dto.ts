import { IsIn } from 'class-validator';

export class ReviewDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';
}
