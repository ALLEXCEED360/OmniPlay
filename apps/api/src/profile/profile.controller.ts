import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '@omniplay/database';
import { CurrentUser, SessionGuard } from '../auth/auth.guard.js';
import { zodBody } from '../common/validation.js';
import { ProfileService } from './profile.service.js';

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  bio: z.string().trim().max(300).nullable().optional(),
  profilePublic: z.boolean().optional(),
});

@Controller()
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  /**
   * The public profile. Deliberately unguarded - this is the shareable page.
   * ProfileService enforces the opt-in and decides what is safe to include.
   */
  @Get('u/:username')
  publicProfile(@Param('username') username: string) {
    return this.profile.publicProfile(username);
  }

  @Patch('profile')
  @UseGuards(SessionGuard)
  update(@CurrentUser() user: User, @Body() body: unknown) {
    return this.profile.updateOwn(user.id, zodBody(updateSchema, body));
  }
}
