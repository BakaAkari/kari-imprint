import type { ExifFieldValues } from './apiV3';

/**
 * Coherent sample cameras for the empty-canvas preview.
 * Each entry is a complete, real-world camera/lens pairing so fields are never
 * assembled into an impossible random combination.
 */
export const PLACEHOLDER_EXIF_POOL: readonly Readonly<ExifFieldValues>[] = [
  { make: 'FUJIFILM', camera_model: 'GFX100S II', lens_model: 'GF80mmF1.7 R WR', focal_length: '80mm', aperture: 'F1.7', shutter: '1/250s', iso: 'ISO400', datetime: '2026.07.10', artist: 'Baka Akari', gps: 'Shanghai' },
  { make: 'FUJIFILM', camera_model: 'X100VI', lens_model: '23mmF2 II', focal_length: '23mm', aperture: 'F2', shutter: '1/500s', iso: 'ISO200', datetime: '2026.05.18', artist: 'Baka Akari', gps: 'Hangzhou' },
  { make: 'FUJIFILM', camera_model: 'X-T5', lens_model: 'XF56mmF1.2 R WR', focal_length: '56mm', aperture: 'F1.2', shutter: '1/320s', iso: 'ISO320', datetime: '2026.04.09', artist: 'Baka Akari', gps: 'Suzhou' },
  { make: 'SONY', camera_model: 'α1 II', lens_model: 'FE 50mm F1.2 GM', focal_length: '50mm', aperture: 'F1.2', shutter: '1/800s', iso: 'ISO100', datetime: '2026.06.21', artist: 'Baka Akari', gps: 'Tokyo' },
  { make: 'SONY', camera_model: 'α7R V', lens_model: 'FE 85mm F1.4 GM II', focal_length: '85mm', aperture: 'F1.4', shutter: '1/400s', iso: 'ISO250', datetime: '2026.03.14', artist: 'Baka Akari', gps: 'Kyoto' },
  { make: 'LEICA', camera_model: 'Leica Q3 43', lens_model: 'APO-Summicron 43mm F2 ASPH.', focal_length: '43mm', aperture: 'F2', shutter: '1/1000s', iso: 'ISO100', datetime: '2026.02.28', artist: 'Baka Akari', gps: 'Paris' },
  { make: 'LEICA', camera_model: 'Leica M11-P', lens_model: 'Summilux-M 35mm F1.4 ASPH.', focal_length: '35mm', aperture: 'F1.4', shutter: '1/250s', iso: 'ISO640', datetime: '2026.01.19', artist: 'Baka Akari', gps: 'Berlin' },
  { make: 'HASSELBLAD', camera_model: 'X2D 100C', lens_model: 'XCD 55V', focal_length: '55mm', aperture: 'F2.5', shutter: '1/180s', iso: 'ISO100', datetime: '2026.07.03', artist: 'Baka Akari', gps: 'Stockholm' },
  { make: 'HASSELBLAD', camera_model: '907X & CFV 100C', lens_model: 'XCD 38V', focal_length: '38mm', aperture: 'F2.5', shutter: '1/125s', iso: 'ISO200', datetime: '2026.05.02', artist: 'Baka Akari', gps: 'Copenhagen' },
  { make: 'Canon', camera_model: 'EOS R5 Mark II', lens_model: 'RF50mm F1.2 L USM', focal_length: '50mm', aperture: 'F1.2', shutter: '1/640s', iso: 'ISO200', datetime: '2026.06.06', artist: 'Baka Akari', gps: 'Beijing' },
  { make: 'Canon', camera_model: 'EOS R3', lens_model: 'RF85mm F1.2 L USM', focal_length: '85mm', aperture: 'F1.2', shutter: '1/500s', iso: 'ISO320', datetime: '2026.04.26', artist: 'Baka Akari', gps: 'Guangzhou' },
  { make: 'NIKON CORPORATION', camera_model: 'NIKON Z 8', lens_model: 'NIKKOR Z 50mm f/1.2 S', focal_length: '50mm', aperture: 'F1.2', shutter: '1/800s', iso: 'ISO125', datetime: '2026.03.30', artist: 'Baka Akari', gps: 'Chengdu' },
  { make: 'NIKON CORPORATION', camera_model: 'NIKON Z f', lens_model: 'NIKKOR Z 40mm f/2', focal_length: '40mm', aperture: 'F2', shutter: '1/320s', iso: 'ISO800', datetime: '2026.02.12', artist: 'Baka Akari', gps: 'Chongqing' },
  { make: 'RICOH', camera_model: 'GR IIIx', lens_model: 'GR LENS 26.1mm F2.8', focal_length: '40mm', aperture: 'F2.8', shutter: '1/500s', iso: 'ISO400', datetime: '2026.06.15', artist: 'Baka Akari', gps: 'Hong Kong' },
  { make: 'Panasonic', camera_model: 'LUMIX S1RII', lens_model: 'LUMIX S 50mm F1.4', focal_length: '50mm', aperture: 'F1.4', shutter: '1/400s', iso: 'ISO160', datetime: '2026.05.25', artist: 'Baka Akari', gps: 'Osaka' },
  { make: 'OLYMPUS', camera_model: 'OM-1 Mark II', lens_model: 'M.ZUIKO DIGITAL ED 25mm F1.2 PRO', focal_length: '50mm', aperture: 'F1.2', shutter: '1/1000s', iso: 'ISO200', datetime: '2026.01.08', artist: 'Baka Akari', gps: 'Xiamen' },
  { make: 'SIGMA', camera_model: 'Sigma fp L', lens_model: '50mm F2 DG DN | Contemporary', focal_length: '50mm', aperture: 'F2', shutter: '1/320s', iso: 'ISO100', datetime: '2026.04.17', artist: 'Baka Akari', gps: 'Shenzhen' },
  { make: 'PENTAX', camera_model: 'K-3 Mark III Monochrome', lens_model: 'HD PENTAX-DA 21mm F3.2 AL Limited', focal_length: '32mm', aperture: 'F3.2', shutter: '1/500s', iso: 'ISO400', datetime: '2026.03.05', artist: 'Baka Akari', gps: 'Nanjing' },
] as const;

export function createRandomPlaceholderExif(
  previous: ExifFieldValues | null = null,
  random: () => number = Math.random,
): ExifFieldValues {
  const candidates = previous?.camera_model
    ? PLACEHOLDER_EXIF_POOL.filter((item) => item.camera_model !== previous.camera_model)
    : PLACEHOLDER_EXIF_POOL;
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return { ...candidates[index] };
}
