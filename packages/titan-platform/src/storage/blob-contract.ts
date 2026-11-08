export type BlobStorageRole = 'media' | 'evidence' | 'document' | 'backup' | 'archive';
export type CompanyBlobPlacement = { company_id: string; placement_id: string; provider: string; role: BlobStorageRole; revision: number; enabled: boolean };
export type BlobObject = { company_id: string; object_id: string; placement_id: string; role: BlobStorageRole; opaque_key: string; checksum: string; size_bytes: number; content_type: string };
export type RestoreManifest = { company_id: string; placement_id: string; schema_version: string; objects: readonly Pick<BlobObject, 'object_id' | 'checksum' | 'size_bytes'>[] };

function required(value: string, name: string): void { if (!value.trim()) throw new Error(`blob_${name}_required`); }

export function resolveCompanyBlobPlacement(company_id: string, placement: CompanyBlobPlacement): CompanyBlobPlacement {
  required(company_id, 'company_id');
  if (placement.company_id !== company_id) throw new Error('blob_company_mismatch');
  if (!placement.enabled) throw new Error('blob_placement_disabled');
  required(placement.placement_id, 'placement_id');
  return placement;
}

export function assertBlobObjectBound(placement: CompanyBlobPlacement, object: BlobObject): void {
  resolveCompanyBlobPlacement(placement.company_id, placement);
  if (object.company_id !== placement.company_id || object.placement_id !== placement.placement_id || object.role !== placement.role) throw new Error('blob_object_placement_mismatch');
  required(object.object_id, 'object_id');
  required(object.opaque_key, 'opaque_key');
  if (object.opaque_key.includes('..') || object.opaque_key.includes('\\') || object.opaque_key.startsWith('/')) throw new Error('blob_opaque_key_invalid');
}

export function validateRestoreManifest(placement: CompanyBlobPlacement, manifest: RestoreManifest): void {
  resolveCompanyBlobPlacement(placement.company_id, placement);
  if (manifest.company_id !== placement.company_id || manifest.placement_id !== placement.placement_id) throw new Error('blob_restore_company_mismatch');
  required(manifest.schema_version, 'schema_version');
  for (const object of manifest.objects) { required(object.object_id, 'object_id'); required(object.checksum, 'checksum'); if (object.size_bytes < 0) throw new Error('blob_size_invalid'); }
}

