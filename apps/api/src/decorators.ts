import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

// Kept separate from common.ts (guards) to avoid a circular import:
// features controllers import these decorators; guards import FeaturesService.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERM_KEY = 'perms';
export const Perm = (...perms: string[]) => SetMetadata(PERM_KEY, perms);

export const FEATURE_KEY = 'feature';
export const Feature = (key: string) => SetMetadata(FEATURE_KEY, key);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);
