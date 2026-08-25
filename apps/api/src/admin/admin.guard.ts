import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { SessionGuard, type AuthedRequest } from '../auth/auth.guard.js';

/**
 * Gates the data-quality tools.
 *
 * Extends SessionGuard rather than sitting beside it so that a controller
 * cannot accidentally apply the admin check without also resolving a session -
 * which would leave `request.user` undefined and the check trivially passable.
 */
@Injectable()
export class AdminGuard extends SessionGuard implements CanActivate {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (!request.user?.isAdmin) {
      // Deliberately vague: a non-admin should not learn that an admin surface
      // exists here.
      throw new ForbiddenException('Not found.');
    }
    return true;
  }
}
