-- Single-row JSON blob; validated and merged with defaults on read (src/domain/settings.ts).
CREATE TABLE settings (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  value TEXT NOT NULL
);
