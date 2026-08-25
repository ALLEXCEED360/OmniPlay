import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@omniplay/database';
import { AuthService, SESSION_COOKIE } from './auth.service.js';

/** Request augmented with the resolved session user. */
export interface AuthedRequest extends Request {
  user?: User;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = request.cookies?.[SESSION_COOKIE];

    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Not signed in.');
    }

    const user = await this.auth.resolveSession(token);
    if (!user) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    request.user = user;
    return true;
  }
}

/** Injects the authenticated user into a handler parameter. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthedRequest>();
  if (!request.user) {
    // Reaching here means a handler used @CurrentUser without @UseGuards.
    throw new UnauthorizedException('Not signed in.');
  }
  return request.user;
});
