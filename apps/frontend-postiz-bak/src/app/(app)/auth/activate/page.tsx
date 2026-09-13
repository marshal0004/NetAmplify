export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { Activate } from '@netamplify/frontend/components/auth/activate';
import { isGeneralServerSide } from '@netamplify/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${
    isGeneralServerSide() ? 'NetAmplify' : 'Gitroom'
  } - Activate your account`,
  description: '',
};
export default async function Auth() {
  return <Activate />;
}
