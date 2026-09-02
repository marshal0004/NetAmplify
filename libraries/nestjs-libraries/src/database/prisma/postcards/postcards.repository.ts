// /home/z/my-project/netamplify-app/libraries/nestjs-libraries/src/database/prisma/postcards/postcards.repository.ts
// NetAmplify — PostCardRepository (owner-scoped CRUD).
//
// Per docs/07-SECURITY-ACCESS.md §3 R1: "Every Prisma read/write of user-owned
// models includes userId from the SESSION (never from request body/params)."

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { PostCard, Prisma } from '@prisma/client';

export interface PostCardListResult {
  items: PostCard[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class PostCardRepository {
  constructor(private readonly _prisma: PrismaService) {}

  async listByUser(
    userId: string,
    page: number = 1,
    pageSize: number = 12
  ): Promise<PostCardListResult> {
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this._prisma.postCard.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this._prisma.postCard.count({ where: { userId } }),
    ]);
    return { items, total, page, pageSize };
  }

  async findById(userId: string, id: string): Promise<PostCard | null> {
    return this._prisma.postCard.findFirst({
      where: { id, userId }, // userId scoping prevents cross-user access (403 if not owner)
    });
  }

  async create(
    userId: string,
    data: {
      title: string;
      summary: string;
      description: string;
      techStack: string[];
      repoUrl?: string;
      liveUrl?: string;
      imageUrl?: string;
    }
  ): Promise<PostCard> {
    return this._prisma.postCard.create({
      data: { userId, ...data },
    });
  }

  async update(
    userId: string,
    id: string,
    data: Partial<{
      title: string;
      summary: string;
      description: string;
      techStack: string[];
      repoUrl: string | null;
      liveUrl: string | null;
      imageUrl: string | null;
    }>
  ): Promise<PostCard | null> {
    // findFirst with userId scoping ensures ownership; throws NotFoundError if not owner
    const existing = await this.findById(userId, id);
    if (!existing) return null;
    return this._prisma.postCard.update({
      where: { id },
      data,
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const existing = await this.findById(userId, id);
    if (!existing) return false;
    await this._prisma.postCard.delete({ where: { id } });
    return true;
  }
}
