import type { EyeImage, Fixture, Laterality } from '../types/domain'
import { putBlob, readImageDimensions } from '../lib/images'
import { sha256Hex, uid } from '../lib/util'

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png']
export const MAX_BYTES = 20 * 1024 * 1024
export const MIN_SHORT_SIDE = 256

export type NewImage = Omit<EyeImage, 'id' | 'status'>

export class IntakeError extends Error {}

/** Client-side validation. The backend must validate again (spec §6). */
export async function intakeFile(file: Blob & { name?: string }, encounterId: string, laterality: Laterality, origin: 'upload' | 'camera', device?: string): Promise<NewImage> {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new IntakeError(`Unsupported file type (${file.type || 'unknown'}). Use JPEG or PNG.`)
  if (file.size > MAX_BYTES) throw new IntakeError(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 20 MB.`)
  if (file.size < 1024) throw new IntakeError('File is too small to be a retinal image.')
  let dims: { width: number; height: number }
  try {
    dims = await readImageDimensions(file)
  } catch {
    throw new IntakeError('The file could not be decoded as an image. It may be corrupted.')
  }
  if (Math.min(dims.width, dims.height) < MIN_SHORT_SIDE) throw new IntakeError(`Image is only ${dims.width}×${dims.height}px — too small to assess.`)
  const checksum = await sha256Hex(await file.arrayBuffer())
  const blobKey = uid('blob')
  await putBlob(blobKey, file)
  return {
    encounterId,
    laterality,
    origin,
    source: { kind: 'blob', blobKey },
    fileName: file.name ?? `${origin}-${laterality}.jpg`,
    mime: file.type,
    width: dims.width,
    height: dims.height,
    bytes: file.size,
    checksum,
    acquiredAt: new Date().toISOString(),
    device,
  }
}

export async function intakeFixture(fx: Fixture, encounterId: string, laterality: Laterality, acquiredAt = new Date().toISOString()): Promise<NewImage> {
  const res = await fetch(fx.image)
  if (!res.ok) throw new IntakeError(`Sample image could not be loaded (${res.status}).`)
  const buf = await res.arrayBuffer()
  return {
    encounterId,
    laterality,
    origin: 'fixture',
    source: { kind: 'fixture', fixtureId: fx.id, url: fx.image },
    fileName: `${fx.source} (${fx.dataset})`,
    mime: 'image/jpeg',
    width: fx.width,
    height: fx.height,
    bytes: buf.byteLength,
    checksum: await sha256Hex(buf),
    acquiredAt,
    device: `${fx.dataset} dataset image (demo fixture)`,
  }
}
