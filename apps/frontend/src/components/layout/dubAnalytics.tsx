'use client';

import { useVariables } from '@netamplify/react/helpers/variable.context';
import { Analytics as DubAnalyticsIn } from '@dub/analytics/react';
import { getCookie } from 'react-use-cookie';

export const DubAnalytics = () => {
  const { dub } = useVariables();
  if (!dub) return null;
  return (
    <DubAnalyticsIn
      domainsConfig={{
        refer: 'netamplify.pro',
      }}
    />
  );
};

export const useDubClickId = () => {
  const { dub } = useVariables();
  if (!dub) return undefined;

  const dubCookie = getCookie('dub_partner_data', '{}');
  return JSON.parse(dubCookie)?.clickId || undefined;
};
