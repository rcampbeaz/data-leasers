'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';

const MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];

export type MediaAsset = {
  id: string;
  url: string;
  kind: 'image' | 'video';
  altText: string;
  rightsNote: string;
};

// Called from the composer, so it returns a message rather than redirecting and losing the
// draft. The file goes to storage first and the row second; if the row fails the file is
// removed again, so the bucket does not fill with assets nothing points at.
export async function uploadMedia(
  formData: FormData,
): Promise<{ error: string } | { asset: MediaAsset }> {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    return { error: 'Your role does not allow uploading media.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' };
  if (file.size > MAX_BYTES) return { error: 'That file is larger than 25 MB.' };

  const kind = IMAGE_TYPES.includes(file.type)
    ? 'image'
    : VIDEO_TYPES.includes(file.type)
      ? 'video'
      : null;
  if (!kind) return { error: 'Upload a JPEG, PNG, WebP, MP4 or MOV file.' };

  const altText = String(formData.get('altText') ?? '').trim().slice(0, 1000);
  const rightsNote = String(formData.get('rightsNote') ?? '').trim().slice(0, 1000);
  if (!altText) return { error: 'Describe the asset for screen readers before uploading.' };
  if (!rightsNote) return { error: 'Record where the asset came from and what it may be used for.' };

  const extension =
    (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) ||
    (kind === 'image' ? 'jpg' : 'mp4');
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('social-media')
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    return { error: `Could not upload the file. ${uploadError.message}` };
  }

  const { data: publicUrl } = supabase.storage.from('social-media').getPublicUrl(path);
  const url = publicUrl.publicUrl;

  const { data, error } = await supabase
    .from('social_media')
    .insert({
      storage_path: path,
      public_url: url,
      kind,
      mime_type: file.type,
      byte_size: file.size,
      alt_text: altText,
      rights_note: rightsNote,
      uploaded_by: me.user_id,
    })
    .select('id')
    .single();

  if (error || !data) {
    await supabase.storage.from('social-media').remove([path]);
    return { error: 'Could not record the asset. Check that 0011_social_media.sql has been run.' };
  }

  revalidatePath('/social');
  return { asset: { id: data.id, url, kind, altText, rightsNote } };
}
