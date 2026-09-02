export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AfterActivate } from '@netamplify/frontend/components/auth/after.activate';
import { isGeneralServerSide } from '@netamplify/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${
    isGeneralServerSide() ? 'NetAmplify' : 'Gitroom'
  } - Activate your account`,
  description: '',
};
export default async function Auth() {
  return <AfterActivate />;
}
