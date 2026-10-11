-- ==============================================================================
-- CollabCanvas - Supabase PostgreSQL Schema & Realtime Setup
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Canvas Snapshots Table (for fast joining without replaying thousands of strokes)
CREATE TABLE IF NOT EXISTS canvas_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id TEXT NOT NULL DEFAULT 'main-canvas',
    snapshot_data TEXT NOT NULL, -- base64 image data or compressed JSON
    stroke_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'system'
);

-- Index on room_id and created_at
CREATE INDEX IF NOT EXISTS idx_canvas_snapshots_room_created 
ON canvas_snapshots (room_id, created_at DESC);

-- 3. Drawing Strokes Table
CREATE TABLE IF NOT EXISTS drawings (
    id TEXT PRIMARY KEY, -- client stroke uuid to prevent duplicates
    room_id TEXT NOT NULL DEFAULT 'main-canvas',
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    tool TEXT NOT NULL,
    color TEXT NOT NULL,
    size NUMERIC NOT NULL,
    opacity NUMERIC NOT NULL DEFAULT 1.0,
    points JSONB NOT NULL, -- [{x, y, p}]
    shape_data JSONB, -- {startX, startY, endX, endY, text, filled}
    is_undone BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_drawings_room_created 
ON drawings (room_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_drawings_user_id 
ON drawings (user_id);

-- 4. Chat Messages Table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id TEXT NOT NULL DEFAULT 'main-canvas',
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    user_color TEXT NOT NULL DEFAULT '#a1a1aa',
    text TEXT NOT NULL,
    is_moderator BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room_created 
ON chat_messages (room_id, created_at ASC);

-- 5. Moderation Reports Table
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id TEXT NOT NULL,
    reported_user_id TEXT NOT NULL,
    reported_username TEXT NOT NULL,
    reason TEXT NOT NULL,
    context_type TEXT NOT NULL, -- 'chat' or 'drawing'
    context_id TEXT, -- message id or stroke id
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' -- 'pending', 'resolved', 'dismissed'
);

-- 6. Moderator Audit Logs
CREATE TABLE IF NOT EXISTS moderator_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action TEXT NOT NULL, -- 'clear_canvas', 'mute_user', 'delete_stroke'
    moderator_id TEXT NOT NULL,
    target_id TEXT,
    details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Row Level Security (RLS)
ALTER TABLE canvas_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderator_actions ENABLE ROW LEVEL SECURITY;

-- Anonymous public read & insert policies for collaborative canvas
CREATE POLICY "Public read snapshots" ON canvas_snapshots FOR SELECT USING (true);
CREATE POLICY "Public insert snapshots" ON canvas_snapshots FOR INSERT WITH CHECK (true);

CREATE POLICY "Public read drawings" ON drawings FOR SELECT USING (true);
CREATE POLICY "Public insert drawings" ON drawings FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update own drawings (undo)" ON drawings FOR UPDATE USING (true);

CREATE POLICY "Public read chat" ON chat_messages FOR SELECT USING (true);
CREATE POLICY "Public insert chat" ON chat_messages FOR INSERT WITH CHECK (char_length(text) > 0 AND char_length(text) <= 500);

CREATE POLICY "Public insert reports" ON reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Service/Mod read reports" ON reports FOR SELECT USING (true);

CREATE POLICY "Public read moderator actions" ON moderator_actions FOR SELECT USING (true);
CREATE POLICY "Public insert moderator actions" ON moderator_actions FOR INSERT WITH CHECK (true);

-- 8. Enable Supabase Realtime for Realtime Sync
ALTER PUBLICATION supabase_realtime ADD TABLE drawings;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE canvas_snapshots;
