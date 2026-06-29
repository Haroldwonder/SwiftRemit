-- Rollback for seed_anchor_catalog_data.sql
-- Removes seeded anchor catalog data inserted by the migration.

DELETE FROM anchors
WHERE id = 'anchor-1';
