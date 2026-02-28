-- Reset stuck agent runs that have been 'running' for over 1 hour
UPDATE olive_agent_runs 
SET status = 'failed', 
    error_message = 'Force-reset: stuck in running state', 
    completed_at = now() 
WHERE status = 'running' 
  AND started_at < now() - interval '1 hour';

-- Update default triage_frequency from 'manual' to '12h' for existing connections that still have 'manual'
UPDATE olive_email_connections 
SET triage_frequency = '12h' 
WHERE triage_frequency = 'manual' OR triage_frequency IS NULL;