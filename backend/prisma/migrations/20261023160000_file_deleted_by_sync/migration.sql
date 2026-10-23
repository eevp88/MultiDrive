-- True when the sync marked the file deleted because it disappeared from the provider, false when the user trashed it.
-- Only the first kind is brought back by the sync when the file reappears.
ALTER TABLE `files` ADD COLUMN `deleted_by_sync` BOOLEAN NOT NULL DEFAULT false;
