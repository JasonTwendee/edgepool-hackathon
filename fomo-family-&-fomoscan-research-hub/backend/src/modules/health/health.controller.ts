import { Controller, Get, Inject } from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller('api/health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  getHealth() {
    return this.health.check();
  }
}
