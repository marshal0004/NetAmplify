import { Metadata } from 'next';
import { Agent } from '@netamplify/frontend/components/agents/agent';
export const metadata: Metadata = {
  title: 'NetAmplify - Agent',
  description: 'agents',
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Agent>{children}</Agent>;
}
