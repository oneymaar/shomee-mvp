import AgentBottomNav from '@/components/AgentBottomNav'

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen text-[#0a0a0a]"
      style={{ backgroundColor: '#F7F5F2' }}
    >
      <link rel="manifest" href="/manifest-agent.json" />
      <div className="pb-[96px]">
        {children}
      </div>
      <AgentBottomNav />
    </div>
  )
}
