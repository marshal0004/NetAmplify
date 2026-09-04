// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/users/users.service.ts
// NetAmplify — UsersService (thin wrapper around UserRepository for DI).
//
// AuthService calls this for user CRUD. Owns transaction boundaries; the
// AuthService owns auth-specific logic (password hashing, token gen).

import { Injectable, Inject } from '@nestjs/common';
import { UserRepository } from './users.repository';
import type { User, Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(@Inject(UserRepository) private readonly _userRepo: UserRepository) {}

  findByEmail(email: string): Promise<User | null> {
    return this._userRepo.findByEmail(email);
  }

  findById(id: string): Promise<User | null> {
    return this._userRepo.findById(id);
  }

  createWithProfile(data: {
    email: string;
    passwordHash: string;
    name: string;
    profile?: Prisma.ProfileUncheckedCreateNestedOneWithoutUserInput;
  }): Promise<User> {
    return this._userRepo.createWithProfile(data);
  }

  updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    return this._userRepo.updatePasswordHash(userId, passwordHash);
  }

  hardDelete(userId: string): Promise<void> {
    return this._userRepo.hardDelete(userId);
  }
}
