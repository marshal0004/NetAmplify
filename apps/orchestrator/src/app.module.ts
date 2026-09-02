import { Module } from '@nestjs/common';
import { PostActivity } from '@netamplify/orchestrator/activities/post.activity';
import { getTemporalModule } from '@netamplify/nestjs-libraries/temporal/temporal.module';
import { DatabaseModule } from '@netamplify/nestjs-libraries/database/prisma/database.module';
import { AutopostService } from '@netamplify/nestjs-libraries/database/prisma/autopost/autopost.service';
import { EmailActivity } from '@netamplify/orchestrator/activities/email.activity';
import { IntegrationsActivity } from '@netamplify/orchestrator/activities/integrations.activity';
import { VideoActivity } from '@netamplify/orchestrator/activities/video.activity';
import { VideoModule } from '@netamplify/nestjs-libraries/videos/video.module';
import { HealthController } from '@netamplify/orchestrator/health.controller';

const activities = [
  PostActivity,
  AutopostService,
  EmailActivity,
  IntegrationsActivity,
  VideoActivity,
];
@Module({
  imports: [
    DatabaseModule,
    VideoModule,
    getTemporalModule(true, require.resolve('./workflows'), activities),
  ],
  controllers: [HealthController],
  providers: [...activities],
  get exports() {
    return [...this.providers, ...this.imports];
  },
})
export class AppModule {}
