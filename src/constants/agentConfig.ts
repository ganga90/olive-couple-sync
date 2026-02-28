/**
 * Shared agent configuration constants
 *
 * Icons, colors, and display helpers used by both
 * BackgroundAgentsManager and AgentInsightsSection.
 */

import React from 'react';
import {
  ClipboardList,
  DollarSign,
  Zap,
  Moon,
  Gift,
  Users,
  Mail,
} from 'lucide-react';

export const agentIcons: Record<string, React.ReactNode> = {
  'stale-task-strategist': React.createElement(ClipboardList, { className: 'h-5 w-5' }),
  'smart-bill-reminder': React.createElement(DollarSign, { className: 'h-5 w-5' }),
  'energy-task-suggester': React.createElement(Zap, { className: 'h-5 w-5' }),
  'sleep-optimization-coach': React.createElement(Moon, { className: 'h-5 w-5' }),
  'birthday-gift-agent': React.createElement(Gift, { className: 'h-5 w-5' }),
  'weekly-couple-sync': React.createElement(Users, { className: 'h-5 w-5' }),
  'email-triage-agent': React.createElement(Mail, { className: 'h-5 w-5' }),
};

export const agentIconsSmall: Record<string, React.ReactNode> = {
  'stale-task-strategist': React.createElement(ClipboardList, { className: 'h-4 w-4' }),
  'smart-bill-reminder': React.createElement(DollarSign, { className: 'h-4 w-4' }),
  'energy-task-suggester': React.createElement(Zap, { className: 'h-4 w-4' }),
  'sleep-optimization-coach': React.createElement(Moon, { className: 'h-4 w-4' }),
  'birthday-gift-agent': React.createElement(Gift, { className: 'h-4 w-4' }),
  'weekly-couple-sync': React.createElement(Users, { className: 'h-4 w-4' }),
  'email-triage-agent': React.createElement(Mail, { className: 'h-4 w-4' }),
};

export const agentColors: Record<string, string> = {
  'stale-task-strategist': 'text-blue-600 bg-blue-500/10',
  'smart-bill-reminder': 'text-emerald-600 bg-emerald-500/10',
  'energy-task-suggester': 'text-amber-600 bg-amber-500/10',
  'sleep-optimization-coach': 'text-indigo-600 bg-indigo-500/10',
  'birthday-gift-agent': 'text-pink-600 bg-pink-500/10',
  'weekly-couple-sync': 'text-purple-600 bg-purple-500/10',
  'email-triage-agent': 'text-red-600 bg-red-500/10',
};

export function getAgentDisplayName(agentId: string): string {
  return agentId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
