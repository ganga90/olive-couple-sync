-- Create storage bucket for WhatsApp media
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', true)
on conflict (id) do nothing;

-- Create RLS policies for WhatsApp media bucket
create policy "Public read access for whatsapp media"
on storage.objects for select
using (bucket_id = 'whatsapp-media');

create policy "Authenticated users can upload whatsapp media"
on storage.objects for insert
with check (bucket_id = 'whatsapp-media' and auth.role() = 'authenticated');

create policy "Service role can manage whatsapp media"
on storage.objects for all
using (bucket_id = 'whatsapp-media' and auth.role() = 'service_role');