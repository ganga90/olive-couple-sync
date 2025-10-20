import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        ai: "border-transparent bg-[hsl(var(--ai-accent))] text-white hover:bg-[hsl(var(--ai-accent))]/90 font-bold",
        "priority-high": "border-transparent bg-[hsl(var(--priority-high))] text-white hover:bg-[hsl(var(--priority-high))]/90 font-bold",
        "priority-medium": "border-transparent bg-[hsl(var(--priority-medium))] text-white hover:bg-[hsl(var(--priority-medium))]/90 font-bold",
        "priority-low": "border-transparent bg-[hsl(var(--priority-low))] text-white hover:bg-[hsl(var(--priority-low))]/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
