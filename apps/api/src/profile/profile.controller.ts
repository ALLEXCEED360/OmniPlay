import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { User } from '@omniplay/database';
import { CurrentUser, SessionGuard } from '../auth/auth.guard.js';
import { AuthService, SESSION_COOKIE } from '../auth/auth.service.js';
import { zodBody } from '../common/validation.js';
import { ProfileService } from './profile.service.js';

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  bio: z.string().trim().max(300).nullable().optional(),
  profilePublic: z.boolean().optional(),
});

@Controller()
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly auth: AuthService,
  ) {}

  /**
   * The public profile. Deliberately unguarded - this is the shareable page.
   * ProfileService enforces the opt-in and decides what is safe to include.
   *
   * A session, if one is sent, is resolved but never required: the owner
   * can always see their own page, public or not, so they can look at
   * what they would be sharing before they share it.
   */
  @Get('u/:username')
  async publicProfile(@Param('username') username: string, @Req() req: Request) {
    const token = req.cookies?.[SESSION_COOKIE];
    const viewer = typeof token === 'string' && token ? await this.auth.resolveSession(token) : null;
    return this.profile.publicProfile(username, viewer?.id ?? null);
  }

  @Patch('profile')
  @UseGuards(SessionGuard)
  update(@CurrentUser() user: User, @Body() body: unknown) {
    return this.profile.updateOwn(user.id, zodBody(updateSchema, body));
  }
}
