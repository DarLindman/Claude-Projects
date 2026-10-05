-- One small JPEG thumbnail per meal, stored by the browser after the analysis.
-- Deleting the meal deletes its photo.
CREATE TABLE IF NOT EXISTS food_photos (
  food_log_id INTEGER PRIMARY KEY REFERENCES food_logs(id) ON DELETE CASCADE,
  bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
