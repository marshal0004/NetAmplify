import { IntegrationValidationTool } from '@netamplify/nestjs-libraries/chat/tools/integration.validation.tool';
import { IntegrationTriggerTool } from '@netamplify/nestjs-libraries/chat/tools/integration.trigger.tool';
import { IntegrationSchedulePostTool } from './integration.schedule.post';
import { GenerateVideoOptionsTool } from '@netamplify/nestjs-libraries/chat/tools/generate.video.options.tool';
import { VideoFunctionTool } from '@netamplify/nestjs-libraries/chat/tools/video.function.tool';
import { GenerateVideoTool } from '@netamplify/nestjs-libraries/chat/tools/generate.video.tool';
import { VideoStatusTool } from '@netamplify/nestjs-libraries/chat/tools/video.status.tool';
import { GenerateImageTool } from '@netamplify/nestjs-libraries/chat/tools/generate.image.tool';
import { IntegrationListTool } from '@netamplify/nestjs-libraries/chat/tools/integration.list.tool';
import { GroupListTool } from '@netamplify/nestjs-libraries/chat/tools/group.list.tool';
import { UploadFromUrlTool } from '@netamplify/nestjs-libraries/chat/tools/upload.from.url.tool';
import { PostsListTool } from '@netamplify/nestjs-libraries/chat/tools/posts.list.tool';
import { PostSettingsTool } from '@netamplify/nestjs-libraries/chat/tools/post.settings.tool';

export const toolList = [
  IntegrationListTool,
  GroupListTool,
  IntegrationValidationTool,
  IntegrationTriggerTool,
  IntegrationSchedulePostTool,
  PostsListTool,
  PostSettingsTool,
  GenerateVideoOptionsTool,
  VideoFunctionTool,
  GenerateVideoTool,
  VideoStatusTool,
  GenerateImageTool,
  UploadFromUrlTool,
];
