-- Create Storage Bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('tv_menus', 'tv_menus', true);

-- Storage bucket RLS policies
CREATE POLICY "Public Access tv_menus" ON storage.objects FOR SELECT TO public USING ( bucket_id = 'tv_menus' );
CREATE POLICY "Admin Upload Access tv_menus" ON storage.objects FOR INSERT TO authenticated WITH CHECK ( bucket_id = 'tv_menus' );
CREATE POLICY "Admin Update Access tv_menus" ON storage.objects FOR UPDATE TO authenticated USING ( bucket_id = 'tv_menus' );
CREATE POLICY "Admin Delete Access tv_menus" ON storage.objects FOR DELETE TO authenticated USING ( bucket_id = 'tv_menus' );

-- Create Folders table
CREATE TABLE public.tv_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create Images table
CREATE TABLE public.tv_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID NOT NULL REFERENCES public.tv_folders(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.tv_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tv_images ENABLE ROW LEVEL SECURITY;

-- Read Access for all
CREATE POLICY "Enable read access for all users - tv_folders" ON public.tv_folders FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users - tv_images" ON public.tv_images FOR SELECT USING (true);

-- Write Access for Authenticated (Admins)
CREATE POLICY "Enable all access for authenticated users - tv_folders" ON public.tv_folders FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Enable all access for authenticated users - tv_images" ON public.tv_images FOR ALL USING (auth.role() = 'authenticated');

-- Activar Realtime para las tablas
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime CASCADE;
  CREATE PUBLICATION supabase_realtime FOR TABLE public.tv_folders, public.tv_images;
COMMIT;
