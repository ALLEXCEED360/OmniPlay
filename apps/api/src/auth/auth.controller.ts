import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { User } from '@omniplay/database';
import { AuthService, SESSION_COOKIE } from './auth.service.js';
import { CurrentUser, SessionGuard } from './auth.guard.js';
import { zodBody } from '../common/validation.js';

const registerSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters.')
    .max(30, 'Username must be 30 characters or fewer.'),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Enter your password.'),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = zodBody(registerSchema, body);
    const { user, token, expiresAt } = await this.auth.register(input, contextOf(req));

    res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions(expiresAt));
    return { user: publicUser(user) };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const input = zodBody(loginSchema, body);
    const { user, token, expiresAt } = await this.auth.login(input, contextOf(req));

    res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions(expiresAt));
    return { user: publicUser(user) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string') await this.auth.logout(token);
    res.clearCookie(SESSION_COOKIE, this.auth.cookieOptions());
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: User) {
    return { user: publicUser(user) };
  }
}

/** Everything about a user that is safe to send to the browser. */
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    bio: user.bio,
    profilePublic: user.profilePublic,
    // Drives whether the admin nav entry renders. The API still enforces
    // access on every admin route; this only avoids showing a dead link.
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
  };
}

function contextOf(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}
