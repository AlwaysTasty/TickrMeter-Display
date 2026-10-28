export const WIDTH: 296;
export const HEIGHT: 128;
export const FRAME_BYTES: 4736;
export const MAX_FEED_BYTES: 2048;
export const MAX_URL_BYTES: 512;
export const FORMAT: 'tickrmeter-mono-v1';
export type LedColor = 'off' | 'red' | 'green' | 'blue' | 'purple' | 'cyan' | 'yellow' | 'white';
export type Led = { color: 'off'; mode: 'off' } | { color: Exclude<LedColor, 'off'>; mode: 'solid' };
export const LED_COLORS: readonly LedColor[];
export interface Feed { v: 1; frame: { url: string; sha256: string; format: typeof FORMAT }; observedAt: string; led: Led; }
export class DisplayValidationError extends Error { code: string; field: string; }
export function validateSourceUrl(value: unknown): string;
/** Host-only private-feed foundation; does not enable device/firmware support. */
export type PrivateNetwork = 'lan' | 'internet';
/** Syntax validation only. Retrieval must validate TLS, DNS and actual peer addresses. */
export function validatePrivateSourceUrl(value: unknown, options: { network: PrivateNetwork }): string;
/** Canonical IPv4 only: RFC1918 for LAN, public non-special addresses for internet. */
export function validatePrivateDestinationAddress(address: unknown, options: { network: PrivateNetwork }): string;
export function validateBitmap(value: unknown): Uint8Array;
export function hashBitmap(value: Uint8Array): string;
export function encodeRGBA(rgba: Uint8Array | Uint8ClampedArray, options?: { threshold?: number }): Uint8Array;
export function decodeRGBA(bitmap: Uint8Array): Uint8Array;
export function bitmapToPng(bitmap: Uint8Array): Uint8Array;
export function pngToBitmap(png: Uint8Array, options?: { threshold?: number }): Uint8Array;
export function validateFeed(feed: unknown, options?: { feedUrl?: string }): Feed;
export function validatePrivateFeed(feed: unknown, options: { feedUrl: string; network: PrivateNetwork }): Feed;
export function buildFeed(options: { bitmap: Uint8Array; frameUrl: string; observedAt: string; led?: Led; feedUrl?: string }): Feed;
export function buildPrivateFeed(options: { bitmap: Uint8Array; frameUrl: string; observedAt: string; led?: Led; feedUrl: string; network: PrivateNetwork }): Feed;
export const schemas: { feed: object };
