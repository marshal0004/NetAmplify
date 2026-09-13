// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/users/users.repository.ts
// NetAmplify — UserRepository (single point of access for User table).
//
// Per docs/07-SECURITY-ACCESS.md §3 R1: "Every Prisma read/write of user-owned
// models includes userId from the SESSION (never from request body/params)."
// This repository is injected into AuthService; AuthService ALWAYS scopes
// queries by userId before passing them here.

import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { User, Prisma } from '@prisma/client';

@Injectable()
export class UserRepository {
  constructor(@Inject(PrismaService) private readonly _prisma: PrismaService) {}

  /**
   * Find a user by email (case-sensitive — emails are normalized to lowercase
   * at signup via Zod EMAIL_SCHEMA). Used for login + duplicate-check.
   * Returns null if not found.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this._prisma.user.findUnique({ where: { email } });
  }

  /**
   * Find a user by id. Returns null if not found.
   */
  async findById(id: string): Promise<User | null> {
    return this._prisma.user.findUnique({ where: { id } });
  }

  /**
   * Create a new user with a profile in a single transaction.
   * Returns the user row WITHOUT the passwordHash (caller strips it).
   */
  async createWithProfile(data: {
    email: string;
    passwordHash: string;
    name: string;
    profile?: Prisma.ProfileUncheckedCreateNestedOneWithoutUserInput;
  }): Promise<User> {
    return this._prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash: data.passwordHash,
          name: data.name,
          profile: data.profile
            ? { create: data.profile }
            : { create: {} },
        },
      });
      return user;
    });
  }

  /**
   * Update a user's password hash. Used by reset-confirm flow.
   */
  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this._prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  /**
   * Hard-delete a user + cascade (Profile, PostCard, Connection, Post,
   * PostTarget, AuditLog via Prisma cascade). Per docs/02-SRS.md FR-015:
   * "Account deletion → cascades everything + audit log".
   *
   * Returns void. Throws if user not found (caller should check existence
   * first via findById).
   */
  async hardDelete(userId: string): Promise<void> {
    await this._prisma.user.delete({ where: { id: userId } });
  }

  /**
   * Strip passwordHash from a User row before returning it to the API layer.
   * Pure function — no DB access.
   */
  static stripPasswordHash(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash: _omit, ...safe } = user;
    return safe;
  }
}
