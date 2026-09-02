import { Global, Module } from '@nestjs/common';
import { ImagesSlides } from '@netamplify/nestjs-libraries/videos/images-slides/images.slides';
import { VideoManager } from '@netamplify/nestjs-libraries/videos/video.manager';
import { Seedance } from '@netamplify/nestjs-libraries/videos/seedance/seedance';

@Global()
@Module({
  providers: [ImagesSlides, Seedance, VideoManager],
  get exports() {
    return this.providers;
  },
})
export class VideoModule {}
