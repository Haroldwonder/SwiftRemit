-- Rollback for seed_anchor_catalog_data.sql
-- Removes all three seeded anchor catalogue rows inserted by the migration.

DELETE FROM anchors
WHERE id IN ('anchor-1', 'anchor-2', 'anchor-3');
