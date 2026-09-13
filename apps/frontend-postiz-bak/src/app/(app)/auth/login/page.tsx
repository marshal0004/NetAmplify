export const dynamic = 'force-dynamic';
import { Login } from '@netamplify/frontend/components/auth/login';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@netamplify/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'NetAmplify' : 'Gitroom'} Login`,
  description: '',
};
export default async function Auth() {
  return <Login />;
}
