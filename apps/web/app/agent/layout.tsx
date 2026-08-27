import AgentBottomNav from '@/components/AgentBottomNav'
import NouvelleVersion from '@/components/agent/NouvelleVersion'
import { couleurs } from '@/lib/theme'

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: couleurs.creme, color: couleurs.encre }}
    >
      <link rel="manifest" href="/manifest-agent.json" />
      <div className="pb-[96px]">
        {children}
      </div>
      <AgentBottomNav />
      <NouvelleVersion />
    </div>
  )
}
