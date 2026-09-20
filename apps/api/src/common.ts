import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { FeaturesService } from './features';
import { IS_PUBLIC_KEY, PERM_KEY, FEATURE_KEY } from './decorators';

// ---------------------------------------------------------------------------
// JWT guard (global). Honors @Public and attaches an optional user on public
// routes so a logged-in viewer can also see LOGIN-visibility content.
// ---------------------------------------------------------------------------
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    try {
      await super.canActivate(context); // populates req.user if a valid token is present
    } catch (e) {
      if (!isPublic) throw e;
    }
    const req = context.switchToHttp().getRequest();
    if (!isPublic && !req.user) throw new UnauthorizedException();
    return true;
  }

  handleRequest(_err: any, user: any) {
    return user || null; // never throw here; canActivate decides
  }
}

// ---------------------------------------------------------------------------
// Permission guard (global). No @Perm metadata => allow.
// ---------------------------------------------------------------------------
@Injectable()
export class PermissionsGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new UnauthorizedException();
    const have: string[] = user.permissions || [];
    const ok = required.every((p) => have.includes(p) || have.includes('*'));
    if (!ok) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}

// ---------------------------------------------------------------------------
// Feature guard (global). No @Feature metadata => allow. Disabled => 404.
// LOGIN visibility without a user => 401. Enforced server-side.
// ---------------------------------------------------------------------------
@Injectable()
export class FeatureGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) return true;
    const flag = await this.features.getFlag(key);
    if (!flag || !flag.enabled) throw new NotFoundException('Feature not available');
    const req = context.switchToHttp().getRequest();
    if (flag.visibility === 'LOGIN' && !req.user) throw new UnauthorizedException();
    return true;
  }
}

// ---------------------------------------------------------------------------
// Global exception filter — safe, uniform error shape (no internal leakage).
// ---------------------------------------------------------------------------
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: any = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      message = typeof body === 'string' ? body : body.message ?? message;
      error = typeof body === 'object' && body.error ? body.error : exception.name;
    }
    res.status(status).json({ statusCode: status, error, message });
  }
}
