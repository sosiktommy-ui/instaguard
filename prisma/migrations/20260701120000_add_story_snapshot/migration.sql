-- Добавляем значение STORY в enum SnapshotType (для дедупа story-событий)
ALTER TYPE "SnapshotType" ADD VALUE IF NOT EXISTS 'STORY';
