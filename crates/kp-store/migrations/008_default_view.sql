-- 008: a project can mark one saved view as its default look, applied when a model is
-- opened (colours, transparency, hidden elements, section planes and camera).

ALTER TABLE saved_view ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
