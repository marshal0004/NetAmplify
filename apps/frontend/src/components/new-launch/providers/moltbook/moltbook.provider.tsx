'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@netamplify/frontend/components/new-launch/providers/high.order.provider';
import { MoltbookDto } from '@netamplify/nestjs-libraries/dtos/posts/providers-settings/moltbook.dto';
import { useSettings } from '@netamplify/frontend/components/launches/helpers/use.values';
import { Input } from '@netamplify/react/form/input';
import { useT } from '@netamplify/react/translation/get.transation.service.client';

const MoltbookSettings: FC = () => {
  const form = useSettings();
  const t = useT();

  return (
    <div>
      <Input
        label={t('submolt', 'Submolt')}
        placeholder="general"
        {...form.register('submolt')}
      />
    </div>
  );
};

export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: MoltbookSettings,
  CustomPreviewComponent: undefined,
  dto: MoltbookDto,
  maximumCharacters: 300,
});
