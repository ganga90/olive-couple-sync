/**
 * OliveAutomationHub — unified Skills + Background Agents card.
 * Renders a two-tab interface: "Skills" (domain capabilities)
 * and "Agents" (background automation).
 */

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import { OliveSkillsManager } from './OliveSkillsManager';
import { BackgroundAgentsManager } from './BackgroundAgentsManager';
import { Puzzle, Bot } from 'lucide-react';

export function OliveAutomationHub() {
  const { t } = useTranslation('profile');

  return (
    <Tabs defaultValue="agents" className="w-full">
      <TabsList className="w-full grid grid-cols-2 h-10 rounded-xl bg-muted/60">
        <TabsTrigger value="agents" className="rounded-lg text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
          <Bot className="h-3.5 w-3.5" />
          {t('agents.tabTitle', 'Agents')}
        </TabsTrigger>
        <TabsTrigger value="skills" className="rounded-lg text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
          <Puzzle className="h-3.5 w-3.5" />
          {t('skills.tabTitle', 'Skills')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="agents" className="mt-4">
        <BackgroundAgentsManager />
      </TabsContent>

      <TabsContent value="skills" className="mt-4">
        <OliveSkillsManager />
      </TabsContent>
    </Tabs>
  );
}

export default OliveAutomationHub;
