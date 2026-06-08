"use client"

import { cn } from "@/lib/utils"
import { PolkadotAvatar } from "./polkadot-avatar"

interface AccountAvatarProps {
  address: string
  size?: number
  className?: string
}

export function AccountAvatar({ address, size = 40, className }: AccountAvatarProps) {
  return (
    <div className={cn("rounded-full overflow-hidden flex-shrink-0", className)}>
      <PolkadotAvatar address={address} size={size} />
    </div>
  )
}
