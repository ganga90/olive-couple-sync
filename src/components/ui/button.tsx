import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
  {
    variants: {
      variant: {
        // Primary - Main CTA, solid teal
        default: "bg-primary text-primary-foreground hover:bg-primary-light shadow-sm hover:shadow-raised",
        
        // Destructive - Delete/danger actions
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        
        // Outline - Secondary actions with border
        outline: "border-2 border-primary bg-transparent text-primary hover:bg-primary/10",
        
        // Secondary - Less prominent actions
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        
        // Ghost - Minimal, for navigation/tertiary
        ghost: "hover:bg-accent/10 hover:text-accent-foreground",
        
        // Link - Text-style with underline
        link: "text-primary underline-offset-4 hover:underline p-0 h-auto",
        
        // Accent - CTA with warm coral (for hero actions)
        accent: "bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm hover:shadow-glow-accent",
        
        // Hero - Large prominent button for landing/hero sections
        hero: "bg-primary text-primary-foreground hover:bg-primary-light shadow-raised hover:shadow-elevated text-base",
        
        // Soft - Subtle background
        soft: "bg-primary/10 text-primary hover:bg-primary/20",
        
        // Success - Confirmation/complete actions
        success: "bg-success text-white hover:bg-success/90 shadow-sm",
      },
      size: {
        default: "h-11 px-5 py-2.5",
        sm: "h-9 rounded-md px-3.5 text-xs",
        lg: "h-12 rounded-lg px-8 text-base",
        xl: "h-14 rounded-xl px-10 text-lg",
        icon: "h-11 w-11",
        "icon-sm": "h-9 w-9",
        "icon-lg": "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
