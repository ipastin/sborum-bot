-- Allow one bounded retry for a publish claim that never finalized.
ALTER TABLE published_events
ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1;

UPDATE meta SET value = '4' WHERE key = 'schema_version';
