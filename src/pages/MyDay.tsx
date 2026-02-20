import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/providers/AuthProvider';
import { useSupabaseNotesContext } from '@/providers/SupabaseNotesProvider';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useSupabaseCouple } from '@/providers/SupabaseCoupleProvider';
import { supabase } from '@/lib/supabaseClient';
import { format, isWithinInterval, addDays, startOfDay, endOfDay } from 'date-fns';
import { useDateLocale } from '@/hooks/useDateLocale';
import {
  Sun, Moon, Activity, Flame, TrendingUp, Dumbbell, CheckCircle2,
  Calendar, Loader2, ArrowRight, Zap, Heart, Send, Home, MessageCircle,
  AlertCircle, RefreshCw, Brain, Shield
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/providers/LanguageProvider';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PrivacyFilterPills, type PrivacyFilter } from '@/components/PrivacyFilterPills';

// ─── Oura Data Types ──────────────────────────────────────────────────────────

interface OuraDailyMetric {
  day: string;
  score: number | null;
}

interface OuraActivityMetric {
  day: string;
  score: number | null;
  active_calories: number | null;
  steps: number | null;
}

interface OuraRHR {
  value: number;
  source: 'lowest' | 'average';
}

interface OuraWorkout {
  activity: string;
  calories: number;
  day: string;
  distance?: number;
  end_datetime: string;
  intensity: string;
  start_datetime: string;
}

interface OuraStressMetric {
  day: string;
  stress_high: number | null;    // seconds of high stress
  recovery_high: number | null;  // seconds of high recovery
  day_summary: 'stressed' | 'restored' | 'normal' | null;
}

interface OuraResilienceMetric {
  day: string;
  level: 'limited' | 'adequate' | 'solid' | 'strong' | 'exceptional' | null;
  contributors: {
    sleep_recovery: number | null;
    daytime_recovery: number | null;
  };
}

interface OuraDailyData {
  sleep: OuraDailyMetric | null;
  readiness: OuraDailyMetric | null;
  activity: OuraActivityMetric | null;
  rhr: OuraRHR | null;
  stress: OuraStressMetric | null;
  resilience: OuraResilienceMetric | null;
}

// ─── Score Ring Component ─────────────────────────────────────────────────────

function ScoreRing({ score, size = 80, label, icon: Icon, color }: { 
  score: number | null; size?: number; label: string; 
  icon: React.ElementType; color: string;
}) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - ((score || 0) / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={circumference} strokeDashoffset={score !== null ? offset : circumference}
            strokeLinecap="round" className="transition-all duration-1000 ease-out" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-foreground">{score ?? '—'}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
    </div>
  );
}

// ─── Stress & Resilience Helpers ─────────────────────────────────────────────

function getStressSummaryInfo(summary: string | null): { label: string; color: string } {
  switch (summary) {
    case 'restored':
      return { label: 'myday.stressRestored', color: 'text-green-600 dark:text-green-400' };
    case 'normal':
      return { label: 'myday.stressNormal', color: 'text-amber-600 dark:text-amber-400' };
    case 'stressed':
      return { label: 'myday.stressStressed', color: 'text-red-600 dark:text-red-400' };
    default:
      return { label: 'myday.stressNoData', color: 'text-muted-foreground' };
  }
}

function getResilienceLevelInfo(level: string | null): { label: string; color: string } {
  switch (level) {
    case 'exceptional':
      return { label: 'myday.resilienceExceptional', color: 'text-green-600 dark:text-green-400' };
    case 'strong':
      return { label: 'myday.resilienceStrong', color: 'text-emerald-600 dark:text-emerald-400' };
    case 'solid':
      return { label: 'myday.resilienceSolid', color: 'text-blue-600 dark:text-blue-400' };
    case 'adequate':
      return { label: 'myday.resilienceAdequate', color: 'text-amber-600 dark:text-amber-400' };
    case 'limited':
      return { label: 'myday.resilienceLimited', color: 'text-red-600 dark:text-red-400' };
    default:
      return { label: 'myday.resilienceNoData', color: 'text-muted-foreground' };
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

const MyDay = () => {
  const { t } = useTranslation(['common', 'home', 'calendar', 'profile']);
  const { getLocalizedPath } = useLanguage();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { notes } = useSupabaseNotesContext();
  const { events } = useCalendarEvents();
  const { currentCouple } = useSupabaseCouple();
  const dateLocale = useDateLocale();
  useSEO({ title: `${t('profile:myday.title')} — Olive`, description: t('profile:myday.signInPrompt') });

  const userId = user?.id;
  const [privacyFilter, setPrivacyFilter] = useState<PrivacyFilter>('all');
  const hasSharedNotes = useMemo(() => notes.some(n => n.isShared), [notes]);



  // Oura state
  const [ouraConnected, setOuraConnected] = useState(false);
  const [ouraLoading, setOuraLoading] = useState(true);
  const [ouraEmpty, setOuraEmpty] = useState(false);
  const [dailyData, setDailyData] = useState<OuraDailyData | null>(null);
  const [isYesterday, setIsYesterday] = useState(false);
  const [isFinalized, setIsFinalized] = useState(false);
  const [requiresReauth, setRequiresReauth] = useState(false);
  const [weeklyData, setWeeklyData] = useState<{
    sleep: OuraDailyMetric[];
    readiness: OuraDailyMetric[];
    activity: OuraActivityMetric[];
    workouts: OuraWorkout[];
  } | null>(null);

  // WhatsApp linked state
  const [hasWhatsApp, setHasWhatsApp] = useState<boolean | null>(null);
  const [briefingRequested, setBriefingRequested] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Check if user has WhatsApp linked
  useEffect(() => {
    if (!userId) return;
    const checkWhatsApp = async () => {
      const { data } = await supabase
        .from('clerk_profiles')
        .select('phone_number')
        .eq('id', userId)
        .single();
      setHasWhatsApp(!!data?.phone_number);
    };
    checkWhatsApp();
  }, [userId]);

  // Fetch Oura data
  const fetchOuraData = useCallback(async (forceRefresh = false) => {
    if (!userId) { setOuraLoading(false); return; }
    
    try {
      if (forceRefresh) setRefreshing(true);

      const [dailyRes, weeklyRes] = await Promise.all([
        supabase.functions.invoke('oura-data', { body: { user_id: userId, action: 'daily_summary', force_refresh: forceRefresh } }),
        supabase.functions.invoke('oura-data', { body: { user_id: userId, action: 'weekly_summary' } }),
      ]);

      if (dailyRes.data?.requires_reauth) {
        setRequiresReauth(true);
        setOuraConnected(true);
        return;
      }

      if (dailyRes.data?.success || dailyRes.data?.connected) {
        setOuraConnected(true);

        if (dailyRes.data?.empty) {
          setOuraEmpty(true);
        } else {
          setOuraEmpty(false);
          setDailyData(dailyRes.data.data);
          setIsYesterday(dailyRes.data.is_yesterday ?? false);
          setIsFinalized(dailyRes.data.is_finalized ?? false);
        }
      }

      if (weeklyRes.data?.success) {
        setWeeklyData(weeklyRes.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch Oura data:', err);
    } finally {
      setOuraLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchOuraData();
  }, [fetchOuraData]);

  // Request morning briefing via WhatsApp
  const handleRequestBriefing = useCallback(async () => {
    if (!userId) return;

    if (!hasWhatsApp) {
      toast.info(t('profile:myday.briefing.linkWhatsAppFirst'));
      navigate(getLocalizedPath('/profile'), { state: { scrollTo: 'whatsapp' } });
      return;
    }

    setBriefingRequested(true);
    try {
      const { error } = await supabase.functions.invoke('olive-heartbeat', {
        body: { action: 'generate_briefing', user_id: userId, channel: 'whatsapp' },
      });
      if (error) throw error;
      toast.success(t('profile:myday.briefing.sentToWhatsApp'));
    } catch (err) {
      console.error('Briefing request error:', err);
      toast.error(t('profile:myday.briefing.error'));
      setBriefingRequested(false);
    }
  }, [userId, hasWhatsApp, t, navigate, getLocalizedPath]);

  // Today's tasks (with privacy filter)
  const todayTasks = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    
    return notes.filter(note => {
      if (note.completed) return false;
      if (privacyFilter === 'private' && note.isShared) return false;
      if (privacyFilter === 'shared' && !note.isShared) return false;
      if (note.dueDate) {
        const due = new Date(note.dueDate);
        return isWithinInterval(due, { start: todayStart, end: todayEnd }) || due < todayStart;
      }
      if (note.priority === 'high') return true;
      return false;
    }).sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      return 0;
    });
  }, [notes, privacyFilter]);

  // Tomorrow's tasks (with privacy filter)
  const tomorrowTasks = useMemo(() => {
    const tomorrow = addDays(new Date(), 1);
    const start = startOfDay(tomorrow);
    const end = endOfDay(tomorrow);
    
    return notes.filter(note => {
      if (note.completed) return false;
      if (privacyFilter === 'private' && note.isShared) return false;
      if (privacyFilter === 'shared' && !note.isShared) return false;
      if (note.dueDate) {
        const due = new Date(note.dueDate);
        return isWithinInterval(due, { start, end });
      }
      return false;
    });
  }, [notes, privacyFilter]);

  // Today's events
  const todayEvents = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    return events.filter(e => {
      const start = new Date(e.start_time);
      return isWithinInterval(start, { start: todayStart, end: todayEnd });
    }).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [events]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    const name = user?.firstName || user?.fullName?.split(' ')[0] || '';
    if (hour < 12) return `☀️ ${t('common:common.today')}, ${name}`;
    if (hour < 18) return `👋 ${name}`;
    return `🌙 ${name}`;
  }, [user, t]);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <Activity className="h-12 w-12 text-primary mb-4" />
        <h2 className="text-2xl font-serif font-bold text-foreground mb-2">{t('profile:myday.title')}</h2>
        <p className="text-muted-foreground mb-6">{t('profile:myday.signInPrompt')}</p>
        <Button onClick={() => navigate(getLocalizedPath('/sign-in'))}>
          {t('common:buttons.signIn')}
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-6 max-w-2xl mx-auto pb-8">
        {/* Back to Home + Header */}
        <div className="mb-6 animate-fade-up">
          <button
            onClick={() => navigate(getLocalizedPath('/home'))}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3 min-h-[44px]"
          >
            <Home className="h-4 w-4" />
            <span>{t('common:buttons.backToHome', 'Back to Home')}</span>
          </button>
          <h1 className="text-2xl font-serif font-bold text-foreground">{greeting}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {format(new Date(), 'EEEE, MMMM d', { locale: dateLocale })}
          </p>
        </div>

        {/* ─── Morning Briefing via WhatsApp ───────────────────────────── */}
        <div className="mb-4 animate-fade-up" style={{ animationDelay: '25ms' }}>
          <Button
            variant="outline"
            className="w-full justify-center gap-2 h-11 border-primary/20 hover:bg-primary/5"
            onClick={handleRequestBriefing}
            disabled={briefingRequested}
          >
            {briefingRequested ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                {t('profile:myday.briefing.sentToWhatsApp', 'Sent to WhatsApp!')}
              </>
            ) : hasWhatsApp === false ? (
              <>
                <MessageCircle className="h-4 w-4" />
                {t('profile:myday.briefing.linkWhatsApp', 'Link WhatsApp for Briefings')}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {t('profile:myday.briefing.button')}
              </>
            )}
          </Button>
        </div>

        {/* ─── Oura Health Scores ─────────────────────────────────────── */}
        {ouraLoading ? (
          <div className="card-glass p-6 mb-4 flex items-center justify-center animate-fade-up">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">{t('profile:myday.loadingHealth')}</span>
          </div>
        ) : requiresReauth ? (
          /* Step 5: 401 re-auth flow */
          <div className="card-glass p-5 mb-4 animate-fade-up" style={{ animationDelay: '50ms' }}>
            <div className="flex items-center gap-3 mb-3">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('profile:myday.reauthTitle', 'Oura connection expired')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('profile:myday.reauthDesc', 'Please reconnect your Oura Ring to continue seeing health data.')}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(getLocalizedPath('/profile'))}
              className="w-full"
            >
              {t('profile:myday.reconnectOura', 'Reconnect Oura Ring')}
            </Button>
          </div>
        ) : ouraConnected && ouraEmpty ? (
          /* Step 5: Empty state — no data for 3 days */
          <div className="card-glass p-5 mb-4 animate-fade-up" style={{ animationDelay: '50ms' }}>
            <div className="flex flex-col items-center text-center py-4">
              <Activity className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">
                {t('profile:myday.noDataTitle', 'No Health Data Found')}
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                {t('profile:myday.noDataDesc', 'Please open your Oura App to sync your ring.')}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchOuraData(true)}
                disabled={refreshing}
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                {t('profile:myday.refreshData', 'Refresh')}
              </Button>
            </div>
          </div>
        ) : ouraConnected && dailyData ? (
          <div className="card-glass p-5 mb-4 animate-fade-up" style={{ animationDelay: '50ms' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm text-foreground">{t('profile:myday.healthOverview')}</h3>
              </div>
              <div className="flex items-center gap-2">
                {/* Step 1: Stale data label */}
                {isYesterday && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                    {t('profile:myday.showingYesterday', "Yesterday's data")}
                  </span>
                )}
                {!isFinalized && !isYesterday && (
                  <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    {t('profile:myday.inProgress', 'In progress')}
                  </span>
                )}
                <button
                  onClick={() => fetchOuraData(true)}
                  disabled={refreshing}
                  className="p-1.5 rounded-lg hover:bg-accent/50 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  title={t('profile:myday.refreshData', 'Refresh')}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", refreshing && "animate-spin")} />
                </button>
              </div>
            </div>
            
            {/* Score Rings */}
            <div className="flex justify-around">
              <ScoreRing score={dailyData.sleep?.score ?? null} label={t('profile:myday.sleep')} icon={Moon} color="hsl(var(--primary))" />
              <ScoreRing score={dailyData.readiness?.score ?? null} label={t('profile:myday.readiness')} icon={Zap} color="hsl(130, 50%, 45%)" />
              <ScoreRing score={dailyData.activity?.score ?? null} label={t('profile:myday.activity')} icon={Flame} color="hsl(25, 90%, 55%)" />
            </div>

            {/* Secondary metrics: Steps, Active Calories, RHR */}
            {(dailyData.activity?.steps || dailyData.activity?.active_calories || dailyData.rhr) && (
              <div className="flex justify-around mt-4 pt-3 border-t border-border/50">
                {dailyData.activity?.steps != null && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{dailyData.activity.steps.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{t('profile:myday.steps')}</p>
                  </div>
                )}
                {dailyData.activity?.active_calories != null && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{dailyData.activity.active_calories}</p>
                    <p className="text-[10px] text-muted-foreground">{t('profile:myday.calories')}</p>
                  </div>
                )}
                {dailyData.rhr && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground flex items-center justify-center gap-1">
                      <Heart className="h-3 w-3 text-red-400" />
                      {dailyData.rhr.value}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{t('profile:myday.rhr')}</p>
                  </div>
                )}
              </div>
            )}

            {/* Stress & Resilience (Gen3+ rings only — hidden when data is unavailable) */}
            {(dailyData.stress || dailyData.resilience) && (
              <div className="flex justify-around mt-4 pt-3 border-t border-border/50">
                {dailyData.stress && (
                  <div className="text-center flex-1">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Brain className="h-3.5 w-3.5 text-violet-500" />
                      <p className="text-[10px] text-muted-foreground font-medium">
                        {t('profile:myday.stress')}
                      </p>
                    </div>
                    <p className={cn(
                      "text-sm font-semibold capitalize",
                      getStressSummaryInfo(dailyData.stress.day_summary).color
                    )}>
                      {t(`profile:${getStressSummaryInfo(dailyData.stress.day_summary).label}`)}
                    </p>
                    {dailyData.stress.recovery_high != null && (
                      <p className="text-[9px] text-muted-foreground mt-0.5">
                        {Math.round(dailyData.stress.recovery_high / 60)}{t('profile:myday.minRecovery')}
                      </p>
                    )}
                  </div>
                )}
                {dailyData.resilience && (
                  <div className="text-center flex-1">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Shield className="h-3.5 w-3.5 text-teal-500" />
                      <p className="text-[10px] text-muted-foreground font-medium">
                        {t('profile:myday.resilience')}
                      </p>
                    </div>
                    <p className={cn(
                      "text-sm font-semibold capitalize",
                      getResilienceLevelInfo(dailyData.resilience.level).color
                    )}>
                      {t(`profile:${getResilienceLevelInfo(dailyData.resilience.level).label}`)}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : !ouraConnected ? (
          <button
            onClick={() => navigate(getLocalizedPath('/profile'))}
            className="card-glass p-4 mb-4 w-full text-left animate-fade-up flex items-center gap-3 hover:bg-accent/50 transition-colors"
            style={{ animationDelay: '50ms' }}
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm text-foreground">{t('profile:myday.connectOura')}</p>
              <p className="text-xs text-muted-foreground">{t('profile:myday.connectOuraDesc')}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ) : null}

        {/* ─── Today's Tasks ──────────────────────────────────────────── */}
        <div className="card-glass p-5 mb-4 animate-fade-up" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm text-foreground">{t('profile:myday.todaysTasks')}</h3>
            </div>
            {todayTasks.length > 0 && (
              <span className="text-xs text-muted-foreground">{todayTasks.length}</span>
            )}
          </div>

          {/* Privacy Filter - only shown when in a couple */}
          {currentCouple && (
            <div className="mb-3">
              <PrivacyFilterPills
                value={privacyFilter}
                onChange={setPrivacyFilter}
                hasShared={hasSharedNotes}
              />
            </div>
          )}

          {todayTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center">
              ✨ {t('profile:myday.noTasksToday')}
            </p>
          ) : (
            <div className="space-y-2">
              {todayTasks.slice(0, 6).map(task => (
                <button
                  key={task.id}
                  onClick={() => navigate(getLocalizedPath(`/notes/${task.id}`))}
                  className="flex items-start gap-3 w-full p-2.5 rounded-xl hover:bg-accent/50 transition-colors text-left"
                >
                  <div className={cn(
                    "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                    task.priority === 'high' ? 'bg-[hsl(var(--priority-high))]' :
                    task.priority === 'medium' ? 'bg-[hsl(var(--priority-medium))]' :
                    'bg-muted-foreground/30'
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{task.summary}</p>
                    {task.dueDate && new Date(task.dueDate) < new Date() && (
                      <p className="text-[10px] text-[hsl(var(--priority-high))]">{t('profile:myday.overdue')}</p>
                    )}
                  </div>
                </button>
              ))}
              {todayTasks.length > 6 && (
                <button 
                  onClick={() => navigate(getLocalizedPath('/lists'))}
                  className="text-xs text-primary w-full text-center py-1"
                >
                  {t('profile:myday.more', { count: todayTasks.length - 6 })}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ─── Today's Calendar ───────────────────────────────────────── */}
        {todayEvents.length > 0 && (
          <div className="card-glass p-5 mb-4 animate-fade-up" style={{ animationDelay: '150ms' }}>
            <div className="flex items-center gap-2 mb-3">
              <Calendar className="h-4 w-4 text-[hsl(var(--accent))]" />
              <h3 className="font-semibold text-sm text-foreground">{t('profile:myday.calendar')}</h3>
            </div>
            <div className="space-y-2">
              {todayEvents.slice(0, 5).map(event => (
                <div key={event.id} className="flex items-center gap-3 p-2 rounded-lg">
                  <span className="text-xs text-muted-foreground w-12 flex-shrink-0">
                    {format(new Date(event.start_time), 'HH:mm')}
                  </span>
                  <div className="w-0.5 h-6 bg-[hsl(var(--accent))] rounded-full" />
                  <p className="text-sm text-foreground truncate">{event.title}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Recent Workouts (Oura) ─────────────────────────────────── */}
        {weeklyData?.workouts && weeklyData.workouts.length > 0 && (
          <div className="card-glass p-5 mb-4 animate-fade-up" style={{ animationDelay: '200ms' }}>
            <div className="flex items-center gap-2 mb-3">
              <Dumbbell className="h-4 w-4 text-orange-500" />
              <h3 className="font-semibold text-sm text-foreground">{t('profile:myday.recentWorkouts')}</h3>
            </div>
            <div className="space-y-2">
              {weeklyData.workouts.slice(-4).reverse().map((workout, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-accent/30">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
                      <Dumbbell className="h-4 w-4 text-orange-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground capitalize">
                        {workout.activity.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{workout.day}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-foreground">{workout.calories} {t('profile:myday.calories').toLowerCase()}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{workout.intensity}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Weekly Sleep Trend ──────────────────────────────────────── */}
        {weeklyData?.sleep && weeklyData.sleep.length > 1 && (
          <div className="card-glass p-5 mb-4 animate-fade-up" style={{ animationDelay: '250ms' }}>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm text-foreground">{t('profile:myday.sleepTrend')}</h3>
            </div>
            <div className="flex items-end gap-1 h-16">
              {weeklyData.sleep.map((s, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div 
                    className="w-full rounded-t bg-primary/60 transition-all duration-500"
                    style={{ height: `${Math.max(10, ((s.score ?? 0) / 100) * 64)}px` }}
                  />
                  <span className="text-[8px] text-muted-foreground">
                    {s.day.slice(-2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Tomorrow Preview ────────────────────────────────────────── */}
        {tomorrowTasks.length > 0 && (
          <div className="card-glass p-5 animate-fade-up" style={{ animationDelay: '300ms' }}>
            <div className="flex items-center gap-2 mb-3">
              <Sun className="h-4 w-4 text-amber-500" />
              <h3 className="font-semibold text-sm text-foreground">{t('common:common.tomorrow')}</h3>
            </div>
            <div className="space-y-1.5">
              {tomorrowTasks.slice(0, 3).map(task => (
                <div key={task.id} className="flex items-center gap-2 p-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground truncate">{task.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MyDay;
