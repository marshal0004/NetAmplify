import { Metadata } from 'next';
import { Agent } from '@netamplify/frontend/components/agents/agent';
import { AgentChat } from '@netamplify/frontend/components/agents/agent.chat';
export const metadata: Metadata = {
  title: 'NetAmplify - Agent',
  description: '',
};
export default async function Page() {
  return (
    <AgentChat />
  );
}
