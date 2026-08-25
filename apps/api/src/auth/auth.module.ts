import { Global, Module } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { SessionGuard } from './auth.guard.js';

/**
 * Global, because SessionGuard is applied by controllers in every feature
 * module. Nest instantiates a guard in the context of the module that uses it,
 * so without this each module would have to import AuthModule just to satisfy
 * the guard's own dependency on AuthService.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
