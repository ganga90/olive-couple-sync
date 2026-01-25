import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  delay?: number;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  icon,
  children,
  defaultOpen = false,
  delay = 0,
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <Collapsible 
      open={isOpen} 
      onOpenChange={setIsOpen}
      className="animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CollapsibleTrigger className="w-full group">
        <div className="flex items-center justify-between py-3 px-1 mb-2">
          <div className="flex items-center gap-2">
            {icon && (
              <div className="w-6 h-6 rounded-lg bg-stone-100 flex items-center justify-center">
                {icon}
              </div>
            )}
            <h2 className="text-xs font-bold uppercase tracking-widest text-stone-500 group-hover:text-stone-700 transition-colors">
              {title}
            </h2>
          </div>
          <ChevronDown 
            className={cn(
              "h-4 w-4 text-stone-400 transition-transform duration-200",
              isOpen && "rotate-180"
            )} 
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
        <div className="space-y-4 pb-4">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default CollapsibleSection;
