import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { PostsService } from '@netamplify/nestjs-libraries/database/prisma/posts/posts.service';
import {
  NotificationService,
  NotificationType,
} from '@netamplify/nestjs-libraries/database/prisma/notifications/notification.service';
import { Integration, Post, State } from '@prisma/client';
import { stripHtmlValidation } from '@netamplify/helpers/utils/strip.html.validation';
import { IntegrationManager } from '@netamplify/nestjs-libraries/integrations/integration.manager';
import { AuthTokenDetails } from '@netamplify/nestjs-libraries/integrations/social/social.integrations.interface';
import { RefreshIntegrationService } from '@netamplify/nestjs-libraries/integrations/refresh.integration.service';
import { timer } from '@netamplify/helpers/utils/timer';
import { IntegrationService } from '@netamplify/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@netamplify/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { AutopostService } from '@netamplify/nestjs-libraries/database/prisma/autopost/autopost.service';

@Injectable()
@Activity()
export class AutopostActivity {
  constructor(private _autoPostService: AutopostService) {}

  @ActivityMethod()
  async autoPost(id: string) {
    return this._autoPostService.startAutopost(id)
  }
}
