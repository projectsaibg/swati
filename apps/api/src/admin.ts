/**
 * Admin: user management + role ladder editing.
 * All routes require the matching manage permission (Administrator has '*').
 * Passwords are never returned except a generated one, shown once at creation
 * or reset. passwordHash never leaves the service.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from './prisma.service';
import { CurrentUser, Perm } from './decorators';

// ---------------------------------------------------------------------------
// Canonical permission registry — the checkbox list the role editor renders.
// Keep in sync with the @Perm(...) keys used across controllers.
// ---------------------------------------------------------------------------
export const PERMISSION_REGISTRY: Array<{ key: string; label: string }> = [
  { key: '*', label: 'Full access (superuser)' },
  { key: 'features.manage', label: 'Manage feature switches & tier' },
  { key: 'users.manage', label: 'Manage users' },
  { key: 'roles.manage', label: 'Manage roles' },
  { key: 'assets.manage', label: 'Register & edit assets / devices' },
  { key: 'data.enter', label: 'Enter data / ingest telemetry' },
  { key: 'feature.act', label: 'Take actions within modules' },
  { key: 'alert.ack', label: 'Acknowledge alerts' },
  { key: 'comms.send', label: 'Send communications' },
  { key: 'gis.import', label: 'Import GIS layers' },
  { key: 'valve.operate', label: 'Operate valves' },
];
const PERMISSION_KEYS = PERMISSION_REGISTRY.map((p) => p.key);

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------
class CreateRoleDto {
  @IsString() @MinLength(2) name!: string;
  @IsInt() @Min(0) rank!: number;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(PERMISSION_KEYS, { each: true }) permissions?: string[];
  @IsOptional() @IsString() reportsToId?: string | null;
}
class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsInt() @Min(0) rank?: number;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(PERMISSION_KEYS, { each: true }) permissions?: string[];
  @IsOptional() @IsString() reportsToId?: string | null;
}
class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(2) name!: string;
  @IsString() roleId!: string;
  @IsOptional() @IsString() managerId?: string | null;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}
class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() roleId?: string;
  @IsOptional() @IsString() managerId?: string | null;
  @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Roles ---------------------------------------------------------------
  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { rank: 'desc' },
      include: { reportsTo: { select: { name: true } }, _count: { select: { users: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      rank: r.rank,
      permissions: (r.permissions as string[]) ?? [],
      reportsToId: r.reportsToId,
      reportsToName: r.reportsTo?.name ?? null,
      userCount: r._count.users,
    }));
  }

  async createRole(dto: CreateRoleDto) {
    if (dto.reportsToId) await this.mustRole(dto.reportsToId);
    await this.prisma.role.create({
      data: {
        name: dto.name,
        rank: dto.rank,
        permissions: dto.permissions ?? [],
        reportsToId: dto.reportsToId || null,
      },
    });
    return this.listRoles();
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    await this.mustRole(id);
    if (dto.reportsToId) {
      if (dto.reportsToId === id) throw new BadRequestException('A role cannot report to itself');
      await this.mustRole(dto.reportsToId);
    }
    await this.prisma.role.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.rank !== undefined ? { rank: dto.rank } : {}),
        ...(dto.permissions !== undefined ? { permissions: dto.permissions } : {}),
        ...(dto.reportsToId !== undefined ? { reportsToId: dto.reportsToId || null } : {}),
      },
    });
    return this.listRoles();
  }

  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true, reports: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role._count.users > 0) throw new BadRequestException('Role still has users assigned');
    if (role._count.reports > 0) throw new BadRequestException('Other roles report to this role');
    await this.prisma.role.delete({ where: { id } });
    return this.listRoles();
  }

  private async mustRole(id: string) {
    const r = await this.prisma.role.findUnique({ where: { id } });
    if (!r) throw new BadRequestException('Unknown role id');
    return r;
  }

  // --- Users ---------------------------------------------------------------
  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        role: { select: { name: true, rank: true } },
        manager: { select: { id: true, name: true } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      roleId: u.roleId,
      roleName: u.role.name,
      roleRank: u.role.rank,
      managerId: u.managerId,
      managerName: u.manager?.name ?? null,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
    }));
  }

  async createUser(dto: CreateUserDto) {
    await this.mustRole(dto.roleId);
    if (dto.managerId) await this.mustUser(dto.managerId);
    const dup = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (dup) throw new BadRequestException('Email already in use');
    const password = dto.password ?? randomBytes(6).toString('base64url');
    await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        roleId: dto.roleId,
        managerId: dto.managerId || null,
        passwordHash: await argon2.hash(password),
      },
    });
    return { users: await this.listUsers(), generatedPassword: dto.password ? undefined : password };
  }

  async updateUser(actorId: string, id: string, dto: UpdateUserDto) {
    await this.mustUser(id);
    if (dto.roleId) await this.mustRole(dto.roleId);
    if (dto.managerId) {
      if (dto.managerId === id) throw new BadRequestException('A user cannot manage themselves');
      await this.mustUser(dto.managerId);
    }
    if (dto.status === 'DISABLED' && id === actorId)
      throw new BadRequestException('You cannot disable your own account');
    if (dto.status === 'DISABLED') await this.guardLastAdmin(id);
    await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
        ...(dto.managerId !== undefined ? { managerId: dto.managerId || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    return this.listUsers();
  }

  async resetPassword(id: string) {
    await this.mustUser(id);
    const password = randomBytes(6).toString('base64url');
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await argon2.hash(password) },
    });
    return { generatedPassword: password };
  }

  async deleteUser(actorId: string, id: string) {
    if (id === actorId) throw new BadRequestException('You cannot delete your own account');
    await this.mustUser(id);
    await this.guardLastAdmin(id);
    await this.prisma.user.delete({ where: { id } });
    return this.listUsers();
  }

  private async mustUser(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  /** Prevent disabling/deleting the last active superuser, locking everyone out. */
  private async guardLastAdmin(id: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    const isSuper = ((target?.role.permissions as string[]) ?? []).includes('*');
    if (!isSuper) return;
    const supers = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      include: { role: true },
    });
    const activeSupers = supers.filter(
      (u) => u.id !== id && ((u.role.permissions as string[]) ?? []).includes('*'),
    );
    if (activeSupers.length === 0)
      throw new ForbiddenException('Cannot remove the last active superuser');
  }
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------
@Controller('admin/roles')
export class RolesController {
  constructor(private readonly admin: AdminService) {}

  @Perm('roles.manage') @Get() list() {
    return this.admin.listRoles();
  }
  @Perm('roles.manage') @Get('permissions') permissions() {
    return PERMISSION_REGISTRY;
  }
  @Perm('roles.manage') @Post() create(@Body() dto: CreateRoleDto) {
    return this.admin.createRole(dto);
  }
  @Perm('roles.manage') @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.admin.updateRole(id, dto);
  }
  @Perm('roles.manage') @Delete(':id') remove(@Param('id') id: string) {
    return this.admin.deleteRole(id);
  }
}

@Controller('admin/users')
export class UsersController {
  constructor(private readonly admin: AdminService) {}

  @Perm('users.manage') @Get() list() {
    return this.admin.listUsers();
  }
  @Perm('users.manage') @Post() create(@Body() dto: CreateUserDto) {
    return this.admin.createUser(dto);
  }
  @Perm('users.manage') @Patch(':id')
  update(@CurrentUser() actor: any, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.admin.updateUser(actor.id, id, dto);
  }
  @Perm('users.manage') @Post(':id/reset-password') reset(@Param('id') id: string) {
    return this.admin.resetPassword(id);
  }
  @Perm('users.manage') @Delete(':id')
  remove(@CurrentUser() actor: any, @Param('id') id: string) {
    return this.admin.deleteUser(actor.id, id);
  }
}

@Module({
  providers: [AdminService],
  controllers: [RolesController, UsersController],
  exports: [AdminService],
})
export class AdminModule {}
