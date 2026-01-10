import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ArrowUpDown, Users, User, Sparkles, LayoutGrid } from "lucide-react";

export type SortOption = "alphabetical" | "taskCount" | "recentlyUsed" | "shared";
export type FilterOption = "all" | "shared" | "personal" | "ai";

interface ListSortFilterBarProps {
  sortBy: SortOption;
  filterBy: FilterOption;
  onSortChange: (sort: SortOption) => void;
  onFilterChange: (filter: FilterOption) => void;
  hasSharedLists: boolean;
  hasAiLists: boolean;
}

export const ListSortFilterBar: React.FC<ListSortFilterBarProps> = ({
  sortBy,
  filterBy,
  onSortChange,
  onFilterChange,
  hasSharedLists,
  hasAiLists,
}) => {
  const { t } = useTranslation('lists');

  const filterOptions = [
    { value: "all" as FilterOption, label: t('filter.all'), icon: LayoutGrid },
    { value: "shared" as FilterOption, label: t('filter.shared'), icon: Users, disabled: !hasSharedLists },
    { value: "personal" as FilterOption, label: t('filter.personal'), icon: User },
    { value: "ai" as FilterOption, label: t('filter.ai'), icon: Sparkles, disabled: !hasAiLists },
  ];

  return (
    <div className="flex flex-col gap-3 animate-fade-up" style={{ animationDelay: '60ms' }}>
      {/* Sort Dropdown */}
      <div className="flex items-center gap-3">
        <Select value={sortBy} onValueChange={(value) => onSortChange(value as SortOption)}>
          <SelectTrigger className="w-full bg-white/80 backdrop-blur-xl border-white/40 rounded-2xl h-11 shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-stone-400" />
              <SelectValue placeholder={t('sort.label')} />
            </div>
          </SelectTrigger>
          <SelectContent className="bg-white/95 backdrop-blur-xl border-white/40 rounded-xl">
            <SelectItem value="alphabetical">{t('sort.alphabetical')}</SelectItem>
            <SelectItem value="taskCount">{t('sort.taskCount')}</SelectItem>
            <SelectItem value="recentlyUsed">{t('sort.recentlyUsed')}</SelectItem>
            {hasSharedLists && (
              <SelectItem value="shared">{t('sort.sharedFirst')}</SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {filterOptions.map(({ value, label, icon: Icon, disabled }) => (
          <Button
            key={value}
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onFilterChange(value)}
            className={cn(
              "flex-shrink-0 h-8 px-3 rounded-full text-xs font-medium transition-all duration-200",
              "border border-transparent",
              filterBy === value
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-white/60 text-stone-600 hover:bg-white/80 hover:border-stone-200",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            <Icon className="h-3.5 w-3.5 mr-1.5" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
};
