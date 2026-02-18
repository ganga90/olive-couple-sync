import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/providers/AuthProvider';
import { useSupabaseNotesContext } from '@/providers/SupabaseNotesProvider';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { supabase } from '@/lib/supabaseClient';
import { format, isWithinInterval, addDays, startOfDay, endOfDay } from 'date-fns';
import { useDateLocale } from '@/hooks/useDateLocale';
import { 
  Sun, Moon, Activity, Flame, TrendingUp, Dumbbell, CheckCircle2, 
  Calendar, Loader2, ArrowRight, Zap, Heart, Send, Home, MessageCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/providers/LanguageProvider';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Oura Data Types ──────────────────────────────────────────────────────────

interface OuraSleep {
  day: string;
  score: number;
  contributors?: {
    deep_sleep?: number;
    efficiency?: number;
    latency?: number;
    rem_sleep?: number;
    restfulness?: number;
    timing?: number;
    total_sleep?: number;
  };
  timestamp?: string;
}

interface OuraReadiness {
  day: string;
  score: number;
  contributors?: {
    activity_balance?: number;
    body_temperature?: number;
    hrv_balance?: number;
    previous_day_activity?: number;
    previous_night?: number;
    recovery_index?: number;
    resting_heart_rate?: number;
    sleep_balance?: number;
  };
  timestamp?: string;
}

interface OuraActivity {
  day: string;
  score: number;
  active_calories?: number;
  steps?: number;
  equivalent_walking_distance?: number;
  timestamp?: string;
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

// ─── Main Component ───────────────────────────────────────────────────────────

const MyDay = () => {
  const { t } = useTranslation(['common', 'home', 'calendar', 'profile']);
  const { getLocalizedPath } = useLanguage();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { notes } = useSupabaseNotesContext();
  const { events } = useCalendarEvents();
  const dateLocale = useDateLocale();
  useSEO({ title: `${t('profile:myday.title')} — Olive`, description: t('profile:myday.signInPrompt') });

  const userId = user?.id;

  // Oura state
  const [ouraConnected, setOuraConnected] = useState(false);
  const [ouraLoading, setOuraLoading] = useState(true);
  const [sleep, setSleep] = useState<OuraSleep | null>(null);
  const [readiness, setReadiness] = useState<OuraReadiness | null>(null);
  const [activity, setActivity] = useState<OuraActivity | null>(null);
  const [weeklyData, setWeeklyData] = useState<{
    sleep: OuraSleep[];
    readiness: OuraReadiness[];
    activity: OuraActivity[];
    workouts: OuraWorkout[];
  } | null>(null);

  // WhatsApp linked state
  const [hasWhatsApp, setHasWhatsApp] = useState<boolean | null>(null);
  const [briefingRequested, setBriefingRequested] = useState(false);

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
  useEffect(() => {
    if (!userId) { setOuraLoading(false); return; }
    
    const fetchOura = async () => {
      try {
        const [dailyRes, weeklyRes] = await Promise.all([
          supabase.functions.invoke('oura-data', { body: { user_id: userId, action: 'daily_summary' } }),
          supabase.functions.invoke('oura-data', { body: { user_id: userId, action: 'weekly_summary' } }),
        ]);

        if (dailyRes.data?.success) {
          setOuraConnected(true);
          setSleep(dailyRes.data.data.sleep);
          setReadiness(dailyRes.data.data.readiness);
          setActivity(dailyRes.data.data.activity);
        }

        if (weeklyRes.data?.success) {
          setWeeklyData(weeklyRes.data.data);
        }
      } catch (err) {
        console.error('Failed to fetch Oura data:', err);
      } finally {
        setOuraLoading(false);
      }
    };

    fetchOura();
  }, [userId]);

  // Request morning briefing via WhatsApp
  const handleRequestBriefing = useCallback(async () => {
    if (!userId) return;

    // If no WhatsApp linked, navigate to profile WhatsApp section
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

  // Today's tasks
  const todayTasks = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    
    return notes.filter(note => {
      if (note.completed) return false;
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
  }, [notes]);

  // Tomorrow's tasks
  const tomorrowTasks = useMemo(() => {
    const tomorrow = addDays(new Date(), 1);
    const start = startOfDay(tomorrow);
    const end = endOfDay(tomorrow);
    
    return notes.filter(note => {
      if (note.completed) return false;
      if (note.dueDate) {
        const due = new Date(note.dueDate);
        return isWithinInterval(due, { start, end });
      }
      return false;
    });
  }, [notes]);

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
        ) : ouraConnected ? (
          <div className="card-glass p-5 mb-4 animate-fade-up" style={{ animationDelay: '50ms' }}>
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm text-foreground">{t('profile:myday.healthOverview')}</h3>
            </div>
            
            <div className="flex justify-around">
              <ScoreRing score={sleep?.score ?? null} label={t('profile:myday.sleep')} icon={Moon} color="hsl(var(--primary))" />
              <ScoreRing score={readiness?.score ?? null} label={t('profile:myday.readiness')} icon={Zap} color="hsl(130, 50%, 45%)" />
              <ScoreRing score={activity?.score ?? null} label={t('profile:myday.activity')} icon={Flame} color="hsl(25, 90%, 55%)" />
            </div>

            {(activity?.steps || sleep?.contributors) && (
              <div className="flex justify-around mt-4 pt-3 border-t border-border/50">
                {activity?.steps && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{(activity.steps).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{t('profile:myday.steps')}</p>
                  </div>
                )}
                {activity?.active_calories && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground">{activity.active_calories}</p>
                    <p className="text-[10px] text-muted-foreground">{t('profile:myday.calories')}</p>
                  </div>
                )}
                {readiness?.contributors?.resting_heart_rate && (
                  <div className="text-center">
                    <p className="text-lg font-bold text-foreground flex items-center justify-center gap-1">
                      <Heart className="h-3 w-3 text-red-400" />
                      {readiness.contributors.resting_heart_rate}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{t('profile:myday.rhr')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
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
        )}

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
                    style={{ height: `${Math.max(10, (s.score / 100) * 64)}px` }}
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
