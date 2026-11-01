-- Perfect days (PLAN D64): rest days the user took, and celebrations that already played.
CREATE TABLE rest_days (
  date TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE celebrations (
  key TEXT PRIMARY KEY NOT NULL,
  at  TEXT NOT NULL
);
