import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma.service';
import { AuthModule } from './auth';
import { FeaturesModule } from './features';
import { AdminModule } from './admin';
import { DevicesModule } from './devices';
import { DashboardModule } from './dashboard';
import { FeatureGuard, HttpExceptionFilter, JwtAuthGuard, PermissionsGuard } from './common';
import { Public } from './decorators';

@Controller()
export class HealthController {
  @Public()
  @Get(['health', 'healthz', 'ready'])
  health() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    FeaturesModule,
    AdminModule,
    DevicesModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    // order matters: throttle -> auth -> permissions -> feature
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
