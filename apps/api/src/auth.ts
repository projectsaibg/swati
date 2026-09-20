import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { IsEmail, IsString, MinLength } from 'class-validator';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import { PrismaService } from './prisma.service';
import { CurrentUser, Public } from './decorators';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
const REFRESH_COOKIE = 'refresh_token';

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------
class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) password!: string;
}

// ---------------------------------------------------------------------------
// JWT strategy — validates the access token and loads the user (+ permissions).
// ---------------------------------------------------------------------------
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: ACCESS_SECRET,
    });
  }

  async validate(payload: { sub: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      roleName: user.role.name,
      rank: user.role.rank,
      permissions: (user.role.permissions as string[]) ?? [],
    };
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { role: true } });
    if (!user || user.status !== 'ACTIVE') return null;
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) return null;
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    return user;
  }

  async issueTokens(userId: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { secret: ACCESS_SECRET, expiresIn: '15m' },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, typ: 'refresh' },
      { secret: REFRESH_SECRET, expiresIn: '7d' },
    );
    return { accessToken, refreshToken };
  }

  async refresh(token: string) {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: REFRESH_SECRET });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    return this.issueTokens(user.id);
  }
}

function sanitize(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role ? { name: user.role.name, rank: user.role.rank } : undefined,
    permissions: (user.role?.permissions as string[]) ?? undefined,
  };
}

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateUser(dto.email, dto.password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const { accessToken, refreshToken } = await this.auth.issueTokens(user.id);
    setRefreshCookie(res, refreshToken);
    return { accessToken, user: sanitize(user) };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as any).cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('No refresh token');
    const { accessToken, refreshToken } = await this.auth.refresh(token);
    setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: any) {
    return user;
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
@Module({
  imports: [PassportModule, JwtModule.register({})],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
