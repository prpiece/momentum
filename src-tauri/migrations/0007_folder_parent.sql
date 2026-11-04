-- Folders nest up to three levels (the depth cap lives in the app, src/domain/folders.ts).
ALTER TABLE folders ADD COLUMN parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
