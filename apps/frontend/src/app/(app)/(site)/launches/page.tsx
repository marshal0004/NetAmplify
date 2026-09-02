export const dynamic = 'force-dynamic';
import { LaunchesComponent } from '@netamplify/frontend/components/launches/launches.component';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@netamplify/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'NetAmplify Calendar' : 'Gitroom Launches'}`,
  description: '',
};
export default async function Index() {
  return <LaunchesComponent />;
}
