// /home/z/my-project/netamplify-app/apps/backend/src/services/postcards/postcards.module.ts
// NetAmplify — PostCardsModule (wires PostCardController + service + repository).

import { Module } from '@nestjs/common';
import { PostCardController } from './postcards.controller';
import { PostCardService } from '@netamplify/nestjs-libraries/database/prisma/postcards/postcards.service';
import { PostCardRepository } from '@netamplify/nestjs-libraries/database/prisma/postcards/postcards.repository';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Module({
  imports: [],
  controllers: [PostCardController],
  providers: [
    PostCardService,
    PostCardRepository,
    JwtAuthGuard,
  ],
  exports: [PostCardService, PostCardRepository],
})
export class PostCardsModule {}
