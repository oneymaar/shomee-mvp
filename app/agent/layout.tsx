import AgentBottomNav from '@/components/AgentBottomNav'

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[#0a0a0a]">
      <div className="pb-[88px]">
        {children}
      </div>
      <AgentBottomNav />
    </div>
  )
}
