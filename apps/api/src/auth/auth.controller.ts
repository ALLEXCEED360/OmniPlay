import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { User } from '@omniplay/database';
import { AuthService, SESSION_COOKIE } from './auth.service.js';
import { GoogleAuthService } from './google.service.js';
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

const forgotSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
});

const resetSchema = z.object({
  token: z.string().min(1),
  // The same floor register enforces. A reset is not an opportunity to set a
  // weaker password than sign-up would have accepted.
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleAuthService,
  ) {}

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

  /**
   * Always 204, whatever happens.
   *
   * Not laziness: telling the caller whether the address was found turns this
   * into an oracle for which emails hold accounts here. The person who owns
   * the inbox learns the outcome; nobody else does.
   */
  @Post('password/forgot')
  @HttpCode(204)
  async forgotPassword(@Req() req: Request, @Body() body: unknown) {
    const { email } = zodBody(forgotSchema, body);
    await this.auth.requestPasswordReset(email, contextOf(req));
  }

  /** Consumes a reset link and signs the user straight in. */
  @Post('password/reset')
  async resetPassword(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const input = zodBody(resetSchema, body);
    const { user, token, expiresAt } = await this.auth.resetPassword(
      input.token,
      input.password,
      contextOf(req),
    );
    res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions(expiresAt));
    return { user: publicUser(user) };
  }

  /**
   * What sign-in methods this instance actually offers.
   *
   * The sign-in page asks rather than assuming, so a deployment without
   * Google credentials renders no Google button instead of one that fails
   * after a round trip to Google.
   */
  @Get('methods')
  methods() {
    return {
      password: true,
      google: this.google.configured,
      // Lets the reset screen describe what will actually happen rather than
      // assuming an inbox is involved.
      emailDelivery: this.auth.emailDelivery,
    };
  }

  @Get('google')
  async googleStart(@Res() res: Response, @Query('returnTo') returnTo?: string) {
    return res.redirect(await this.google.beginSignIn(returnTo));
  }

  /**
   * Google sends the browser here, so failures must render as a page the
   * person can act on rather than as JSON.
   */
  @Get('google/callback')
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ) {
    const web = this.auth.webUrl();
    try {
      const { user, returnTo } = await this.google.completeSignIn(query);
      const { token, expiresAt } = await this.auth.startSessionFor(user.id, contextOf(req));
      res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions(expiresAt));
      return res.redirect(returnTo ?? `${web}/dashboard`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google sign-in failed.';
      return res.redirect(`${web}/login?error=${encodeURIComponent(message)}`);
    }
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
